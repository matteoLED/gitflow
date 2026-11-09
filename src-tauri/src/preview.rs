//! Live preview of the repository's apps: finds web (Vite, Next…), Expo and Flutter projects, runs their
//! dev server on demand and reports the local URL. Targets are re-detected on every start, so the UI only
//! ever names a target, never a path or a command.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::agents::search_path;
use crate::git::errors::{ErrorKind, GitError, GitResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TargetKind {
    Web,
    Expo,
    Flutter,
    /// An API or backend: no screen to show, its logs and address are the preview.
    Server,
    /// The whole monorepo through its task runner (Turborepo, Nx) or a root script.
    Workspace,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewTarget {
    /// Relative folder plus kind: stable and safe to send back.
    pub id: String,
    pub name: String,
    pub dir: String,
    pub kind: TargetKind,
    pub framework: String,
    /// For display only: what will run.
    pub command: String,
}

const WEB_FRAMEWORKS: [(&str, &str); 8] = [
    ("next", "Next.js"),
    ("vite", "Vite"),
    ("astro", "Astro"),
    ("nuxt", "Nuxt"),
    ("@sveltejs/kit", "SvelteKit"),
    ("@remix-run/dev", "Remix"),
    ("@angular/core", "Angular"),
    ("react-scripts", "Create React App"),
];

const SERVER_FRAMEWORKS: [(&str, &str); 9] = [
    ("@nestjs/core", "NestJS"),
    ("fastify", "Fastify"),
    ("hono", "Hono"),
    ("@hono/node-server", "Hono"),
    ("koa", "Koa"),
    ("@hapi/hapi", "hapi"),
    ("elysia", "Elysia"),
    ("@trpc/server", "tRPC"),
    ("express", "Express"),
];

/// Folders worth looking at: the root and one level under the usual monorepo folders.
fn candidate_dirs(repo: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![repo.to_path_buf()];
    for group in ["apps", "packages", "mobile", "web", "frontend", "client"] {
        let base = repo.join(group);
        dirs.push(base.clone());
        if let Ok(entries) = std::fs::read_dir(&base) {
            let mut children: Vec<_> = entries
                .filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            children.sort();
            dirs.extend(children);
        }
    }
    dirs.into_iter().filter(|d| d.is_dir()).collect()
}

fn package_manager(repo: &Path, dir: &Path) -> &'static str {
    let lockfiles = [
        ("pnpm-lock.yaml", "pnpm"),
        ("yarn.lock", "yarn"),
        ("bun.lock", "bun"),
        ("bun.lockb", "bun"),
    ];
    for folder in dir.ancestors().take_while(|d| d.starts_with(repo)) {
        if let Some((_, pm)) = lockfiles
            .iter()
            .find(|(file, _)| folder.join(file).is_file())
        {
            return pm;
        }
    }
    "npm"
}

fn relative(repo: &Path, dir: &Path) -> String {
    let rel = dir
        .strip_prefix(repo)
        .unwrap_or(dir)
        .to_string_lossy()
        .into_owned();
    if rel.is_empty() { ".".into() } else { rel }
}

fn node_target(repo: &Path, dir: &Path) -> Option<(PreviewTarget, Vec<String>)> {
    let manifest: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("package.json")).ok()?).ok()?;
    let has_dep = |name: &str| {
        ["dependencies", "devDependencies"]
            .iter()
            .any(|k| manifest.get(k).and_then(|d| d.get(name)).is_some())
    };
    let script = |name: &str| {
        manifest
            .pointer(&format!("/scripts/{name}"))
            .and_then(Value::as_str)
            .is_some()
    };
    let pm = package_manager(repo, dir);
    let name = manifest
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| relative(repo, dir));
    let (kind, framework, args): (TargetKind, &str, Vec<String>) = if has_dep("expo") {
        let args = if script("web") {
            vec![pm.into(), "run".into(), "web".into()]
        } else {
            vec!["npx".into(), "expo".into(), "start".into(), "--web".into()]
        };
        (TargetKind::Expo, "Expo", args)
    } else if let Some((_, framework)) = WEB_FRAMEWORKS.iter().find(|(dep, _)| has_dep(dep)) {
        let run = if script("dev") {
            "dev"
        } else if script("start") {
            "start"
        } else {
            return None;
        };
        (
            TargetKind::Web,
            *framework,
            vec![pm.into(), "run".into(), run.into()],
        )
    } else {
        // A package with a server framework and no front-end one is a backend, unless it's a shared library.
        if relative(repo, dir).starts_with("packages/") {
            return None;
        }
        let framework = SERVER_FRAMEWORKS.iter().find(|(dep, _)| has_dep(dep))?.1;
        let run = ["dev", "start:dev", "start"]
            .into_iter()
            .find(|s| script(s))?;
        (
            TargetKind::Server,
            framework,
            vec![pm.into(), "run".into(), run.into()],
        )
    };
    let rel = relative(repo, dir);
    let target = PreviewTarget {
        id: format!("{rel}#{kind:?}").to_lowercase(),
        name,
        dir: rel,
        kind,
        framework: framework.into(),
        command: args.join(" "),
    };
    Some((target, args))
}

fn flutter_target(repo: &Path, dir: &Path) -> Option<(PreviewTarget, Vec<String>)> {
    let pubspec = std::fs::read_to_string(dir.join("pubspec.yaml")).ok()?;
    if !pubspec
        .lines()
        .any(|l| l.trim_start().starts_with("flutter:"))
    {
        return None;
    }
    let name = pubspec
        .lines()
        .find_map(|l| l.strip_prefix("name:"))
        .map(|n| n.trim().to_string())
        .unwrap_or_else(|| relative(repo, dir));
    let rel = relative(repo, dir);
    let args = vec![
        "flutter".into(),
        "run".into(),
        "-d".into(),
        "web-server".into(),
    ];
    let target = PreviewTarget {
        id: format!("{rel}#flutter"),
        name,
        dir: rel,
        kind: TargetKind::Flutter,
        framework: "Flutter".into(),
        command: format!("{} --web-port <free port>", args.join(" ")),
    };
    Some((target, args))
}

fn workspace_target(
    id: &str,
    name: String,
    framework: &str,
    args: Vec<String>,
) -> (PreviewTarget, Vec<String>) {
    let target = PreviewTarget {
        id: id.into(),
        name,
        dir: ".".into(),
        kind: TargetKind::Workspace,
        framework: framework.into(),
        command: args.join(" "),
    };
    (target, args)
}

/// Ways to start everything at once: the task runner's `dev`, then the root's own dev/start scripts.
fn workspace_targets(repo: &Path) -> Vec<(PreviewTarget, Vec<String>)> {
    let manifest: Option<Value> = std::fs::read_to_string(repo.join("package.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok());
    let workspaces = manifest
        .as_ref()
        .is_some_and(|m| m.get("workspaces").is_some())
        || repo.join("pnpm-workspace.yaml").is_file();
    if !workspaces && !repo.join("turbo.json").is_file() && !repo.join("nx.json").is_file() {
        return Vec::new();
    }
    let pm = package_manager(repo, repo);
    let exec = |tool: &str| -> Vec<String> {
        match pm {
            "pnpm" => vec!["pnpm".into(), "exec".into(), tool.into()],
            "yarn" => vec!["yarn".into(), tool.into()],
            "bun" => vec!["bunx".into(), tool.into()],
            _ => vec!["npx".into(), tool.into()],
        }
    };
    let mut targets = Vec::new();
    if repo.join("turbo.json").is_file() {
        let mut args = exec("turbo");
        args.extend(["run".into(), "dev".into()]);
        targets.push(workspace_target(
            ".#turbo",
            "turbo run dev".into(),
            "Turborepo",
            args,
        ));
    }
    if repo.join("nx.json").is_file() {
        let mut args = exec("nx");
        args.extend(["run-many".into(), "-t".into(), "dev".into()]);
        targets.push(workspace_target(
            ".#nx",
            "nx run-many -t dev".into(),
            "Nx",
            args,
        ));
    }
    let scripts = manifest
        .as_ref()
        .and_then(|m| m.get("scripts"))
        .and_then(Value::as_object);
    for (name, _) in scripts.into_iter().flatten() {
        let runs = name == "dev"
            || name == "start"
            || name.starts_with("dev:")
            || name.ends_with(":start");
        if runs && !name.contains("build") {
            let args = vec![pm.to_string(), "run".into(), name.clone()];
            targets.push(workspace_target(
                &format!(".#script:{name}"),
                format!("{pm} run {name}"),
                "Script",
                args,
            ));
        }
    }
    targets
}

fn detect_with_args(repo: &Path) -> Vec<(PreviewTarget, Vec<String>, PathBuf)> {
    let workspace = workspace_targets(repo)
        .into_iter()
        .map(|(t, a)| (t, a, repo.to_path_buf()));
    workspace
        .chain(candidate_dirs(repo).into_iter().flat_map(|dir| {
            [node_target(repo, &dir), flutter_target(repo, &dir)]
                .into_iter()
                .flatten()
                .map(move |(t, a)| (t, a, dir.clone()))
        }))
        .collect()
}

pub fn detect(repo: &Path) -> Vec<PreviewTarget> {
    detect_with_args(repo)
        .into_iter()
        .map(|(t, _, _)| t)
        .collect()
}

fn free_port() -> GitResult<u16> {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .map_err(|err| GitError::new(ErrorKind::Io, format!("No free port: {err}")))
}

/// "listening on port 3000", "Server running on :4000": a backend's port when it prints no URL.
pub fn find_port(line: &str) -> Option<String> {
    let lower = line.to_lowercase();
    let at = lower
        .find("port")
        .map(|i| i + 4)
        .or_else(|| lower.find("listening").map(|i| i + 9))?;
    let digits: String = lower[at..]
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(char::is_ascii_digit)
        .collect();
    let port: u16 = digits.parse().ok()?;
    (port >= 80).then(|| format!("http://localhost:{port}"))
}

/// First local URL in a log line (ANSI colours stripped), with 0.0.0.0 shown as localhost.
pub fn find_local_url(line: &str) -> Option<String> {
    let mut clean = String::with_capacity(line.len());
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            for c in chars.by_ref() {
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            clean.push(c);
        }
    }
    for host in ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"] {
        let needle = format!("http://{host}:");
        if let Some(start) = clean.find(&needle) {
            let rest = &clean[start + needle.len()..];
            let port: String = rest.chars().take_while(char::is_ascii_digit).collect();
            if port.is_empty() {
                continue;
            }
            let tail: String = rest[port.len()..]
                .chars()
                .take_while(|c| !c.is_whitespace() && *c != '\u{1b}')
                .collect();
            return Some(format!(
                "http://localhost:{port}{}",
                tail.trim_end_matches(['.', ','])
            ));
        }
    }
    None
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type"
)]
pub enum PreviewEvent {
    Log {
        target_id: String,
        /// The monorepo task (package) the line came from, when known.
        task: Option<String>,
        line: String,
    },
    Ready {
        target_id: String,
        url: String,
    },
    Exited {
        target_id: String,
        code: Option<i32>,
    },
}

type Registry = Mutex<HashMap<String, (u32, Arc<Mutex<Child>>)>>;

fn running() -> &'static Registry {
    static RUNNING: OnceLock<Registry> = OnceLock::new();
    RUNNING.get_or_init(Default::default)
}

fn emit(app: &AppHandle, event: PreviewEvent) {
    let _ = app.emit("preview", event);
}

fn strip_ansi(line: &str) -> String {
    let mut clean = String::with_capacity(line.len());
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            for c in chars.by_ref() {
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
        } else if c != '\r' {
            clean.push(c);
        }
    }
    clean
}

/// Which task a monorepo log line belongs to: Turborepo prefixes `pkg:task: `, concurrently `[name] `.
pub fn split_task(line: &str) -> (Option<String>, String) {
    if let Some((name, text)) = line
        .strip_prefix('[')
        .and_then(|rest| rest.split_once("] "))
        && !name.is_empty()
        && !name.contains(' ')
    {
        return (Some(name.to_string()), text.to_string());
    }
    if let Some((prefix, text)) = line.split_once(": ")
        && let Some((package, task)) = prefix.rsplit_once(':')
        && !package.is_empty()
        && !task.is_empty()
        && !prefix.contains(char::is_whitespace)
    {
        return (Some(package.to_string()), text.to_string());
    }
    (None, line.to_string())
}

/// How a running target's output is read.
#[derive(Clone)]
struct Stream {
    app: AppHandle,
    id: String,
    server: bool,
    /// For a monorepo run: package name → app target, so each app's URL lights up its own preview.
    apps: Arc<HashMap<String, String>>,
    announced: Arc<Mutex<Vec<String>>>,
}

impl Stream {
    fn ready(&self, target_id: &str, url: String) {
        let mut announced = self.announced.lock().unwrap_or_else(|e| e.into_inner());
        if !announced.iter().any(|t| t == target_id) {
            announced.push(target_id.to_string());
            emit(
                &self.app,
                PreviewEvent::Ready {
                    target_id: target_id.to_string(),
                    url,
                },
            );
        }
    }

    fn line(&self, raw: &str) {
        let clean = strip_ansi(raw);
        let (task, text) = if self.apps.is_empty() {
            (None, clean)
        } else {
            split_task(&clean)
        };
        let url =
            find_local_url(&text).or_else(|| if self.server { find_port(&text) } else { None });
        if let Some(url) = url {
            match task.as_ref().and_then(|t| self.apps.get(t)) {
                Some(app_id) => self.ready(&app_id.clone(), url),
                None if self.apps.is_empty() => self.ready(&self.id.clone(), url),
                None => {}
            }
        }
        emit(
            &self.app,
            PreviewEvent::Log {
                target_id: self.id.clone(),
                task,
                line: text,
            },
        );
    }

    fn follow(self, pipe: impl Read + Send + 'static) -> thread::JoinHandle<()> {
        thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                self.line(&line);
            }
        })
    }
}

/// Runs a detected target's dev server in its own process group, so stopping it stops every child.
pub fn start(app: AppHandle, repo: &Path, id: &str) -> GitResult<()> {
    if running()
        .lock()
        .map(|m| m.contains_key(id))
        .unwrap_or(false)
    {
        return Ok(());
    }
    let all = detect_with_args(repo);
    let (target, mut args, dir) = all
        .iter()
        .find(|(t, _, _)| t.id == id)
        .cloned()
        .ok_or_else(|| GitError::invalid("This app is no longer in the repository."))?;
    if target.kind == TargetKind::Flutter {
        args.extend(["--web-port".into(), free_port()?.to_string()]);
    }
    let mut child = Command::new(&args[0])
        .args(&args[1..])
        .current_dir(&dir)
        .env("PATH", search_path())
        .env("BROWSER", "none")
        .env("FORCE_COLOR", "0")
        // Task runners draw a full-screen UI on a terminal; here they must stream prefixed lines.
        .env("TURBO_UI", "stream")
        .env("NX_TUI", "false")
        .process_group(0)
        // Kept open: interactive scripts (menus, prompts) can be answered from the app.
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| {
            GitError::new(
                ErrorKind::Io,
                format!("Couldn't run `{}`: {err}", target.command),
            )
        })?;
    let pid = child.id();
    if let (Some(stdin), Ok(mut inputs)) = (child.stdin.take(), inputs().lock()) {
        inputs.insert(id.to_string(), stdin);
    }
    let workspace = target.kind == TargetKind::Workspace;
    let apps: HashMap<String, String> = if workspace {
        all.iter()
            .filter(|(t, _, _)| t.kind != TargetKind::Workspace)
            .flat_map(|(t, _, _)| {
                // Turborepo names tasks after the package, concurrently after whatever the script chose.
                let short = t.name.rsplit('/').next().unwrap_or(&t.name).to_string();
                [(t.name.clone(), t.id.clone()), (short, t.id.clone())]
            })
            .collect()
    } else {
        HashMap::new()
    };
    let stream = Stream {
        app: app.clone(),
        id: id.to_string(),
        server: target.kind == TargetKind::Server || workspace,
        apps: Arc::new(apps),
        announced: Arc::default(),
    };
    if workspace {
        // Running from now on: the per-task view needs no URL to show.
        emit(
            &app,
            PreviewEvent::Ready {
                target_id: id.to_string(),
                url: String::new(),
            },
        );
    }
    let readers = [
        child.stdout.take().map(|p| stream.clone().follow(p)),
        child.stderr.take().map(|p| stream.clone().follow(p)),
    ];
    let child = Arc::new(Mutex::new(child));
    if let Ok(mut map) = running().lock() {
        map.insert(id.to_string(), (pid, Arc::clone(&child)));
    }
    record(pid);
    let id = id.to_string();
    thread::spawn(move || {
        for reader in readers.into_iter().flatten() {
            let _ = reader.join();
        }
        let code = child
            .lock()
            .ok()
            .and_then(|mut c| c.wait().ok())
            .and_then(|s| s.code());
        if let Ok(mut map) = running().lock() {
            map.remove(&id);
        }
        if let Ok(mut map) = inputs().lock() {
            map.remove(&id);
        }
        forget(pid);
        // Apps that came up inside a monorepo run stop with it.
        let lit: Vec<String> = stream
            .announced
            .lock()
            .map(|a| a.clone())
            .unwrap_or_default();
        for app_id in lit.into_iter().filter(|a| *a != id) {
            emit(
                &app,
                PreviewEvent::Exited {
                    target_id: app_id,
                    code: None,
                },
            );
        }
        emit(
            &app,
            PreviewEvent::Exited {
                target_id: id,
                code,
            },
        );
    });
    Ok(())
}

fn inputs() -> &'static Mutex<HashMap<String, std::process::ChildStdin>> {
    static INPUTS: OnceLock<Mutex<HashMap<String, std::process::ChildStdin>>> = OnceLock::new();
    INPUTS.get_or_init(Default::default)
}

/// Sends one line to a running target's standard input (e.g. a menu choice).
pub fn send_input(id: &str, text: &str) -> GitResult<()> {
    if text.len() > 4_096 || text.contains('\0') {
        return Err(GitError::invalid("This input is too long."));
    }
    let mut map = inputs()
        .lock()
        .map_err(|_| GitError::invalid("Input unavailable."))?;
    let stdin = map
        .get_mut(id)
        .ok_or_else(|| GitError::invalid("This process is no longer running."))?;
    stdin
        .write_all(format!("{text}\n").as_bytes())
        .and_then(|()| stdin.flush())
        .map_err(|err| GitError::new(ErrorKind::Io, format!("Couldn't send the input: {err}")))
}

/* Orphan safety. A dev rebuild or a crash can kill the app without running its exit hook; the dev servers
 * it started would then keep their ports (a stray Vite once sat on the API's port). Every started group is
 * recorded on disk with its start time, and leftovers are stopped at the next launch. */

static LEDGER: OnceLock<PathBuf> = OnceLock::new();

/// Where started process groups are recorded; set once at startup.
pub fn init_ledger(path: PathBuf) {
    let _ = LEDGER.set(path);
}

fn start_time(pid: u32) -> Option<String> {
    let out = Command::new("/bin/ps")
        .args(["-o", "lstart=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

fn read_ledger() -> Vec<(u32, String)> {
    let Some(path) = LEDGER.get() else {
        return Vec::new();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_ledger(entries: &[(u32, String)]) {
    if let Some(path) = LEDGER.get() {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, serde_json::to_string(entries).unwrap_or_default());
    }
}

/// Serializes ledger updates: servers start and stop concurrently.
static LEDGER_LOCK: Mutex<()> = Mutex::new(());

fn record(pid: u32) {
    let _guard = LEDGER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(started) = start_time(pid) {
        let mut entries = read_ledger();
        entries.push((pid, started));
        write_ledger(&entries);
    }
}

fn forget(pid: u32) {
    let _guard = LEDGER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let entries: Vec<_> = read_ledger()
        .into_iter()
        .filter(|(p, _)| *p != pid)
        .collect();
    write_ledger(&entries);
}

/// Stops dev servers left running by a previous session. A pid is only killed if it still has the start
/// time it had when recorded, so a recycled pid belonging to something else is never touched.
pub fn stop_orphans() {
    let _guard = LEDGER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    for (pid, started) in read_ledger() {
        if start_time(pid).as_deref() == Some(started.as_str()) {
            kill_group(pid);
        }
    }
    write_ledger(&[]);
}

fn kill_group(pid: u32) {
    // A negative pid targets the whole process group (pnpm → node → vite…).
    let _ = Command::new("/bin/kill")
        .args(["-TERM", "--", &format!("-{pid}")])
        .status();
}

pub fn stop(id: &str) {
    let pid = running()
        .lock()
        .ok()
        .and_then(|m| m.get(id).map(|(pid, _)| *pid));
    if let Some(pid) = pid {
        kill_group(pid);
    }
}

/// Called when the app quits: no dev server is left behind.
pub fn stop_all() {
    let pids: Vec<u32> = running()
        .lock()
        .map(|m| m.values().map(|(pid, _)| *pid).collect())
        .unwrap_or_default();
    pids.into_iter().for_each(kill_group);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_are_found_through_colour_codes() {
        let line = "  \u{1b}[32m➜\u{1b}[39m  Local:   \u{1b}[36mhttp://localhost:\u{1b}[1m5173\u{1b}[22m/\u{1b}[39m";
        assert_eq!(
            find_local_url(line).as_deref(),
            Some("http://localhost:5173/")
        );
    }

    #[test]
    fn wildcard_hosts_become_localhost() {
        assert_eq!(
            find_local_url("ready on http://0.0.0.0:3000.").as_deref(),
            Some("http://localhost:3000")
        );
    }

    #[test]
    fn lines_without_a_local_url_are_ignored() {
        assert_eq!(
            find_local_url("compiled https://example.com:443 in 2s"),
            None
        );
    }

    #[test]
    fn detects_a_vite_app_in_a_pnpm_monorepo() {
        let repo = tempfile::tempdir().unwrap();
        std::fs::write(repo.path().join("pnpm-lock.yaml"), "").unwrap();
        let web = repo.path().join("apps/web");
        std::fs::create_dir_all(&web).unwrap();
        std::fs::write(
            web.join("package.json"),
            r#"{"name":"web","scripts":{"dev":"vite"},"devDependencies":{"vite":"7"}}"#,
        )
        .unwrap();
        let targets = detect(repo.path());
        assert_eq!(
            (targets[0].id.as_str(), targets[0].command.as_str()),
            ("apps/web#web", "pnpm run dev")
        );
    }

    #[test]
    fn detects_an_expo_app_as_mobile() {
        let repo = tempfile::tempdir().unwrap();
        let mobile = repo.path().join("apps/mobile");
        std::fs::create_dir_all(&mobile).unwrap();
        std::fs::write(
            mobile.join("package.json"),
            r#"{"name":"mobile","dependencies":{"expo":"52"}}"#,
        )
        .unwrap();
        assert_eq!(detect(repo.path())[0].kind, TargetKind::Expo);
    }

    #[test]
    fn detects_an_express_api_as_a_server() {
        let repo = tempfile::tempdir().unwrap();
        let api = repo.path().join("apps/api");
        std::fs::create_dir_all(&api).unwrap();
        std::fs::write(api.join("package.json"), r#"{"name":"api","scripts":{"dev":"tsx watch src"},"dependencies":{"express":"5","@trpc/server":"11"}}"#).unwrap();
        let target = &detect(repo.path())[0];
        assert_eq!(
            (target.kind, target.framework.as_str()),
            (TargetKind::Server, "tRPC")
        );
    }

    #[test]
    fn servers_report_their_port_without_a_url() {
        assert_eq!(
            find_port("API listening on port 4000").as_deref(),
            Some("http://localhost:4000")
        );
    }

    #[test]
    fn turborepo_lines_name_their_package() {
        assert_eq!(
            split_task("@mntal/api:dev: listening"),
            (Some("@mntal/api".into()), "listening".into())
        );
    }

    #[test]
    fn concurrently_lines_name_their_process() {
        assert_eq!(
            split_task("[platform] VITE ready"),
            (Some("platform".into()), "VITE ready".into())
        );
    }

    #[test]
    fn plain_lines_have_no_task() {
        assert_eq!(split_task("Error: boom"), (None, "Error: boom".into()));
    }

    #[test]
    fn a_turborepo_monorepo_offers_turbo_and_its_root_scripts() {
        let repo = tempfile::tempdir().unwrap();
        std::fs::write(repo.path().join("turbo.json"), "{}").unwrap();
        std::fs::write(repo.path().join("pnpm-lock.yaml"), "").unwrap();
        std::fs::write(
            repo.path().join("pnpm-workspace.yaml"),
            "packages: [apps/*]",
        )
        .unwrap();
        std::fs::write(
            repo.path().join("package.json"),
            r#"{"scripts":{"dev":"bash start.sh","build":"turbo build"}}"#,
        )
        .unwrap();
        let ids: Vec<_> = detect(repo.path())
            .into_iter()
            .map(|t| (t.id, t.command))
            .collect();
        assert_eq!(
            ids,
            [
                (".#turbo".into(), "pnpm exec turbo run dev".into()),
                (".#script:dev".into(), "pnpm run dev".into())
            ]
        );
    }

    #[test]
    fn shared_packages_are_not_backends() {
        let repo = tempfile::tempdir().unwrap();
        let lib = repo.path().join("packages/trpc-client");
        std::fs::create_dir_all(&lib).unwrap();
        std::fs::write(
            lib.join("package.json"),
            r#"{"scripts":{"dev":"tsc -w"},"dependencies":{"@trpc/server":"11"}}"#,
        )
        .unwrap();
        assert!(detect(repo.path()).is_empty());
    }

    #[test]
    fn a_recorded_pid_is_only_trusted_with_its_original_start_time() {
        let me = std::process::id();
        let started = start_time(me).unwrap();
        // Same pid, other start time: that pid was recycled, so it must not be killed.
        assert_ne!(Some(format!("{started}x")), start_time(me));
        assert_eq!(start_time(me).as_deref(), Some(started.as_str()));
    }
}
