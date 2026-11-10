//! The editor's file access: listing, reading and saving files of the working tree, never outside it.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use regex::{NoExpand, Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

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

/// How a query matches, shared by the search and the replace so both see the same occurrences.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchOptions {
    pub regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
}

fn grep_args<'a>(query: &'a str, opts: MatchOptions, extra: &[&'a str]) -> GitResult<Vec<&'a str>> {
    if query.is_empty() || query.len() > 1000 || query.contains('\0') {
        return Err(GitError::invalid("Type something to search for."));
    }
    let mut args = vec![
        "grep",
        "-I",
        "-z",
        "--no-color",
        "--untracked",
        "--full-name",
    ];
    args.extend(extra);
    args.push(if opts.regex { "-E" } else { "-F" });
    if !opts.case_sensitive {
        args.push("-i");
    }
    if opts.whole_word {
        args.push("-w");
    }
    args.extend(["-e", query]);
    Ok(args)
}

/// `git grep`, where exit code 1 only means "no match".
fn grep(repo: &Path, args: &[&str]) -> GitResult<Vec<u8>> {
    git_with(
        repo,
        args,
        &RunOptions {
            ok_codes: &[1],
            ..RunOptions::default()
        },
    )
}

/// Every line of the working tree matching `query` (tracked and untracked files, `.gitignore` respected,
/// binaries skipped), through `git grep`.
pub fn search(repo: &Path, query: &str, opts: MatchOptions) -> GitResult<SearchResults> {
    let out = grep(repo, &grep_args(query, opts, &["-n", "--column"])?)?;
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceRequest {
    pub query: String,
    pub replacement: String,
    #[serde(flatten)]
    pub opts: MatchOptions,
    /// The files to change; every matching file when absent.
    pub paths: Option<Vec<String>>,
    /// Only this 1-based line (of the single file in `paths`).
    pub line: Option<u32>,
    /// Files with unsaved edits in the editor: never written behind the user's back.
    #[serde(default)]
    pub skip: Vec<String>,
}

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceOutcome {
    pub files: u32,
    pub replacements: u32,
}

/// The query as a Rust regex. `git grep -E` is POSIX ERE: the common syntax behaves the same.
fn matcher(query: &str, opts: MatchOptions) -> GitResult<Regex> {
    let pattern = if opts.regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let pattern = if opts.whole_word {
        format!(r"\b(?:{pattern})\b")
    } else {
        pattern
    };
    let re = RegexBuilder::new(&pattern)
        .case_insensitive(!opts.case_sensitive)
        .size_limit(1 << 20)
        .build()
        .map_err(|err| GitError::invalid(format!("Invalid regular expression: {err}")))?;
    if re.is_match("") {
        return Err(GitError::invalid(
            "This pattern also matches empty text: make it more specific.",
        ));
    }
    Ok(re)
}

/// Replaces line by line, like git grep matches (a match never spans lines); only `only_line` when given.
fn replace_lines(
    text: &str,
    re: &Regex,
    replacement: &str,
    expand: bool,
    only_line: Option<u32>,
) -> (String, u32) {
    let mut out = String::with_capacity(text.len());
    let mut count = 0;
    for (i, line) in text.split_inclusive('\n').enumerate() {
        let body = line.strip_suffix('\n').unwrap_or(line);
        let hits = re.find_iter(body).count() as u32;
        if hits == 0 || only_line.is_some_and(|n| n as usize != i + 1) {
            out.push_str(line);
            continue;
        }
        count += hits;
        if expand {
            out.push_str(&re.replace_all(body, replacement));
        } else {
            out.push_str(&re.replace_all(body, NoExpand(replacement)));
        }
        out.push_str(&line[body.len()..]);
    }
    (out, count)
}

/// Project-wide replace with the search's semantics: binary, too large and skipped files are left alone,
/// each file is written atomically and only if unchanged since read.
pub fn replace(repo: &Path, req: &ReplaceRequest) -> GitResult<ReplaceOutcome> {
    if req.replacement.contains('\0') {
        return Err(GitError::invalid("Invalid replacement text."));
    }
    let re = matcher(&req.query, req.opts)?;
    let paths = match &req.paths {
        Some(paths) => paths.clone(),
        None => grep(repo, &grep_args(&req.query, req.opts, &["-l"])?)?
            .split(|b| *b == 0)
            .filter(|s| !s.is_empty())
            .map(|s| String::from_utf8_lossy(s).into_owned())
            .collect(),
    };
    let mut outcome = ReplaceOutcome::default();
    for path in paths.iter().filter(|p| !req.skip.contains(p)) {
        let file = read_file(repo, path)?;
        let Some(content) = file.content else {
            continue;
        };
        let (text, hits) = replace_lines(&content, &re, &req.replacement, req.opts.regex, req.line);
        if hits == 0 {
            continue;
        }
        write_file(repo, path, &text, Some(file.mtime))?;
        outcome.files += 1;
        outcome.replacements += hits;
    }
    Ok(outcome)
}

/// A path the file tree may create, rename or delete: confined like any file, never the root itself nor
/// anything named `.git`.
fn resolve_entry(repo: &Path, path: &str) -> GitResult<PathBuf> {
    let rel = Path::new(validate::relative_path(path)?);
    let named = rel.components().any(|c| matches!(c, Component::Normal(_)));
    if !named || rel.components().any(|c| c.as_os_str() == ".git") {
        return Err(GitError::invalid(format!("Invalid file path: {path}")));
    }
    resolve(repo, path)
}

fn exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn already_exists(path: &str) -> GitError {
    GitError::invalid(format!("{path} already exists."))
}

pub fn create_file(repo: &Path, path: &str) -> GitResult<()> {
    let full = resolve_entry(repo, path)?;
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&full)
        .map_err(|err| match err.kind() {
            std::io::ErrorKind::AlreadyExists => already_exists(path),
            _ => io(err),
        })?;
    Ok(())
}

pub fn create_dir(repo: &Path, path: &str) -> GitResult<()> {
    let full = resolve_entry(repo, path)?;
    fs::create_dir(&full).map_err(|err| match err.kind() {
        std::io::ErrorKind::AlreadyExists => already_exists(path),
        _ => io(err),
    })
}

/// Moves a file or folder; refuses to overwrite (a case-only rename of the same file is fine).
pub fn rename_path(repo: &Path, from: &str, to: &str) -> GitResult<()> {
    use std::os::unix::fs::MetadataExt;
    let source = resolve_entry(repo, from)?;
    let target = resolve_entry(repo, to)?;
    let meta = fs::symlink_metadata(&source).map_err(io)?;
    if let Ok(other) = fs::symlink_metadata(&target)
        && (other.ino(), other.dev()) != (meta.ino(), meta.dev())
    {
        return Err(already_exists(to));
    }
    fs::rename(&source, &target).map_err(io)
}

/// Copies a file next to itself as "name copy.ext" (then "name copy 2.ext"…), returning the new path.
pub fn duplicate_file(repo: &Path, path: &str) -> GitResult<String> {
    let source = resolve_entry(repo, path)?;
    if !fs::symlink_metadata(&source).map_err(io)?.is_file() {
        return Err(GitError::invalid("Only files can be duplicated."));
    }
    let (dir, name) = path.rsplit_once('/').map_or(("", path), |(d, n)| (d, n));
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, format!(".{ext}")),
        _ => (name, String::new()),
    };
    for n in 1..100 {
        let suffix = if n == 1 {
            String::new()
        } else {
            format!(" {n}")
        };
        let copy = format!("{stem} copy{suffix}{ext}");
        let rel = if dir.is_empty() {
            copy
        } else {
            format!("{dir}/{copy}")
        };
        let target = resolve_entry(repo, &rel)?;
        if !exists(&target) {
            fs::copy(&source, &target).map_err(io)?;
            return Ok(rel);
        }
    }
    Err(already_exists(path))
}

/// Moves a file or folder to the Trash (so a mistaken delete can be undone from the Finder).
pub fn delete_path(repo: &Path, path: &str) -> GitResult<()> {
    let full = resolve_entry(repo, path)?;
    if !exists(&full) {
        return Err(GitError::invalid(format!("{path} doesn't exist.")));
    }
    trash(&full)
}

#[cfg(target_os = "macos")]
fn trash(path: &Path) -> GitResult<()> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use std::os::unix::ffi::OsStrExt;
    let fail = || GitError::new(ErrorKind::Io, "Couldn't move it to the Trash.");
    let c_path = std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(|_| fail())?;
    let (Some(string), Some(url), Some(manager)) = (
        AnyClass::get(c"NSString"),
        AnyClass::get(c"NSURL"),
        AnyClass::get(c"NSFileManager"),
    ) else {
        return Err(fail());
    };
    let trashed = objc2::rc::autoreleasepool(|_| unsafe {
        let ns_path: *mut AnyObject = msg_send![string, stringWithUTF8String: c_path.as_ptr()];
        if ns_path.is_null() {
            return false;
        }
        let file_url: *mut AnyObject = msg_send![url, fileURLWithPath: ns_path];
        let manager: *mut AnyObject = msg_send![manager, defaultManager];
        let none = std::ptr::null_mut::<*mut AnyObject>();
        let ok: Bool =
            msg_send![manager, trashItemAtURL: file_url, resultingItemURL: none, error: none];
        ok.as_bool()
    });
    if trashed { Ok(()) } else { Err(fail()) }
}

#[cfg(not(target_os = "macos"))]
fn trash(path: &Path) -> GitResult<()> {
    let meta = fs::symlink_metadata(path).map_err(io)?;
    if meta.is_dir() {
        fs::remove_dir_all(path).map_err(io)
    } else {
        fs::remove_file(path).map_err(io)
    }
}

/// Shows the file selected in a Finder window.
pub fn reveal_path(repo: &Path, path: &str) -> GitResult<()> {
    let full = resolve(repo, path)?;
    std::process::Command::new("/usr/bin/open")
        .arg("-R")
        .arg(&full)
        .status()
        .map_err(io)?;
    Ok(())
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
        let found = search(repo.path(), "two", MatchOptions::default()).unwrap();
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
            search(
                repo.path(),
                "nowhere",
                MatchOptions {
                    case_sensitive: true,
                    ..MatchOptions::default()
                }
            )
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

    fn request(query: &str, replacement: &str, opts: MatchOptions) -> ReplaceRequest {
        ReplaceRequest {
            query: query.into(),
            replacement: replacement.into(),
            opts,
            paths: None,
            line: None,
            skip: vec![],
        }
    }

    fn read(repo: &TestRepo, path: &str) -> String {
        std::fs::read_to_string(repo.path().join(path)).unwrap()
    }

    #[test]
    fn replace_all_changes_every_matching_file_and_counts() {
        let repo = repo();
        repo.write("b.txt", "two two\n");
        let done = replace(repo.path(), &request("two", "2", MatchOptions::default())).unwrap();
        assert_eq!(
            (done, read(&repo, "b.txt")),
            (
                ReplaceOutcome {
                    files: 2,
                    replacements: 3
                },
                "2 2\n".to_string()
            )
        );
    }

    #[test]
    fn replace_skips_files_with_unsaved_edits() {
        let repo = repo();
        let mut req = request("two", "2", MatchOptions::default());
        req.skip = vec!["src/a.txt".into()];
        replace(repo.path(), &req).unwrap();
        assert_eq!(read(&repo, "src/a.txt"), "one\ntwo\nthree\n");
    }

    #[test]
    fn replace_skips_binary_files() {
        let repo = repo();
        repo.write("bin.dat", "two\0two");
        let mut req = request("two", "2", MatchOptions::default());
        req.paths = Some(vec!["bin.dat".into()]);
        assert_eq!(replace(repo.path(), &req).unwrap().files, 0);
    }

    #[test]
    fn replace_on_one_line_leaves_the_others() {
        let repo = repo();
        repo.write("c.txt", "x\nx\nx\n");
        let mut req = request("x", "y", MatchOptions::default());
        req.paths = Some(vec!["c.txt".into()]);
        req.line = Some(2);
        replace(repo.path(), &req).unwrap();
        assert_eq!(read(&repo, "c.txt"), "x\ny\nx\n");
    }

    #[test]
    fn regex_replace_expands_groups_and_literal_does_not() {
        let re = matcher(
            r"(\w+)=(\w+)",
            MatchOptions {
                regex: true,
                ..MatchOptions::default()
            },
        )
        .unwrap();
        assert_eq!(replace_lines("a=b\n", &re, "$2=$1", true, None).0, "b=a\n");
        let lit = matcher("a=b", MatchOptions::default()).unwrap();
        assert_eq!(replace_lines("a=b\n", &lit, "$0", false, None).0, "$0\n");
    }

    #[test]
    fn whole_word_and_case_options_match_like_the_search() {
        let re = matcher(
            "Two",
            MatchOptions {
                case_sensitive: true,
                whole_word: true,
                ..MatchOptions::default()
            },
        )
        .unwrap();
        assert_eq!(
            replace_lines("Two Twofold two\n", &re, "2", false, None),
            ("2 Twofold two\n".to_string(), 1)
        );
    }

    #[test]
    fn patterns_matching_empty_text_are_refused() {
        let opts = MatchOptions {
            regex: true,
            ..MatchOptions::default()
        };
        assert!(matcher("a*", opts).is_err());
    }

    #[test]
    fn creates_renames_and_duplicates_inside_the_tree() {
        let repo = repo();
        create_dir(repo.path(), "src/new").unwrap();
        create_file(repo.path(), "src/new/f.rs").unwrap();
        rename_path(repo.path(), "src/new/f.rs", "src/new/g.rs").unwrap();
        let copy = duplicate_file(repo.path(), "src/new/g.rs").unwrap();
        let again = duplicate_file(repo.path(), "src/new/g.rs").unwrap();
        assert_eq!(
            (copy.as_str(), again.as_str()),
            ("src/new/g copy.rs", "src/new/g copy 2.rs")
        );
    }

    #[test]
    fn refuses_to_overwrite_on_create_or_rename() {
        let repo = repo();
        repo.write("b.txt", "b");
        assert!(create_file(repo.path(), "b.txt").is_err());
        assert!(rename_path(repo.path(), "b.txt", "src/a.txt").is_err());
    }

    #[test]
    fn tree_operations_refuse_the_root_git_and_outside_paths() {
        let repo = repo();
        for path in [".", "./", "..", ".git", ".git/config", "src/.git", "../x"] {
            assert!(delete_path(repo.path(), path).is_err(), "{path}");
            assert!(create_dir(repo.path(), path).is_err(), "{path}");
        }
        assert!(rename_path(repo.path(), "src/a.txt", "../a.txt").is_err());
    }
}
