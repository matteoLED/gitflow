//! Line authorship (`git blame --porcelain`) and a file's history (`git log --follow`), for the editor.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use super::errors::{ErrorKind, GitError, GitResult};
use super::runner::{gh, git, git_text};
use super::validate;

/// Consecutive lines last changed by one commit. Uncommitted lines have an all-zero `sha`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameHunk {
    /// 1-based line in the working-tree file.
    pub start_line: u32,
    pub lines: u32,
    pub sha: String,
    pub author: String,
    /// Unix seconds.
    pub author_time: i64,
    pub summary: String,
}

/// A commit touching the file, with the file's path in that commit (it may have been renamed since).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCommit {
    pub hash: String,
    pub author: String,
    pub author_email: String,
    pub authored_at: String,
    pub subject: String,
    pub path: String,
    pub previous_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommitPullRequest {
    pub number: u32,
    pub title: String,
    pub url: String,
}

const MAX_HISTORY: &str = "--max-count=300";
/// RS before each record, NUL between fields; with `-z` the name-status tokens follow the subject.
const HISTORY_FORMAT: &str = "--format=%x1e%H%x00%an%x00%ae%x00%aI%x00%s";

/// What a working-tree blame depends on: the history up to HEAD and the file's content.
type BlameKey = (PathBuf, String, String, SystemTime, u64);

/// The watcher re-asks for the open file's blame on every change anywhere in the tree, and blaming a
/// long file takes hundreds of milliseconds: it is reused while HEAD and the file stay the same.
fn blame_cache() -> &'static Mutex<HashMap<BlameKey, Vec<BlameHunk>>> {
    static CACHE: OnceLock<Mutex<HashMap<BlameKey, Vec<BlameHunk>>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

fn blame_key(repo: &Path, path: &str) -> Option<BlameKey> {
    let meta = std::fs::metadata(repo.join(path)).ok()?;
    let head = git_text(repo, &["rev-parse", "--verify", "--quiet", "HEAD"]).ok()?;
    let head = head.trim().to_string();
    Some((
        repo.to_path_buf(),
        path.to_string(),
        head,
        meta.modified().ok()?,
        meta.len(),
    ))
}

pub fn blame_file(repo: &Path, path: &str) -> GitResult<Vec<BlameHunk>> {
    let path = validate::relative_path(path)?;
    let key = blame_key(repo, path);
    let cache = blame_cache();
    if let Some(hit) = key
        .as_ref()
        .and_then(|k| cache.lock().ok()?.get(k).cloned())
    {
        return Ok(hit);
    }
    let out = git(repo, &["blame", "--porcelain", "--", path])?;
    let hunks = parse_blame(&String::from_utf8_lossy(&out));
    if let (Some(key), Ok(mut cache)) = (key, cache.lock()) {
        if cache.len() >= 32 {
            cache.clear(); // ponytail: wholesale eviction, an LRU if switching between many files matters
        }
        cache.insert(key, hunks.clone());
    }
    Ok(hunks)
}

pub fn file_history(repo: &Path, path: &str) -> GitResult<Vec<FileCommit>> {
    let path = validate::relative_path(path)?;
    let args = [
        "log",
        "--follow",
        "-z",
        "--name-status",
        HISTORY_FORMAT,
        MAX_HISTORY,
        "--end-of-options",
        "HEAD",
        "--",
        path,
    ];
    Ok(parse_history(&git(repo, &args)?, path))
}

/// The pull request that introduced a commit, if GitHub knows one. `None` when there's none.
pub fn commit_pull_request(repo: &Path, sha: &str) -> GitResult<Option<CommitPullRequest>> {
    let sha = validate::object_id(sha)?;
    let endpoint = format!("repos/{{owner}}/{{repo}}/commits/{sha}/pulls");
    let jq = "[.[] | {number, title, url: .html_url}][0]";
    let gh_path = super::github::require_gh()?;
    let out = gh(
        &gh_path,
        repo,
        &["api", "--cache", "24h", &endpoint, "--jq", jq],
    )?;
    serde_json::from_slice(&out)
        .map_err(|err| GitError::new(ErrorKind::Io, format!("Unexpected answer from gh: {err}")))
}

type CommitInfo = (String, i64, String);

/// Parses `git blame --porcelain`. Commit details come once, after the first group of each commit.
pub fn parse_blame(text: &str) -> Vec<BlameHunk> {
    let mut hunks: Vec<BlameHunk> = Vec::new();
    let mut infos: HashMap<String, CommitInfo> = HashMap::new();
    let mut current: Option<String> = None;
    for line in text.lines() {
        if line.starts_with('\t') {
            continue;
        }
        let mut words = line.split(' ');
        let first = words.next().unwrap_or_default();
        if is_sha(first) {
            let rest: Vec<u32> = words.filter_map(|w| w.parse().ok()).collect();
            if let [_, start, count] = rest[..] {
                push_hunk(&mut hunks, first, start, count);
            }
            current = Some(first.to_string());
            continue;
        }
        let Some(sha) = &current else { continue };
        let info = infos.entry(sha.clone()).or_default();
        let value = line.split_once(' ').map(|(_, v)| v).unwrap_or_default();
        match first {
            "author" => info.0 = value.to_string(),
            "author-time" => info.1 = value.parse().unwrap_or_default(),
            "summary" => info.2 = value.to_string(),
            _ => {}
        }
    }
    for hunk in &mut hunks {
        if let Some((author, time, summary)) = infos.get(&hunk.sha) {
            hunk.author = author.clone();
            hunk.author_time = *time;
            hunk.summary = summary.clone();
        }
    }
    hunks
}

fn is_sha(word: &str) -> bool {
    matches!(word.len(), 40 | 64) && word.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Adjacent groups of the same commit read as one hunk.
fn push_hunk(hunks: &mut Vec<BlameHunk>, sha: &str, start: u32, count: u32) {
    if let Some(last) = hunks.last_mut()
        && last.sha == sha
        && last.start_line + last.lines == start
    {
        last.lines += count;
        return;
    }
    hunks.push(BlameHunk {
        start_line: start,
        lines: count,
        sha: sha.to_string(),
        author: String::new(),
        author_time: 0,
        summary: String::new(),
    });
}

/// Parses [`HISTORY_FORMAT`] with `-z --name-status`; `fallback` is the path when a record lists none (merges).
pub fn parse_history(bytes: &[u8], fallback: &str) -> Vec<FileCommit> {
    String::from_utf8_lossy(bytes)
        .split('\x1e')
        .filter_map(|record| {
            let mut fields = record.split('\0');
            let mut next = || fields.next().map(str::to_string);
            let (hash, author, author_email, authored_at, subject) =
                (next()?, next()?, next()?, next()?, next()?);
            let names: Vec<String> = fields
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .map(String::from)
                .collect();
            let renamed = names
                .first()
                .is_some_and(|code| code.starts_with(['R', 'C']));
            let (path, previous_path) = match (renamed, names.get(1), names.get(2)) {
                (true, Some(old), Some(new)) => (new.clone(), Some(old.clone())),
                (false, Some(path), _) => (path.clone(), None),
                _ => (fallback.to_string(), None),
            };
            Some(FileCommit {
                hash,
                author,
                author_email,
                authored_at,
                subject,
                path,
                previous_path,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::TestRepo;

    const A: &str = "4414d301e6f8f19421d2d45b6ad5d46add717dbe";
    const ZERO: &str = "0000000000000000000000000000000000000000";

    #[test]
    fn porcelain_groups_reuse_commit_details_and_merge_adjacent_lines() {
        let text = format!(
            "{A} 1 1 2\nauthor Ana Lima\nauthor-time 1700000000\nsummary first commit\nfilename a.txt\n\ta\n\
             {A} 2 2\n\tb\n{ZERO} 3 3 1\nauthor Not Committed Yet\nauthor-time 1800000000\nsummary Version\n\
             filename a.txt\n\tnew\n{A} 4 4 1\nfilename a.txt\n\tz\n"
        );
        let hunks = parse_blame(&text);
        assert_eq!(
            hunks
                .iter()
                .map(|h| (h.start_line, h.lines, h.author.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (1, 2, "Ana Lima"),
                (3, 1, "Not Committed Yet"),
                (4, 1, "Ana Lima")
            ]
        );
    }

    #[test]
    fn history_reads_renames_and_plain_entries() {
        let bytes = b"\x1eh2\0Ana\0a@x\x002024-01-01\0move\0\nR100\0old.txt\0new.txt\0\x1eh1\0Ana\0a@x\x002024-01-01\0add\0\nA\0old.txt\0";
        let history = parse_history(bytes, "new.txt");
        assert_eq!(
            history
                .iter()
                .map(|c| (c.path.as_str(), c.previous_path.as_deref()))
                .collect::<Vec<_>>(),
            vec![("new.txt", Some("old.txt")), ("old.txt", None)]
        );
    }

    #[test]
    fn blame_and_history_follow_a_real_repository() {
        let repo = TestRepo::new();
        repo.write("x.txt", "a\nb\n");
        let first = repo.commit_all("one");
        repo.git(&["mv", "x.txt", "y z.txt"]);
        repo.commit_all("two");
        repo.write("y z.txt", "a\nb\nc\n");
        repo.commit_all("three");
        repo.write("y z.txt", "a\nb\nc\nnew\n");

        let hunks = blame_file(repo.path(), "y z.txt").unwrap();
        assert_eq!(hunks[0].sha, first);
        assert_eq!(hunks[0].lines, 2);
        assert_eq!(hunks[1].summary, "three");
        assert!(hunks[2].sha.bytes().all(|b| b == b'0'));

        let history = file_history(repo.path(), "y z.txt").unwrap();
        let subjects: Vec<&str> = history.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(subjects, vec!["three", "two", "one"]);
        assert_eq!(history[2].path, "x.txt");
    }

    #[test]
    fn a_cached_blame_is_redone_after_a_commit() {
        let repo = TestRepo::new();
        repo.write("a.txt", "a\n");
        repo.commit_all("one");
        repo.write("a.txt", "a\nb\n");
        blame_file(repo.path(), "a.txt").unwrap(); // cached with "b" uncommitted
        repo.commit_all("two");
        let hunks = blame_file(repo.path(), "a.txt").unwrap();
        assert_eq!(hunks.last().unwrap().summary, "two");
    }

    #[test]
    fn paths_cannot_escape_the_repository() {
        let repo = TestRepo::new();
        assert!(blame_file(repo.path(), "../etc/passwd").is_err());
        assert!(file_history(repo.path(), "/etc/passwd").is_err());
    }
}
