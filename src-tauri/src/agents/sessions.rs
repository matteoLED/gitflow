//! Claude Code sessions saved for a repository under `~/.claude/projects/<encoded path>/*.jsonl`, and Codex
//! sessions under `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` whose working directory is the repository.
//! Read-only: the files are only ever opened for reading.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use serde::Serialize;
use serde_json::Value;

use super::steps::{AgentStep, StepKind, from_claude, from_codex_rollout};
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
    /// "claude" or "codex": which CLI resumes it.
    pub agent: &'static str,
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

fn check_id(id: &str) -> GitResult<()> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if valid {
        Ok(())
    } else {
        Err(GitError::invalid("Invalid session id."))
    }
}

pub(super) fn session_file(repo: &Path, id: &str) -> GitResult<PathBuf> {
    check_id(id)?;
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
            agent: "claude",
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

    fn feed_codex(&mut self, event: &Value) {
        let d = &mut self.data;
        if let Some(ts) = event.get("timestamp").and_then(Value::as_str) {
            d.started_at.get_or_insert_with(|| ts.to_string());
            d.updated_at = Some(ts.to_string());
        }
        for step in from_codex_rollout(event) {
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

/// Claude Code's sessions only, latest first (the agents sidebar lists them under its name).
pub fn list_sessions(repo: &Path) -> GitResult<Vec<SessionSummary>> {
    let mut files = claude_files(repo);
    files.sort_by_key(|f| std::cmp::Reverse(f.0));
    Ok(files
        .into_iter()
        .take(MAX_SESSIONS)
        .map(|(_, path)| session_summary(path))
        .collect())
}

/// One page of the repository's sessions, Claude Code's and Codex's, latest first: only that page's files are
/// read, so scrolling far back stays cheap. Fewer than `limit` means there are no more.
pub fn list_sessions_page(
    repo: &Path,
    offset: usize,
    limit: usize,
) -> GitResult<Vec<SessionSummary>> {
    let mut files: Vec<(SystemTime, PathBuf, bool)> = claude_files(repo)
        .into_iter()
        .map(|(t, p)| (t, p, false))
        .chain(codex_files(repo).into_iter().map(|(t, p)| (t, p, true)))
        .collect();
    files.sort_by_key(|f| std::cmp::Reverse(f.0));
    Ok(files
        .into_iter()
        .skip(offset)
        .take(limit.min(200))
        .map(|(_, path, codex)| {
            if codex {
                codex_summary(&path)
            } else {
                session_summary(path)
            }
        })
        .collect())
}

fn with_mtime(paths: impl Iterator<Item = PathBuf>) -> Vec<(SystemTime, PathBuf)> {
    paths
        .filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
        .filter_map(|p| Some((fs::metadata(&p).ok()?.modified().ok()?, p)))
        .collect()
}

fn claude_files(repo: &Path) -> Vec<(SystemTime, PathBuf)> {
    let Some(entries) = projects_dir(repo).and_then(|d| fs::read_dir(d).ok()) else {
        return Vec::new();
    };
    with_mtime(entries.filter_map(Result::ok).map(|e| e.path()))
}

fn codex_root() -> Option<PathBuf> {
    Some(Path::new(&std::env::var_os("HOME")?).join(".codex/sessions"))
}

/// Every Codex session file, any project: three levels of date folders.
/// When the session folders were last walked, and what was found.
type Walk = (std::time::Instant, Vec<PathBuf>);

fn codex_all() -> Vec<PathBuf> {
    // Every page of the history and every opened session asks: the folder walk is reused for a few seconds.
    static CACHE: OnceLock<Mutex<Option<Walk>>> = OnceLock::new();
    let mut cache = CACHE
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some((at, paths)) = cache.as_ref()
        && at.elapsed() < std::time::Duration::from_secs(10)
    {
        return paths.clone();
    }
    let paths = walk_codex();
    *cache = Some((std::time::Instant::now(), paths.clone()));
    paths
}

fn walk_codex() -> Vec<PathBuf> {
    let mut dirs = codex_root().into_iter().collect::<Vec<_>>();
    for _ in 0..3 {
        dirs = dirs
            .iter()
            .filter_map(|d| fs::read_dir(d).ok())
            .flat_map(|e| e.filter_map(Result::ok).map(|e| e.path()))
            .filter(|p| p.is_dir())
            .collect();
    }
    dirs.iter()
        .filter_map(|d| fs::read_dir(d).ok())
        .flat_map(|e| e.filter_map(Result::ok).map(|e| e.path()))
        .collect()
}

/// The session's first line says where it ran (and whether it's a sub-agent's): read once per file.
/// A first line not written yet isn't remembered, so a session just started shows up on the next listing.
fn codex_meta(path: &Path) -> Option<(String, String)> {
    static CACHE: OnceLock<Cache<Option<(String, String)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some(known) = cache.lock().unwrap_or_else(|e| e.into_inner()).get(path) {
        return known.clone();
    }
    let meta = read_codex_meta(path)?;
    cache
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(path.to_path_buf(), meta.clone());
    meta
}

/// None while the first line can't be read yet; Some(None) for a sub-agent's session.
fn read_codex_meta(path: &Path) -> Option<Option<(String, String)>> {
    let mut line = String::new();
    BufReader::new(File::open(path).ok()?)
        .read_line(&mut line)
        .ok()?;
    if !line.ends_with('\n') {
        return None;
    }
    let meta: Value = serde_json::from_str(&line).ok()?;
    let payload = meta.get("payload")?;
    let sub_agent = payload.get("thread_source").and_then(Value::as_str) == Some("subagent")
        || payload.pointer("/source/subagent").is_some();
    let id = payload.get("id")?.as_str()?.to_string();
    let cwd = payload.get("cwd")?.as_str()?.to_string();
    Some((!sub_agent).then_some((id, cwd)))
}

fn codex_files(repo: &Path) -> Vec<(SystemTime, PathBuf)> {
    with_mtime(
        codex_all()
            .into_iter()
            .filter(|p| codex_meta(p).is_some_and(|(_, cwd)| Path::new(&cwd) == repo)),
    )
}

fn codex_summary(path: &Path) -> SessionSummary {
    let (id, _) = codex_meta(path).unwrap_or_default();
    let mut cache = summaries().lock().unwrap_or_else(|e| e.into_inner());
    let fresh = || {
        let mut summary = Summary::new(id.clone());
        summary.data.agent = "codex";
        summary
    };
    let summary = cache.entry(path.to_path_buf()).or_insert_with(fresh);
    // Only what was appended since the last read: rollouts reach tens of megabytes.
    let (events, offset) = read_from(path, summary.offset);
    if offset < summary.offset {
        *summary = fresh();
    }
    events.iter().for_each(|e| summary.feed_codex(e));
    summary.offset = offset;
    summary.view()
}

fn session_summary(path: PathBuf) -> SessionSummary {
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
}

/// The session as a timeline, without sub-agent chatter; capped for very long sessions.
pub fn session_steps(repo: &Path, id: &str) -> GitResult<Vec<AgentStep>> {
    let path = session_file(repo, id)?;
    if !path.is_file() {
        return codex_steps(repo, id);
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

/// A Codex session of this repository, by id.
fn codex_steps(repo: &Path, id: &str) -> GitResult<Vec<AgentStep>> {
    check_id(id)?;
    let path = codex_all()
        .into_iter()
        .find(|p| codex_meta(p).is_some_and(|(i, cwd)| i == id && Path::new(&cwd) == repo))
        .ok_or_else(|| GitError::invalid("This session no longer exists."))?;
    let mut cache = timelines().lock().unwrap_or_else(|e| e.into_inner());
    let (offset, steps) = cache.entry(path.clone()).or_insert_with(|| (0, Vec::new()));
    let (events, next) = read_from(&path, *offset);
    if next < *offset {
        steps.clear();
    }
    *offset = next;
    steps.extend(events.iter().flat_map(from_codex_rollout));
    if steps.len() > MAX_STEPS {
        steps.drain(..steps.len() - MAX_STEPS);
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
