//! The editor's file access: listing, reading and saving files of the working tree, never outside it.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use super::errors::{ErrorKind, GitError, GitResult};
use super::runner::{RunOptions, git, git_with};
use super::validate;

/// Larger files open read-only-ish: the editor shows a notice instead of loading megabytes of text.
const MAX_EDIT_BYTES: u64 = 5 * 1024 * 1024;

fn io(err: std::io::Error) -> GitError {
    GitError::new(ErrorKind::Io, err.to_string())
}

/// Every file of the working tree git knows or would add: tracked and untracked, `.gitignore` respected.
pub fn list_files(repo: &Path) -> GitResult<Vec<String>> {
    let split = |out: Vec<u8>| -> Vec<String> {
        out.split(|b| *b == 0)
            .filter(|s| !s.is_empty())
            .map(|s| String::from_utf8_lossy(s).into_owned())
            .collect()
    };
    let deleted: std::collections::HashSet<String> =
        split(git(repo, &["ls-files", "--deleted", "-z"])?)
            .into_iter()
            .collect();
    let mut files: Vec<String> = split(git(
        repo,
        &[
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
    )?)
    .into_iter()
    .filter(|f| !deleted.contains(f))
    .collect();
    files.sort_unstable();
    files.dedup();
    Ok(files)
}

/// The absolute path of a repository file, refused when it (or a symlink on the way) leads outside the
/// working tree or into `.git`.
fn resolve(repo: &Path, path: &str) -> GitResult<PathBuf> {
    let rel = validate::relative_path(path)?;
    let root = repo.canonicalize().map_err(io)?;
    let full = root.join(rel);
    let real = match full.canonicalize() {
        Ok(real) => real,
        Err(_) => {
            let parent = full
                .parent()
                .ok_or_else(|| GitError::invalid("Invalid file path."))?;
            let name = full
                .file_name()
                .ok_or_else(|| GitError::invalid("Invalid file path."))?;
            parent.canonicalize().map_err(io)?.join(name)
        }
    };
    if !real.starts_with(&root) || real.starts_with(root.join(".git")) {
        return Err(GitError::invalid("This file is outside the repository."));
    }
    Ok(full)
}

fn mtime(path: &Path) -> GitResult<u64> {
    let modified = fs::metadata(path).and_then(|m| m.modified()).map_err(io)?;
    Ok(modified
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFile {
    /// None for binary or too large files.
    pub content: Option<String>,
    /// Modification time when read, in ms: saving checks nobody changed the file since.
    pub mtime: u64,
    pub binary: bool,
    pub too_large: bool,
}

pub fn read_file(repo: &Path, path: &str) -> GitResult<EditorFile> {
    let full = resolve(repo, path)?;
    let size = fs::metadata(&full).map_err(io)?.len();
    let mtime = mtime(&full)?;
    if size > MAX_EDIT_BYTES {
        return Ok(EditorFile {
            content: None,
            mtime,
            binary: false,
            too_large: true,
        });
    }
    let bytes = fs::read(&full).map_err(io)?;
    let binary = bytes.iter().take(8000).any(|b| *b == 0);
    let content = if binary {
        None
    } else {
        String::from_utf8(bytes).ok()
    };
    Ok(EditorFile {
        binary: content.is_none(),
        content,
        mtime,
        too_large: false,
    })
}

/// Saves a file atomically (temporary file, then rename) and returns its new modification time. When
/// `expected_mtime` is given and the file changed since, nothing is written.
pub fn write_file(
    repo: &Path,
    path: &str,
    content: &str,
    expected_mtime: Option<u64>,
) -> GitResult<u64> {
    let full = resolve(repo, path)?;
    if content.len() as u64 > MAX_EDIT_BYTES {
        return Err(GitError::invalid(
            "This file is too large to save from the editor.",
        ));
    }
    let existing = fs::metadata(&full).ok();
    let changed = match expected_mtime {
        Some(expected) if existing.is_some() => mtime(&full)? != expected,
        _ => false,
    };
    if changed {
        return Err(GitError::new(
            ErrorKind::ChangedOnDisk,
            format!("{path} changed on disk since it was opened."),
        ));
    }
    let name = full
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let tmp = full.with_file_name(format!(".{name}.gitflow-save"));
    fs::write(&tmp, content).map_err(io)?;
    if let Some(meta) = existing {
        fs::set_permissions(&tmp, meta.permissions()).map_err(io)?;
    }
    fs::rename(&tmp, &full).map_err(|err| {
        let _ = fs::remove_file(&tmp);
        io(err)
    })?;
    mtime(&full)
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
}

/// Lines that differ from HEAD, for the editor's gutter. `start..=end` are 1-based lines of the file on disk;
/// a deletion sits at the line after which lines went missing.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct LineChange {
    pub kind: ChangeKind,
    pub start: u32,
    pub end: u32,
}

fn parse_hunks(diff: &str) -> Vec<LineChange> {
    let range = |s: &str| -> (u32, u32) {
        let mut parts = s.splitn(2, ',');
        let start = parts.next().and_then(|n| n.parse().ok()).unwrap_or(0);
        let count = parts.next().map_or(1, |n| n.parse().unwrap_or(1));
        (start, count)
    };
    diff.lines()
        .filter_map(|line| line.strip_prefix("@@ -"))
        .filter_map(|rest| {
            let mut parts = rest.split(' ');
            let (_, old) = range(parts.next()?);
            let (start, new) = range(parts.next()?.strip_prefix('+')?);
            Some(match (old, new) {
                (_, 0) => LineChange {
                    kind: ChangeKind::Deleted,
                    start: start.max(1),
                    end: start.max(1),
                },
                (0, n) => LineChange {
                    kind: ChangeKind::Added,
                    start,
                    end: start + n - 1,
                },
                (_, n) => LineChange {
                    kind: ChangeKind::Modified,
                    start,
                    end: start + n - 1,
                },
            })
        })
        .collect()
}

pub fn line_changes(repo: &Path, path: &str) -> GitResult<Vec<LineChange>> {
    let full = resolve(repo, path)?;
    let rel = validate::relative_path(path)?;
    let tracked = git(repo, &["ls-files", "--error-unmatch", "--", rel]).is_ok();
    if !tracked {
        let lines = fs::read_to_string(&full)
            .map(|s| s.lines().count() as u32)
            .unwrap_or(0);
        return Ok(if lines == 0 {
            vec![]
        } else {
            vec![LineChange {
                kind: ChangeKind::Added,
                start: 1,
                end: lines,
            }]
        });
    }
    // No HEAD yet (fresh repository): nothing to compare with.
    let Ok(diff) = git(
        repo,
        &[
            "diff",
            "--no-color",
            "--no-ext-diff",
            "-U0",
            "HEAD",
            "--",
            rel,
        ],
    ) else {
        return Ok(vec![]);
    };
    Ok(parse_hunks(&String::from_utf8_lossy(&diff)))
}

/// Results past this many matches are dropped: a search for "e" shouldn't ship megabytes to the UI.
const MAX_MATCHES: usize = 2000;
const MAX_LINE_CHARS: usize = 400;

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct SearchMatch {
    pub path: String,
    pub line: u32,
    /// 1-based, in bytes as git counts them.
    pub column: u32,
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct SearchResults {
    pub matches: Vec<SearchMatch>,
    pub truncated: bool,
}

/// Every line of the working tree matching `query` (tracked and untracked files, `.gitignore` respected,
/// binaries skipped), through `git grep`.
pub fn search(
    repo: &Path,
    query: &str,
    regex: bool,
    case_sensitive: bool,
) -> GitResult<SearchResults> {
    if query.is_empty() || query.len() > 1000 || query.contains('\0') {
        return Err(GitError::invalid("Type something to search for."));
    }
    let mut args = vec![
        "grep",
        "-n",
        "--column",
        "-I",
        "-z",
        "--no-color",
        "--untracked",
        "--full-name",
    ];
    args.push(if regex { "-E" } else { "-F" });
    if !case_sensitive {
        args.push("-i");
    }
    args.extend(["-e", query]);
    // Exit code 1 only means "no match".
    let out = git_with(
        repo,
        &args,
        &RunOptions {
            ok_codes: &[1],
            ..RunOptions::default()
        },
    )?;
    Ok(parse_grep(&String::from_utf8_lossy(&out)))
}

/// `git grep -z -n --column` lines: `path\0line\0column\0text` (the text itself may hold anything else).
fn parse_grep(out: &str) -> SearchResults {
    let mut matches = Vec::new();
    let mut truncated = false;
    for raw in out.lines() {
        if matches.len() == MAX_MATCHES {
            truncated = true;
            break;
        }
        let mut parts = raw.splitn(4, '\0');
        let (Some(path), Some(line), Some(column), Some(text)) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let (Ok(line), Ok(column)) = (line.parse(), column.parse()) else {
            continue;
        };
        matches.push(SearchMatch {
            path: path.to_string(),
            line,
            column,
            text: text.chars().take(MAX_LINE_CHARS).collect(),
        });
    }
    SearchResults { matches, truncated }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::TestRepo;

    fn repo() -> TestRepo {
        let repo = TestRepo::new();
        repo.write("src/a.txt", "one\ntwo\nthree\n");
        repo.commit_all("init");
        repo
    }

    #[test]
    fn lists_tracked_and_untracked_files_but_not_ignored_or_deleted_ones() {
        let repo = repo();
        repo.write(".gitignore", "*.log\n");
        repo.write("new.txt", "x");
        repo.write("debug.log", "x");
        repo.write("gone.txt", "x");
        repo.commit_all("more");
        std::fs::remove_file(repo.path().join("gone.txt")).unwrap();
        assert_eq!(
            list_files(repo.path()).unwrap(),
            [".gitignore", "new.txt", "src/a.txt"]
        );
    }

    #[test]
    fn saves_only_when_the_file_is_unchanged_since_read() {
        let repo = repo();
        let read = read_file(repo.path(), "src/a.txt").unwrap();
        let saved = write_file(repo.path(), "src/a.txt", "edited\n", Some(read.mtime)).unwrap();
        let stale = write_file(repo.path(), "src/a.txt", "again\n", Some(saved + 1));
        assert!(matches!(stale, Err(e) if e.kind == ErrorKind::ChangedOnDisk));
        assert_eq!(
            std::fs::read_to_string(repo.path().join("src/a.txt")).unwrap(),
            "edited\n"
        );
    }

    #[test]
    fn refuses_paths_outside_the_working_tree() {
        let repo = repo();
        std::os::unix::fs::symlink("/etc", repo.path().join("etc")).unwrap();
        for path in ["../x", ".git/config", "etc/hosts"] {
            assert!(read_file(repo.path(), path).is_err(), "{path}");
        }
    }

    #[test]
    fn gutter_marks_added_modified_and_deleted_lines() {
        let repo = repo();
        repo.write("src/a.txt", "one\nTWO\nthree\nfour\n");
        let changes = line_changes(repo.path(), "src/a.txt").unwrap();
        assert_eq!(
            changes,
            [
                LineChange {
                    kind: ChangeKind::Modified,
                    start: 2,
                    end: 2
                },
                LineChange {
                    kind: ChangeKind::Added,
                    start: 4,
                    end: 4
                },
            ]
        );
    }

    #[test]
    fn hunks_without_new_lines_are_deletions() {
        assert_eq!(
            parse_hunks("@@ -3,2 +2,0 @@\n-a\n-b\n"),
            [LineChange {
                kind: ChangeKind::Deleted,
                start: 2,
                end: 2
            }]
        );
    }

    #[test]
    fn search_finds_lines_in_tracked_and_untracked_files() {
        let repo = repo();
        repo.write("notes.md", "Two birds\n");
        let found = search(repo.path(), "two", false, false).unwrap();
        let hits: Vec<_> = found
            .matches
            .iter()
            .map(|m| (m.path.as_str(), m.line, m.column))
            .collect();
        assert_eq!(hits, [("notes.md", 1, 1), ("src/a.txt", 2, 1)]);
    }

    #[test]
    fn search_without_matches_is_empty_not_an_error() {
        let repo = repo();
        assert!(
            search(repo.path(), "nowhere", false, true)
                .unwrap()
                .matches
                .is_empty()
        );
    }

    #[test]
    fn grep_output_keeps_colons_inside_the_text() {
        let found = parse_grep("a:b.rs\x0012\x005\x00let x = y::z;\n");
        assert_eq!(
            found.matches[0],
            SearchMatch {
                path: "a:b.rs".into(),
                line: 12,
                column: 5,
                text: "let x = y::z;".into()
            }
        );
    }
}
