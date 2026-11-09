//! Claude Code sessions saved for a repository under `~/.claude/projects/<encoded path>/*.jsonl`.
//! Read-only: the files are only ever opened for reading.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use serde::Serialize;
use serde_json::Value;

use super::steps::{AgentStep, StepKind, from_claude};
use crate::git::errors::{GitError, GitResult};

const MAX_SESSIONS: usize = 60;
const MAX_STEPS: usize = 4_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub started_at: Option<String>,
    pub updated_at: Option<String>,
    pub prompts: u32,
    pub tool_calls: u32,
    pub git_branch: Option<String>,
}

/// Claude Code names a project folder after its path, every non-alphanumeric character becoming `-`.
fn encode(repo: &Path) -> String {
    repo.to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

pub(super) fn projects_root() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(Path::new(&home).join(".claude/projects"))
}

fn projects_dir(repo: &Path) -> Option<PathBuf> {
    Some(projects_root()?.join(encode(repo)))
}

pub(super) fn session_file(repo: &Path, id: &str) -> GitResult<PathBuf> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !valid {
        return Err(GitError::invalid("Invalid session id."));
    }
    let dir = projects_dir(repo).ok_or_else(|| GitError::invalid("HOME is not set."))?;
    Ok(dir.join(format!("{id}.jsonl")))
}

fn read_from(path: &Path, offset: u64) -> (Vec<Value>, u64) {
    read_lines(path, offset)
}

/// Parses the complete lines appended since `offset`; returns the events and the new offset.
/// A line still being written (no trailing newline yet) is left for the next read.
pub(super) fn read_lines<T: serde::de::DeserializeOwned>(
    path: &Path,
    offset: u64,
) -> (Vec<T>, u64) {
    let Ok(mut file) = File::open(path) else {
        return (Vec::new(), offset);
    };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let start = if len < offset { 0 } else { offset }; // truncated or replaced: start over
    if file.seek(SeekFrom::Start(start)).is_err() {
        return (Vec::new(), offset);
    }
    let mut bytes = Vec::new();
    if file.take(len - start).read_to_end(&mut bytes).is_err() {
        return (Vec::new(), offset);
    }
    let complete = bytes.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
    let events = bytes[..complete]
        .split(|&b| b == b'\n')
        .filter_map(|line| serde_json::from_slice(line).ok())
        .collect();
    (events, start + complete as u64)
}

/// Running summary of one session file, fed with each new event.
#[derive(Clone)]
struct Summary {
    data: SessionSummary,
    first_prompt: Option<String>,
    offset: u64,
}

impl Summary {
    fn new(id: String) -> Self {
        let data = SessionSummary {
            id,
            title: String::new(),
            started_at: None,
            updated_at: None,
            prompts: 0,
            tool_calls: 0,
            git_branch: None,
        };
        Summary {
            data,
            first_prompt: None,
            offset: 0,
        }
    }

    fn feed(&mut self, event: &Value) {
        let d = &mut self.data;
        if let Some(ts) = event.get("timestamp").and_then(Value::as_str) {
            d.started_at.get_or_insert_with(|| ts.to_string());
            d.updated_at = Some(ts.to_string());
        }
        if let Some(title) = event.get("aiTitle").and_then(Value::as_str) {
            d.title = title.to_string();
        }
        if d.git_branch.is_none() {
            d.git_branch = event
                .get("gitBranch")
                .and_then(Value::as_str)
                .map(str::to_string);
        }
        for step in from_claude(event) {
            match step.kind {
                StepKind::Prompt => {
                    d.prompts += 1;
                    self.first_prompt.get_or_insert(step.title);
                }
                StepKind::Tool => d.tool_calls += 1,
                _ => {}
            }
        }
    }

    fn view(&self) -> SessionSummary {
        let mut data = self.data.clone();
        if data.title.is_empty() {
            data.title = self
                .first_prompt
                .clone()
                .unwrap_or_else(|| "Untitled session".into());
        }
        data
    }
}

#[cfg(test)]
fn summarize(path: &Path, id: String) -> SessionSummary {
    let mut summary = Summary::new(id);
    let (events, _) = read_from(path, 0);
    events.iter().for_each(|e| summary.feed(e));
    summary.view()
}

type Cache<T> = Mutex<HashMap<PathBuf, T>>;

/// Sessions can weigh tens of megabytes and keep growing while in use: each refresh only parses
/// what was appended since the previous one.
fn summaries() -> &'static Cache<Summary> {
    static CACHE: OnceLock<Cache<Summary>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

fn timelines() -> &'static Cache<(u64, Vec<AgentStep>)> {
    static CACHE: OnceLock<Cache<(u64, Vec<AgentStep>)>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

pub fn list_sessions(repo: &Path) -> GitResult<Vec<SessionSummary>> {
    let Some(dir) = projects_dir(repo) else {
        return Ok(Vec::new());
    };
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut files: Vec<(SystemTime, PathBuf)> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
        .filter_map(|p| Some((fs::metadata(&p).ok()?.modified().ok()?, p)))
        .collect();
    files.sort_by_key(|f| std::cmp::Reverse(f.0));
    files.truncate(MAX_SESSIONS);
    Ok(files
        .into_iter()
        .map(|(_, path)| {
            let id = path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            let mut cache = summaries().lock().unwrap_or_else(|e| e.into_inner());
            let summary = cache
                .entry(path.clone())
                .or_insert_with(|| Summary::new(id));
            let (events, offset) = read_from(&path, summary.offset);
            if offset < summary.offset {
                *summary = Summary::new(summary.data.id.clone()); // file was rewritten
            }
            events.iter().for_each(|e| summary.feed(e));
            summary.offset = offset;
            summary.view()
        })
        .collect())
}

/// The session as a timeline, without sub-agent chatter; capped for very long sessions.
pub fn session_steps(repo: &Path, id: &str) -> GitResult<Vec<AgentStep>> {
    let path = session_file(repo, id)?;
    if !path.is_file() {
        return Err(GitError::invalid("This session no longer exists."));
    }
    let mut cache = timelines().lock().unwrap_or_else(|e| e.into_inner());
    let (offset, steps) = cache.entry(path.clone()).or_insert_with(|| (0, Vec::new()));
    let (events, next) = read_from(&path, *offset);
    if next < *offset {
        steps.clear();
    }
    *offset = next;
    let fresh = events
        .iter()
        .filter(|e| {
            !e.get("isSidechain")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .flat_map(from_claude);
    steps.extend(fresh);
    if steps.len() > MAX_STEPS {
        steps.drain(..steps.len() - MAX_STEPS); // keep the most recent part of very long sessions
    }
    Ok(steps.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_folders_encode_every_separator() {
        assert_eq!(encode(Path::new("/Users/me/my.app")), "-Users-me-my-app");
    }

    #[test]
    fn session_ids_cannot_escape_the_folder() {
        assert!(session_file(Path::new("/tmp/x"), "../../etc/passwd").is_err());
    }

    #[test]
    fn summaries_count_prompts_and_tools() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("s.jsonl");
        fs::write(
            &file,
            concat!(
                r#"{"type":"user","timestamp":"t1","message":{"content":"Fix the bug"}}"#, "\n",
                r#"{"type":"assistant","timestamp":"t2","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"a.rs"}}]}}"#, "\n",
                r#"{"type":"ai-title","aiTitle":"Bug fix"}"#, "\n",
            ),
        )
        .unwrap();
        let s = summarize(&file, "s".into());
        assert_eq!(
            (
                s.title.as_str(),
                s.prompts,
                s.tool_calls,
                s.updated_at.as_deref()
            ),
            ("Bug fix", 1, 1, Some("t2"))
        );
    }

    #[test]
    fn appended_lines_are_read_from_where_the_last_read_stopped() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("s.jsonl");
        fs::write(&file, "{\"a\":1}\n{\"b\":").unwrap();
        let (first, offset) = read_from(&file, 0);
        let mut f = fs::OpenOptions::new().append(true).open(&file).unwrap();
        std::io::Write::write_all(&mut f, b"2}\n").unwrap();
        let (second, _) = read_from(&file, offset);
        assert_eq!((first.len(), second[0]["b"].as_i64()), (1, Some(2)));
    }
}
