//! What an agent changed in the user's own checkout during a run, file by file, and taking a file back.
//! The working tree is snapshotted (as a tree object, nothing staged) before and after the run.

use std::path::Path;

use serde::Serialize;

use super::errors::{GitError, GitResult};
use super::runner::{RunOptions, git_text, git_with};
use super::validate;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EditedFile {
    pub path: String,
    /// "added", "deleted" or "modified".
    pub status: &'static str,
    /// None for binary files.
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

/// The working tree as it is on disk, committed or not, as a tree id. Nothing is staged.
pub fn snapshot(repo: &Path) -> GitResult<String> {
    super::worktrees::snapshot(repo)
}

/// Files that differ between two snapshots, with their line counts.
pub fn edits(repo: &Path, before: &str, after: &str) -> GitResult<Vec<EditedFile>> {
    let (before, after) = (validate::object_id(before)?, validate::object_id(after)?);
    let numstat = git_text(
        repo,
        &[
            "diff",
            "--no-ext-diff",
            "--no-renames",
            "--numstat",
            "-z",
            before,
            after,
        ],
    )?;
    let mut files = Vec::new();
    for entry in numstat.split('\0').filter(|e| !e.is_empty()) {
        let mut parts = entry.splitn(3, '\t');
        let (add, del, path) = (parts.next(), parts.next(), parts.next());
        let Some(path) = path else { continue };
        let status = match (in_tree(repo, before, path)?, in_tree(repo, after, path)?) {
            (false, _) => "added",
            (_, false) => "deleted",
            _ => "modified",
        };
        files.push(EditedFile {
            path: path.to_string(),
            status,
            additions: add.and_then(|n| n.parse().ok()),
            deletions: del.and_then(|n| n.parse().ok()),
        });
    }
    Ok(files)
}

/// The blob of `path` in `tree`, if it has one.
fn blob(repo: &Path, tree: &str, path: &str) -> GitResult<Option<String>> {
    let out = git_text(
        repo,
        &["ls-tree", "-z", "--format=%(objectname)", tree, "--", path],
    )?;
    Ok(out.split('\0').find(|s| !s.is_empty()).map(str::to_string))
}

fn in_tree(repo: &Path, tree: &str, path: &str) -> GitResult<bool> {
    Ok(blob(repo, tree, path)?.is_some())
}

/// Puts `path` back as it was `before` the run (deleting it if the agent created it). Refused when the file
/// changed since the run ended (`after`): the user's later edits are never thrown away.
pub fn reject(repo: &Path, before: &str, after: &str, path: &str) -> GitResult<()> {
    let (before, after) = (validate::object_id(before)?, validate::object_id(after)?);
    let path = validate::relative_path(path)?;
    let file = repo.join(path);
    let now = if file.is_file() {
        let opts = RunOptions::default();
        let out = git_with(repo, &["hash-object", "--", path], &opts)?;
        Some(String::from_utf8_lossy(&out).trim().to_string())
    } else {
        None
    };
    if now != blob(repo, after, path)? {
        return Err(GitError::invalid(format!(
            "{path} changed since the agent edited it: revert it by hand."
        )));
    }
    match blob(repo, before, path)? {
        Some(_) => git_text(
            repo,
            &[
                "restore",
                &format!("--source={before}"),
                "--worktree",
                "--",
                path,
            ],
        )
        .map(|_| ()),
        None => std::fs::remove_file(&file)
            .map_err(|e| GitError::invalid(format!("Couldn't delete {path}: {e}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::TestRepo;

    fn repo() -> TestRepo {
        let r = TestRepo::new();
        r.write("a.txt", "one\n");
        r.write("gone.txt", "bye\n");
        r.commit_all("init");
        r
    }

    #[test]
    fn lists_and_rejects_each_kind_of_edit() {
        let r = repo();
        r.write("dirty.txt", "user's own work\n"); // untracked before the run: not the agent's
        let before = snapshot(r.path()).unwrap();
        r.write("a.txt", "one\ntwo\n");
        r.write("new.txt", "hi\n");
        std::fs::remove_file(r.path().join("gone.txt")).unwrap();
        let after = snapshot(r.path()).unwrap();
        let files = edits(r.path(), &before, &after).unwrap();
        let kinds: Vec<_> = files.iter().map(|f| (f.path.as_str(), f.status)).collect();
        assert_eq!(
            kinds,
            [
                ("a.txt", "modified"),
                ("gone.txt", "deleted"),
                ("new.txt", "added")
            ]
        );
        assert_eq!(files[0].additions, Some(1));
        for f in &files {
            reject(r.path(), &before, &after, &f.path).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(r.path().join("a.txt")).unwrap(),
            "one\n"
        );
        assert_eq!(
            std::fs::read_to_string(r.path().join("gone.txt")).unwrap(),
            "bye\n"
        );
        assert!(!r.path().join("new.txt").exists());
        assert_eq!(
            std::fs::read_to_string(r.path().join("dirty.txt")).unwrap(),
            "user's own work\n"
        );
        assert!(
            r.git(&["diff", "--cached", "--name-only"]).is_empty(),
            "nothing staged"
        );
    }

    #[test]
    fn refuses_to_reject_a_file_edited_since() {
        let r = repo();
        let before = snapshot(r.path()).unwrap();
        r.write("a.txt", "agent\n");
        let after = snapshot(r.path()).unwrap();
        r.write("a.txt", "user\n");
        assert!(reject(r.path(), &before, &after, "a.txt").is_err());
        assert_eq!(
            std::fs::read_to_string(r.path().join("a.txt")).unwrap(),
            "user\n"
        );
        assert!(reject(r.path(), &before, &after, "../x").is_err());
    }
}
