//! Token usage of Claude Code sessions, read from their transcripts (`~/.claude/projects/*/*.jsonl`).
//! Raw token counts only: prices live in the front end, next to the model names.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use super::sessions::{projects_root, read_lines, session_file};
use crate::git::errors::{GitError, GitResult};

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub input: u64,
    pub output: u64,
    pub cache_write_5m: u64,
    pub cache_write_1h: u64,
    pub cache_read: u64,
}

impl Tokens {
    fn add(&mut self, o: &Tokens) {
        self.input += o.input;
        self.output += o.output;
        self.cache_write_5m += o.cache_write_5m;
        self.cache_write_1h += o.cache_write_1h;
        self.cache_read += o.cache_read;
    }
    /// What the model had in its window for that message.
    fn context(&self) -> u64 {
        self.input + self.cache_write_5m + self.cache_write_1h + self.cache_read + self.output
    }
}

// Only the fields needed are deserialized; message contents are skipped without allocating.
#[derive(Deserialize, Default)]
#[serde(default)]
struct RawCacheCreation {
    ephemeral_5m_input_tokens: u64,
    ephemeral_1h_input_tokens: u64,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RawUsage {
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_input_tokens: u64,
    cache_read_input_tokens: u64,
    cache_creation: Option<RawCacheCreation>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RawMessage {
    id: Option<String>,
    model: Option<String>,
    usage: Option<RawUsage>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct Line {
    #[serde(rename = "type")]
    kind: String,
    timestamp: Option<String>,
    cwd: Option<String>,
    is_sidechain: bool,
    message: Option<RawMessage>,
}

fn tokens_of(u: &RawUsage) -> Tokens {
    // Older transcripts only give the total written to the cache: count it as the 5-minute kind.
    let (m5, h1) = match &u.cache_creation {
        Some(c) if c.ephemeral_5m_input_tokens + c.ephemeral_1h_input_tokens > 0 => {
            (c.ephemeral_5m_input_tokens, c.ephemeral_1h_input_tokens)
        }
        _ => (u.cache_creation_input_tokens, 0),
    };
    Tokens {
        input: u.input_tokens,
        output: u.output_tokens,
        cache_write_5m: m5,
        cache_write_1h: h1,
        cache_read: u.cache_read_input_tokens,
    }
}

#[derive(Clone)]
struct Message {
    day: String,
    model: String,
    tokens: Tokens,
}

/// One transcript, read incrementally.
#[derive(Default, Clone)]
struct FileUsage {
    offset: u64,
    project: Option<String>,
    started: Option<String>,
    /// By message id: a reply is logged once per content block, each line repeating its usage.
    messages: HashMap<String, Message>,
    /// The main conversation's latest reply (sub-agents have their own context).
    last_main: Option<(Tokens, String)>,
}

impl FileUsage {
    fn feed(&mut self, line: Line) {
        if self.project.is_none() {
            self.project = line.cwd.as_deref().map(project_name);
        }
        if self.started.is_none() {
            self.started = line.timestamp.as_deref().map(day_of);
        }
        let Some(msg) = line.message.filter(|_| line.kind == "assistant") else {
            return;
        };
        let (Some(id), Some(model), Some(usage)) = (msg.id, msg.model, msg.usage) else {
            return;
        };
        if model.starts_with('<') {
            return; // "<synthetic>": local error messages, nothing billed
        }
        let tokens = tokens_of(&usage);
        if !line.is_sidechain {
            self.last_main = Some((tokens, model.clone()));
        }
        let day = line
            .timestamp
            .as_deref()
            .map(day_of)
            .or_else(|| self.started.clone())
            .unwrap_or_default();
        self.messages.insert(id, Message { day, model, tokens });
    }
}

fn project_name(cwd: &str) -> String {
    Path::new(cwd)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| cwd.to_string())
}

/// ponytail: UTC day from the ISO timestamp; local-time days if late-evening work looks misplaced.
fn day_of(ts: &str) -> String {
    ts.get(..10).unwrap_or(ts).to_string()
}

fn cache() -> &'static Mutex<HashMap<PathBuf, FileUsage>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, FileUsage>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// The file's usage, parsing only what was appended since the last call.
fn read(path: &Path) -> FileUsage {
    let mut cache = cache().lock().unwrap_or_else(|e| e.into_inner());
    let usage = cache.entry(path.to_path_buf()).or_default();
    let (lines, next) = read_lines::<Line>(path, usage.offset);
    if next < usage.offset {
        *usage = FileUsage::default(); // rewritten
    }
    usage.offset = next;
    lines.into_iter().for_each(|l| usage.feed(l));
    usage.clone()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTokens {
    pub model: String,
    pub tokens: Tokens,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsage {
    /// Tokens in the window at the latest reply, and the model that produced it.
    pub context_tokens: Option<u64>,
    pub model: Option<String>,
    pub by_model: Vec<ModelTokens>,
}

fn by_model<'a>(messages: impl Iterator<Item = &'a Message>) -> Vec<ModelTokens> {
    let mut totals: HashMap<&str, Tokens> = HashMap::new();
    for m in messages {
        totals.entry(&m.model).or_default().add(&m.tokens);
    }
    let mut out: Vec<_> = totals
        .into_iter()
        .map(|(model, tokens)| ModelTokens {
            model: model.to_string(),
            tokens,
        })
        .collect();
    out.sort_by(|a, b| a.model.cmp(&b.model));
    out
}

pub fn session_usage(repo: &Path, id: &str) -> GitResult<SessionUsage> {
    let path = session_file(repo, id)?;
    if !path.is_file() {
        return Err(GitError::invalid("This session no longer exists."));
    }
    let usage = read(&path);
    Ok(SessionUsage {
        context_tokens: usage.last_main.as_ref().map(|(t, _)| t.context()),
        model: usage.last_main.map(|(_, m)| m),
        by_model: by_model(usage.messages.values()),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRow {
    pub day: String,
    pub project: String,
    pub model: String,
    pub messages: u32,
    pub tokens: Tokens,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDay {
    pub project: String,
    pub day: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStats {
    pub rows: Vec<UsageRow>,
    pub sessions: Vec<SessionDay>,
}

fn aggregate(files: &[FileUsage]) -> UsageStats {
    let mut rows: HashMap<(String, String, String), UsageRow> = HashMap::new();
    let mut sessions = Vec::new();
    for file in files {
        let project = file.project.clone().unwrap_or_else(|| "?".into());
        if let Some(day) = &file.started {
            sessions.push(SessionDay {
                project: project.clone(),
                day: day.clone(),
            });
        }
        for m in file.messages.values() {
            let key = (m.day.clone(), project.clone(), m.model.clone());
            let row = rows.entry(key).or_insert_with(|| UsageRow {
                day: m.day.clone(),
                project: project.clone(),
                model: m.model.clone(),
                messages: 0,
                tokens: Tokens::default(),
            });
            row.messages += 1;
            row.tokens.add(&m.tokens);
        }
    }
    let mut rows: Vec<_> = rows.into_values().collect();
    rows.sort_by(|a, b| (&a.day, &a.project, &a.model).cmp(&(&b.day, &b.project, &b.model)));
    UsageStats { rows, sessions }
}

/// Every Claude Code session on this machine (all projects), by day, project and model.
pub fn usage_stats() -> GitResult<UsageStats> {
    let Some(root) = projects_root() else {
        return Ok(aggregate(&[]));
    };
    let files: Vec<FileUsage> = fs::read_dir(&root)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|dir| fs::read_dir(dir.path()).ok())
        .flatten()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
        .map(|p| read(&p))
        .collect();
    Ok(aggregate(&files))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usage_of(lines: &str) -> FileUsage {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("s.jsonl");
        fs::write(&file, lines).unwrap();
        read(&file)
    }

    const REPLY: &str = r#"{"type":"assistant","timestamp":"2026-11-09T10:00:00Z","cwd":"/w/app","message":{"id":"m1","model":"claude-opus-4-8","content":[{"type":"text","text":"hi"}],"usage":{"input_tokens":2,"output_tokens":10,"cache_creation_input_tokens":100,"cache_read_input_tokens":50,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":100}}}}"#;

    #[test]
    fn a_reply_split_over_several_lines_is_counted_once() {
        let usage = usage_of(&format!("{REPLY}\n{REPLY}\n"));
        let stats = aggregate(&[usage]);
        assert_eq!(
            (
                stats.rows.len(),
                stats.rows[0].messages,
                stats.rows[0].tokens.cache_write_1h
            ),
            (1, 1, 100)
        );
    }

    #[test]
    fn context_is_the_latest_main_reply() {
        let side = REPLY
            .replace("\"m1\"", "\"m2\"")
            .replace("\"cwd\"", "\"isSidechain\":true,\"cwd\"");
        let usage = usage_of(&format!("{REPLY}\n{side}\n"));
        let (tokens, model) = usage.last_main.unwrap();
        assert_eq!((tokens.context(), model.as_str()), (162, "claude-opus-4-8"));
    }

    #[test]
    fn rows_are_keyed_by_day_project_and_model() {
        let stats = aggregate(&[usage_of(&format!("{REPLY}\n"))]);
        let row = &stats.rows[0];
        assert_eq!(
            (row.day.as_str(), row.project.as_str(), stats.sessions.len()),
            ("2026-11-09", "app", 1)
        );
    }
}
