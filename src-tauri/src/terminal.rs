//! Integrated terminal: the user's login shell in a real PTY, opened in the repository.
//! Output streams to the UI as `terminal` events; keystrokes come back through `write`.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::agents::search_path;
use crate::git::errors::{ErrorKind, GitError, GitResult};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

fn sessions() -> &'static Mutex<HashMap<String, Session>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
    SESSIONS.get_or_init(Default::default)
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type"
)]
pub enum TerminalEvent {
    Output { id: String, data: String },
    Exited { id: String },
}

fn pty_error(err: impl std::fmt::Display) -> GitError {
    GitError::new(ErrorKind::Io, format!("Terminal error: {err}"))
}

/// Opens the user's shell (`$SHELL`, zsh by default) as a login shell in `repo`.
pub fn open(app: AppHandle, repo: &Path, cols: u16, rows: u16) -> GitResult<String> {
    let size = PtySize {
        rows: rows.max(2),
        cols: cols.max(10),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = native_pty_system().openpty(size).map_err(pty_error)?;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    cmd.cwd(repo);
    cmd.env("PATH", search_path());
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    let child = pair.slave.spawn_command(cmd).map_err(pty_error)?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(pty_error)?;
    let writer = pair.master.take_writer().map_err(pty_error)?;

    static NEXT: AtomicU64 = AtomicU64::new(1);
    let id = format!("term-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    if let Ok(mut map) = sessions().lock() {
        map.insert(
            id.clone(),
            Session {
                master: pair.master,
                writer,
                child,
            },
        );
    }
    let thread_id = id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut pending = Vec::new();
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            pending.extend_from_slice(&buf[..n]);
            // Only send whole UTF-8 characters; keep a split multi-byte tail for the next read.
            let valid = match std::str::from_utf8(&pending) {
                Ok(_) => pending.len(),
                Err(err) if err.error_len().is_none() => err.valid_up_to(),
                Err(_) => pending.len(),
            };
            let data = String::from_utf8_lossy(&pending[..valid]).into_owned();
            pending.drain(..valid);
            let _ = app.emit(
                "terminal",
                TerminalEvent::Output {
                    id: thread_id.clone(),
                    data,
                },
            );
        }
        if let Ok(mut map) = sessions().lock() {
            map.remove(&thread_id);
        }
        let _ = app.emit("terminal", TerminalEvent::Exited { id: thread_id });
    });
    Ok(id)
}

pub fn write(id: &str, data: &str) -> GitResult<()> {
    let mut map = sessions().lock().map_err(pty_error)?;
    let session = map
        .get_mut(id)
        .ok_or_else(|| GitError::invalid("This terminal is closed."))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(pty_error)?;
    session.writer.flush().map_err(pty_error)
}

pub fn resize(id: &str, cols: u16, rows: u16) -> GitResult<()> {
    let map = sessions().lock().map_err(pty_error)?;
    if let Some(session) = map.get(id) {
        let size = PtySize {
            rows: rows.max(2),
            cols: cols.max(10),
            pixel_width: 0,
            pixel_height: 0,
        };
        session.master.resize(size).map_err(pty_error)?;
    }
    Ok(())
}

pub fn close(id: &str) {
    let session = sessions().lock().ok().and_then(|mut m| m.remove(id));
    if let Some(mut session) = session {
        let _ = session.child.kill();
    }
}

pub fn close_all() {
    let ids: Vec<String> = sessions()
        .lock()
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();
    ids.iter().for_each(|id| close(id));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_use_camel_case_fields() {
        let json = serde_json::to_value(TerminalEvent::Exited {
            id: "term-1".into(),
        })
        .unwrap();
        assert_eq!(json, serde_json::json!({"type": "exited", "id": "term-1"}));
    }
}
