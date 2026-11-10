//! Stashes: list with details, create, apply/pop, drop, branch. Apply and pop never overwrite local changes:
//! git refuses on its own, and a conflicting apply keeps the stash and leaves the conflicts in the working tree.

use std::path::Path;

use serde::Serialize;

use super::errors::{GitError, GitResult};
use super::read::working_tree;
use super::runner::{RunOptions, git, git_text, git_with};
use super::write::checked_branch_name;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub index: u32,
    pub hash: String,
    /// Commit the stash was taken on (its first parent): the base of its diff.
    pub base: String,
    /// Commit holding the untracked files, when the stash has some.
    pub untracked: Option<String>,
    /// Branch it was taken on; `None` on a detached HEAD.
    pub branch: Option<String>,
    pub message: String,
    pub created_at: String,
    /// Tracked files changed plus untracked files saved.
    pub file_count: u32,
}

/// Result of apply or pop: with conflicts, the stash is kept and the conflicted files wait in the working tree.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StashOutcome {
    pub conflicts: bool,
}

pub fn list(repo: &Path) -> GitResult<Vec<StashEntry>> {
    let out = git(
        repo,
        &[
            "stash",
            "list",
            "-z",
            "--name-only",
            "--diff-merges=first-parent",
            "--format=%x01%gd%x00%H%x00%P%x00%cI%x00%gs",
        ],
    )?;
    let mut entries: Vec<StashEntry> = String::from_utf8_lossy(&out)
        .split('\u{1}')
        .filter_map(parse_entry)
        .collect();
    for entry in &mut entries {
        if let Some(untracked) = &entry.untracked {
            let names = git(repo, &["ls-tree", "-r", "-z", "--name-only", untracked])?;
            entry.file_count += names.iter().filter(|b| **b == 0).count() as u32;
        }
    }
    Ok(entries)
}

/// One `stash list` record: `stash@{n}\0hash\0parents\0date\0subject\0` then the changed file names.
fn parse_entry(record: &str) -> Option<StashEntry> {
    let mut fields = record.split('\0');
    let index = fields
        .next()?
        .strip_prefix("stash@{")?
        .strip_suffix('}')?
        .parse()
        .ok()?;
    let hash = fields.next()?.to_string();
    let parents: Vec<&str> = fields.next()?.split(' ').collect();
    let created_at = fields.next()?.to_string();
    let (branch, message) = split_subject(fields.next()?);
    let file_count = fields.filter(|f| !f.trim().is_empty()).count() as u32;
    Some(StashEntry {
        index,
        hash,
        base: parents.first()?.to_string(),
        untracked: parents.get(2).map(|p| p.to_string()),
        branch,
        message,
        created_at,
        file_count,
    })
}

/// `WIP on main: abc subject` / `On main: message` → (Some("main"), message). `(no branch)` is detached.
fn split_subject(subject: &str) -> (Option<String>, String) {
    let rest = subject
        .strip_prefix("WIP on ")
        .or_else(|| subject.strip_prefix("On "));
    match rest.and_then(|r| r.split_once(": ")) {
        Some((branch, message)) => (
            (branch != "(no branch)").then(|| branch.to_string()),
            message.to_string(),
        ),
        None => (None, subject.to_string()),
    }
}

fn selector(index: u32) -> String {
    format!("stash@{{{index}}}")
}

pub fn push(repo: &Path, message: &str, include_untracked: bool) -> GitResult<()> {
    let message = message.trim();
    let mut args = vec!["stash", "push"];
    if include_untracked {
        args.push("--include-untracked");
    }
    if !message.is_empty() {
        args.extend(["--message", message]);
    }
    let before = git_text(repo, &["stash", "list", "--format=%H"])?;
    // `stash -u` cleans what it saved with the `:/` pathspec magic, which literal pathspecs would disable.
    let opts = RunOptions {
        env: &[("GIT_LITERAL_PATHSPECS", "0")],
        ..RunOptions::default()
    };
    git_with(repo, &args, &opts)?;
    if git_text(repo, &["stash", "list", "--format=%H"])? == before {
        return Err(GitError::invalid("No local changes to stash."));
    }
    Ok(())
}

/// Applies a stash, and drops it when `pop` and it applied cleanly.
pub fn apply(repo: &Path, index: u32, pop: bool) -> GitResult<StashOutcome> {
    let sel = selector(index);
    let verb = if pop { "pop" } else { "apply" };
    let conflicted =
        |repo: &Path| -> GitResult<bool> { Ok(working_tree(repo)?.iter().any(|e| e.conflicted)) };
    if conflicted(repo)? {
        return Err(GitError::invalid("Resolve the current conflicts first."));
    }
    match git(repo, &["stash", verb, &sel]) {
        Ok(_) => Ok(StashOutcome { conflicts: false }),
        // Git exits non-zero on conflicts but has applied the rest; the stash is kept even for pop.
        Err(_) if conflicted(repo)? => Ok(StashOutcome { conflicts: true }),
        Err(err) => Err(err),
    }
}

pub fn drop(repo: &Path, index: u32) -> GitResult<()> {
    git(repo, &["stash", "drop", "--quiet", &selector(index)]).map(|_| ())
}

/// Creates a branch at the commit the stash was taken on, switches to it and pops the stash there.
pub fn branch(repo: &Path, index: u32, name: &str) -> GitResult<()> {
    let name = checked_branch_name(repo, name)?;
    git(repo, &["stash", "branch", &name, &selector(index)]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::TestRepo;

    fn repo_with_stash() -> TestRepo {
        let repo = TestRepo::new();
        repo.write("a.txt", "one\n");
        repo.commit_all("first");
        repo.write("a.txt", "two\n");
        repo.write("new.txt", "untracked\n");
        push(repo.path(), "my work", true).unwrap();
        repo
    }

    #[test]
    fn subject_gives_branch_and_message() {
        assert_eq!(
            split_subject("On main: my msg"),
            (Some("main".into()), "my msg".into())
        );
    }

    #[test]
    fn detached_stash_has_no_branch() {
        assert_eq!(split_subject("WIP on (no branch): abc x").0, None);
    }

    #[test]
    fn list_counts_tracked_and_untracked_files() {
        let repo = repo_with_stash();
        let entries = list(repo.path()).unwrap();
        assert_eq!(
            (
                entries.len(),
                entries[0].file_count,
                entries[0].message.as_str()
            ),
            (1, 2, "my work")
        );
    }

    #[test]
    fn push_without_changes_fails() {
        let repo = TestRepo::new();
        repo.write("a.txt", "one\n");
        repo.commit_all("first");
        assert!(push(repo.path(), "", false).is_err());
    }

    #[test]
    fn pop_restores_changes_and_drops_the_stash() {
        let repo = repo_with_stash();
        apply(repo.path(), 0, true).unwrap();
        let restored = std::fs::read_to_string(repo.path().join("a.txt")).unwrap();
        assert_eq!(
            (restored.as_str(), list(repo.path()).unwrap().len()),
            ("two\n", 0)
        );
    }

    #[test]
    fn conflicting_pop_keeps_the_stash() {
        let repo = repo_with_stash();
        repo.write("a.txt", "three\n");
        repo.commit_all("diverge");
        let outcome = apply(repo.path(), 0, true).unwrap();
        assert_eq!(
            (outcome.conflicts, list(repo.path()).unwrap().len()),
            (true, 1)
        );
    }

    #[test]
    fn drop_removes_the_stash() {
        let repo = repo_with_stash();
        drop(repo.path(), 0).unwrap();
        assert!(list(repo.path()).unwrap().is_empty());
    }

    #[test]
    fn branch_from_stash_switches_and_pops() {
        let repo = repo_with_stash();
        branch(repo.path(), 0, "from-stash").unwrap();
        assert_eq!(repo.git(&["branch", "--show-current"]), "from-stash");
    }
}
