//! Language servers for the editor: one process per (repository, language), spoken to over stdio with LSP's
//! `Content-Length` framing. Server messages reach the UI as `lsp` events; the UI answers through `send`.
//! Servers quit by themselves when their stdin closes, so none outlives the app.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::agents::search_path;
use crate::git::errors::{ErrorKind, GitError, GitResult};

struct Server {
    stdin: ChildStdin,
    child: Child,
}

fn servers() -> &'static Mutex<HashMap<String, Server>> {
    static SERVERS: OnceLock<Mutex<HashMap<String, Server>>> = OnceLock::new();
    SERVERS.get_or_init(Default::default)
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type"
)]
pub enum LspEvent {
    Message { id: String, message: String },
    Exited { id: String },
}

/// Where language servers usually live, besides the app's PATH (cargo, go, Homebrew, npm).
fn find(program: &str) -> Option<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_default();
    let extra = [format!("{home}/.cargo/bin"), format!("{home}/go/bin")];
    search_path()
        .split(':')
        .map(str::to_string)
        .chain(extra)
        .map(|dir| Path::new(&dir).join(program))
        .find(|candidate| candidate.is_file())
}

/// The server for a language: the project's own install first (node_modules), then the user's.
fn command_for(repo: &Path, language: &str) -> GitResult<(PathBuf, Vec<&'static str>)> {
    let candidates: &[(&str, &[&'static str])] = match language {
        "typescript" => &[("typescript-language-server", &["--stdio"])],
        "rust" => &[("rust-analyzer", &[])],
        "python" => &[("pyright-langserver", &["--stdio"]), ("pylsp", &[])],
        "go" => &[("gopls", &[])],
        _ => return Err(GitError::invalid("No language server for this language.")),
    };
    for (program, args) in candidates {
        let local = repo.join("node_modules/.bin").join(program);
        if let Some(path) = local.is_file().then_some(local).or_else(|| find(program)) {
            return Ok((path, args.to_vec()));
        }
    }
    let install = match language {
        "typescript" => "npm i -g typescript-language-server typescript",
        "rust" => "rustup component add rust-analyzer",
        "python" => "npm i -g pyright",
        _ => "go install golang.org/x/tools/gopls@latest",
    };
    Err(GitError::new(
        ErrorKind::Io,
        format!("No {language} language server found. Install one with: {install}"),
    ))
}

/// Reads one framed message: headers, a blank line, then exactly `Content-Length` bytes.
fn read_message(reader: &mut impl BufRead) -> std::io::Result<Option<String>> {
    let mut length = None;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 {
            return Ok(None);
        }
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        if let Some(value) = header.strip_prefix("Content-Length:") {
            length = value.trim().parse::<usize>().ok();
        }
    }
    let Some(length) = length else {
        return Ok(Some(String::new())); // a header block without a body: skipped by the caller
    };
    let mut body = vec![0; length];
    reader.read_exact(&mut body)?;
    Ok(Some(String::from_utf8_lossy(&body).into_owned()))
}

/// Starts the language server for `language` in `repo`, or reuses the running one. Returns its id.
pub fn start(app: AppHandle, repo: &Path, language: &str) -> GitResult<String> {
    let id = format!("{language}:{}", repo.display());
    spawn(app, id, repo, || command_for(repo, language))
}

/// GitHub Copilot's language server, one for the whole app (it serves files of any repository): the
/// installed `copilot-language-server`, else the npm package through `npx`. Fixed programs and arguments.
pub fn start_copilot(app: AppHandle) -> GitResult<String> {
    let home = PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".into()));
    spawn(app, COPILOT.to_string(), &home, copilot_command)
}

const COPILOT: &str = "copilot";

fn copilot_command() -> GitResult<(PathBuf, Vec<&'static str>)> {
    if let Some(path) = find("copilot-language-server") {
        return Ok((path, vec!["--stdio"]));
    }
    find("npx")
        .map(|npx| {
            (
                npx,
                vec!["--yes", "@github/copilot-language-server", "--stdio"],
            )
        })
        .ok_or_else(|| {
            GitError::new(
                ErrorKind::Io,
                "GitHub Copilot needs Node.js (npx). Install it from nodejs.org or with: brew install node",
            )
        })
}

/// Runs a server under `id` unless it already runs; `command` is only resolved when a process is needed.
fn spawn(
    app: AppHandle,
    id: String,
    cwd: &Path,
    command: impl FnOnce() -> GitResult<(PathBuf, Vec<&'static str>)>,
) -> GitResult<String> {
    let mut all = servers()
        .lock()
        .map_err(|_| GitError::invalid("Language servers are busy."))?;
    // Each client initializes its server once: a page reloaded (⌘R, dev reload) starts a fresh process
    // instead of reusing one that already answered `initialize`, which servers refuse twice.
    let prefix = format!("{id}#");
    let stale: Vec<String> = all
        .keys()
        .filter(|k| k.starts_with(&prefix))
        .cloned()
        .collect();
    for key in stale {
        if let Some(mut old) = all.remove(&key) {
            let _ = old.child.kill();
        }
    }
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let id = format!(
        "{prefix}{}",
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    );
    let (program, args) = command()?;
    let mut child = Command::new(&program)
        .args(&args)
        .current_dir(cwd)
        .env("PATH", search_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| {
            GitError::new(
                ErrorKind::Io,
                format!("Couldn't start {}: {err}", program.display()),
            )
        })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| GitError::invalid("No stdin."))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| GitError::invalid("No stdout."))?;
    let reader_id = id.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        while let Ok(Some(message)) = read_message(&mut reader) {
            if !message.is_empty() {
                let _ = app.emit(
                    "lsp",
                    LspEvent::Message {
                        id: reader_id.clone(),
                        message,
                    },
                );
            }
        }
        if let Ok(mut all) = servers().lock() {
            all.remove(&reader_id);
        }
        let _ = app.emit("lsp", LspEvent::Exited { id: reader_id });
    });
    all.insert(id.clone(), Server { stdin, child });
    Ok(id)
}

/// Sends one JSON-RPC message to a running server.
pub fn send(id: &str, message: &str) -> GitResult<()> {
    let mut all = servers()
        .lock()
        .map_err(|_| GitError::invalid("Language servers are busy."))?;
    let server = all
        .get_mut(id)
        .ok_or_else(|| GitError::invalid("This language server stopped."))?;
    let framed = format!("Content-Length: {}\r\n\r\n{message}", message.len());
    server
        .stdin
        .write_all(framed.as_bytes())
        .and_then(|()| server.stdin.flush())
        .map_err(|err| GitError::new(ErrorKind::Io, format!("Language server unreachable: {err}")))
}

pub fn stop(id: &str) {
    if let Some(mut server) = servers().lock().ok().and_then(|mut all| all.remove(id)) {
        let _ = server.child.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn reads_framed_messages_back_to_back() {
        let mut input = Cursor::new(
            "Content-Length: 2\r\nContent-Type: x\r\n\r\n{}Content-Length: 4\r\n\r\nnull"
                .as_bytes()
                .to_vec(),
        );
        assert_eq!(read_message(&mut input).unwrap().as_deref(), Some("{}"));
        assert_eq!(read_message(&mut input).unwrap().as_deref(), Some("null"));
        assert_eq!(read_message(&mut input).unwrap(), None);
    }

    #[test]
    fn unknown_languages_get_no_server() {
        assert!(command_for(Path::new("/tmp"), "cobol").is_err());
    }
}
