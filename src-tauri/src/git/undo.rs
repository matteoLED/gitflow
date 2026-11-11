//! Global undo: the last undoable operation, read from the HEAD reflog (commit, amend, merge, rebase, pull,
//! reset, checkout) or from the branches this app deleted, and its reversal. Nothing here can lose work:
//! commits are undone with `reset --soft`, history moves with `reset --keep` (git refuses if local changes would
//! be lost), a checkout is only reversed on a clean working tree, and a deleted branch is simply recreated.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::conflicts;
use super::errors::{GitError, GitResult};
use super::read::head;
use super::runner::{git, git_text};
use super::validate;
use super::write::restore_branch;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UndoKind {
    Commit,
    Amend,
    Merge,
    Rebase,
    /// A `fixup!` commit folded into an older one by an autosquash rebase.
    Fixup,
    Pull,
    Reset,
    Checkout,
    BranchDelete,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UndoAction {
    pub kind: UndoKind,
    /// Commit subject, merged branch, reset target, the branch a checkout left, or the deleted branch.
    pub label: String,
    /// Branch moved back; for a checkout, the one switched back to; for a deletion, the one recreated.
    pub branch: Option<String>,
    /// Commit the branch (or HEAD) ends up on.
    pub target: String,
    /// Commit HEAD is on now: undo refuses if it moved since the action was shown.
    pub current: String,
    /// When the operation happened (Unix seconds).
    pub at: i64,
}

const DELETED_LOG: &str = "gitflow-deleted-branches";
const DELETED_KEPT: usize = 50;
const REFLOG_SCAN: &str = "-n20";

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

fn deleted_log(repo: &Path) -> GitResult<PathBuf> {
    let dir = git_text(
        repo,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    Ok(PathBuf::from(dir.trim()).join(DELETED_LOG))
}

/// Lines `unix\tsha\tname`, oldest first.
fn read_deleted(repo: &Path) -> GitResult<Vec<(i64, String, String)>> {
    let text = std::fs::read_to_string(deleted_log(repo)?).unwrap_or_default();
    Ok(text
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            Some((
                parts.next()?.parse().ok()?,
                parts.next()?.to_string(),
                parts.next()?.to_string(),
            ))
        })
        .collect())
}

fn write_deleted(repo: &Path, entries: &[(i64, String, String)]) -> GitResult<()> {
    let start = entries.len().saturating_sub(DELETED_KEPT);
    let text: String = entries[start..]
        .iter()
        .map(|(at, sha, name)| format!("{at}\t{sha}\t{name}\n"))
        .collect();
    std::fs::write(deleted_log(repo)?, text).map_err(|e| GitError::invalid(e.to_string()))
}

/// Remembers a branch the app deleted, so it can be undone later.
pub fn record_deleted_branch(repo: &Path, name: &str, sha: &str) -> GitResult<()> {
    let mut entries = read_deleted(repo)?;
    entries.retain(|(_, _, n)| n != name);
    entries.push((now(), sha.to_string(), name.to_string()));
    write_deleted(repo, &entries)
}

/// Forgets a deleted branch once it's back.
pub fn forget_deleted_branch(repo: &Path, name: &str) -> GitResult<()> {
    let mut entries = read_deleted(repo)?;
    entries.retain(|(_, _, n)| n != name);
    write_deleted(repo, &entries)
}

fn exists(repo: &Path, rev: &str) -> bool {
    git(
        repo,
        &["rev-parse", "--verify", "--quiet", "--end-of-options", rev],
    )
    .is_ok()
}

/// Latest deleted branch that is still gone and whose commit still exists.
fn last_deleted(repo: &Path, current: &str) -> GitResult<Option<UndoAction>> {
    let found = read_deleted(repo)?
        .into_iter()
        .rev()
        .find(|(_, sha, name)| {
            !exists(repo, &format!("refs/heads/{name}"))
                && exists(repo, &format!("{sha}^{{commit}}"))
        });
    Ok(found.map(|(at, sha, name)| UndoAction {
        kind: UndoKind::BranchDelete,
        label: name.clone(),
        branch: Some(name),
        target: sha,
        current: current.to_string(),
        at,
    }))
}

/// What a reflog subject undoes, and its label. `None` for anything not safely undoable.
fn classify(subject: &str) -> Option<(UndoKind, String)> {
    if subject.contains("(finish)") {
        return match subject.split(' ').next() {
            Some("pull") => Some((UndoKind::Pull, String::new())),
            Some("rebase") => Some((UndoKind::Rebase, String::new())),
            _ => None,
        };
    }
    let prefixed = |prefix: &str, kind: UndoKind| {
        subject
            .strip_prefix(prefix)
            .map(|rest| (kind, rest.to_string()))
    };
    prefixed("commit: ", UndoKind::Commit)
        // A cherry-pick or revert adds one commit: undone like a commit, its changes kept staged.
        .or_else(|| prefixed("cherry-pick: ", UndoKind::Commit))
        .or_else(|| prefixed("revert: ", UndoKind::Commit))
        .or_else(|| prefixed("commit (amend): ", UndoKind::Amend))
        .or_else(|| prefixed("commit (merge): ", UndoKind::Merge))
        .or_else(|| {
            // `pull: Fast-forward`, `pull --ff-only origin main: Merge made…`; not the `(start)`/`(pick)` steps.
            let (command, _) = subject.split_once(": ")?;
            (command.starts_with("pull") && !command.contains('('))
                .then(|| (UndoKind::Pull, String::new()))
        })
        .or_else(|| prefixed("reset: moving to ", UndoKind::Reset))
        .or_else(|| {
            let rest = subject.strip_prefix("merge ")?;
            Some((UndoKind::Merge, rest.split_once(':')?.0.to_string()))
        })
        .or_else(|| {
            let rest = subject.strip_prefix("checkout: moving from ")?;
            Some((UndoKind::Checkout, rest.rsplit_once(" to ")?.0.to_string()))
        })
}

/// `HEAD@{1700000000}` → 1700000000.
fn reflog_time(selector: &str) -> Option<i64> {
    selector.split_once("@{")?.1.strip_suffix('}')?.parse().ok()
}

/// The last undoable HEAD reflog entry. No-op resets (`git stash` writes one) are skipped.
fn last_reflog(repo: &Path, branch: Option<&str>) -> GitResult<Option<UndoAction>> {
    let text = git_text(
        repo,
        &[
            "reflog",
            REFLOG_SCAN,
            "--date=unix",
            "--format=%H%x00%gd%x00%gs",
            "HEAD",
        ],
    )
    .unwrap_or_default();
    let entries: Vec<Vec<&str>> = text.lines().map(|l| l.split('\0').collect()).collect();
    for (i, entry) in entries.iter().enumerate() {
        let [sha, selector, subject] = entry[..] else {
            return Ok(None);
        };
        let Some((kind, label)) = classify(subject) else {
            return Ok(None);
        };
        let previous = entries.get(i + 1).and_then(|e| e.first().copied());
        if kind == UndoKind::Reset && previous == Some(sha) {
            continue;
        }
        if kind == UndoKind::Rebase
            && let Some(action) = branch.and_then(|b| fixup_before_rebase(repo, b))
        {
            return Ok(Some(UndoAction {
                current: sha.to_string(),
                at: reflog_time(selector).unwrap_or(0),
                ..action
            }));
        }
        let target = match kind {
            // The rebase's own steps are in HEAD's reflog; the branch's reflog has just before and after.
            UndoKind::Rebase | UndoKind::Pull if subject.contains("(finish)") => {
                let Some(b) = branch else { return Ok(None) };
                git_text(
                    repo,
                    &[
                        "rev-parse",
                        "--verify",
                        "--quiet",
                        &format!("refs/heads/{b}@{{1}}"),
                    ],
                )
                .map(|s| s.trim().to_string())
                .ok()
            }
            _ => previous.map(str::to_string),
        };
        let Some(target) = target else {
            return Ok(None);
        };
        let branch = match kind {
            UndoKind::Checkout => Some(label.clone()),
            _ => branch.map(str::to_string),
        };
        return Ok(Some(UndoAction {
            kind,
            label,
            branch,
            target,
            current: sha.to_string(),
            at: reflog_time(selector).unwrap_or(0),
        }));
    }
    Ok(None)
}

/// A rebase that came right after a `fixup!` commit on `branch` (the app's "fixup into this commit"): undone in
/// one go, back to before the fixup commit. `current` and `at` are left to the caller.
fn fixup_before_rebase(repo: &Path, branch: &str) -> Option<UndoAction> {
    let full = format!("refs/heads/{branch}");
    let text = git_text(repo, &["reflog", "-n3", "--format=%H%x00%gs", &full]).ok()?;
    let entries: Vec<(&str, &str)> = text.lines().filter_map(|l| l.split_once('\0')).collect();
    let [_, (fixup_sha, subject), (before, _)] = entries[..] else {
        return None;
    };
    let label = subject.strip_prefix("commit: fixup! ")?;
    let parent = git_text(
        repo,
        &["rev-parse", "--verify", "--quiet", &format!("{fixup_sha}^")],
    )
    .ok()?;
    (parent.trim() == before).then(|| UndoAction {
        kind: UndoKind::Fixup,
        label: label.to_string(),
        branch: Some(branch.to_string()),
        target: before.to_string(),
        current: String::new(),
        at: 0,
    })
}

/// The most recent undoable operation, or `None` (also while a merge or rebase is stopped).
pub fn last(repo: &Path) -> GitResult<Option<UndoAction>> {
    let info = head(repo)?;
    if info.unborn || conflicts::operation(repo)?.is_some() {
        return Ok(None);
    }
    let current = git_text(repo, &["rev-parse", "HEAD"])?.trim().to_string();
    let reflog = last_reflog(repo, info.branch.as_deref())?;
    let deleted = last_deleted(repo, &current)?;
    Ok(match (reflog, deleted) {
        (Some(r), Some(d)) => Some(if d.at >= r.at { d } else { r }),
        (r, d) => r.or(d),
    })
}

fn require_clean(repo: &Path) -> GitResult<()> {
    let status = git_text(repo, &["status", "--porcelain", "--untracked-files=no"])?;
    if status.trim().is_empty() {
        return Ok(());
    }
    Err(GitError::invalid(
        "Commit or stash your changes before switching back.",
    ))
}

/// Reverses `expected`, after checking it's still the last undoable operation.
pub fn undo(repo: &Path, expected: &UndoAction) -> GitResult<()> {
    if last(repo)?.as_ref() != Some(expected) {
        return Err(GitError::invalid(
            "The repository changed since: check what Undo would do again.",
        ));
    }
    let target = validate::object_id(&expected.target)?;
    match expected.kind {
        UndoKind::Commit | UndoKind::Amend => git(repo, &["reset", "--soft", target]).map(drop),
        // Back to the fixup commit (refused if local changes would be lost), then before it: its changes staged.
        UndoKind::Fixup => {
            let branch = validate::revision(expected.branch.as_deref().unwrap_or_default())?;
            let fixup = git_text(
                repo,
                &[
                    "rev-parse",
                    "--verify",
                    "--quiet",
                    &format!("refs/heads/{branch}@{{1}}"),
                ],
            )?;
            git(repo, &["reset", "--keep", fixup.trim()])?;
            git(repo, &["reset", "--soft", target]).map(drop)
        }
        UndoKind::Merge | UndoKind::Rebase | UndoKind::Pull => {
            git(repo, &["reset", "--keep", target]).map(drop)
        }
        // A `reset --soft` (like an undone commit) left the index on the old commit: going back keeps it as is.
        UndoKind::Reset if git(repo, &["diff", "--cached", "--quiet", target]).is_ok() => {
            git(repo, &["reset", "--soft", target]).map(drop)
        }
        UndoKind::Reset => git(repo, &["reset", "--keep", target]).map(drop),
        UndoKind::Checkout => {
            require_clean(repo)?;
            let from = validate::revision(&expected.label)?;
            if exists(repo, &format!("refs/heads/{from}")) {
                git(repo, &["switch", "--no-guess", from]).map(drop)
            } else {
                git(repo, &["switch", "--detach", target]).map(drop)
            }
        }
        UndoKind::BranchDelete => {
            restore_branch(repo, &expected.label, target)?;
            forget_deleted_branch(repo, &expected.label)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::TestRepo;

    fn repo() -> (TestRepo, String) {
        let repo = TestRepo::new();
        repo.write("a.txt", "one\n");
        let first = repo.commit_all("first");
        (repo, first)
    }

    fn undo_last(repo: &TestRepo) -> UndoAction {
        let action = last(repo.path()).unwrap().expect("something to undo");
        undo(repo.path(), &action).unwrap();
        action
    }

    fn head_sha(repo: &TestRepo) -> String {
        repo.git(&["rev-parse", "HEAD"])
    }

    #[test]
    fn a_cherry_pick_is_undone_like_a_commit() {
        let (repo, first) = repo();
        repo.git(&["checkout", "-q", "-b", "side"]);
        repo.write("b.txt", "b\n");
        let picked = repo.commit_all("b");
        repo.git(&["checkout", "-q", "main"]);
        repo.git(&["cherry-pick", &picked]);
        assert_eq!(
            (undo_last(&repo).kind, head_sha(&repo)),
            (UndoKind::Commit, first)
        );
    }

    #[test]
    fn nothing_to_undo_after_the_initial_commit() {
        let (repo, _) = repo();
        assert!(last(repo.path()).unwrap().is_none());
    }

    #[test]
    fn undo_commit_keeps_changes_staged() {
        let (repo, first) = repo();
        repo.write("a.txt", "two\n");
        repo.commit_all("second");
        undo_last(&repo);
        let staged = repo.git(&["diff", "--cached", "--name-only"]);
        assert_eq!((head_sha(&repo), staged.as_str()), (first, "a.txt"));
    }

    #[test]
    fn undo_amend_goes_back_to_the_original_commit() {
        let (repo, _) = repo();
        repo.write("a.txt", "two\n");
        let second = repo.commit_all("second");
        repo.git(&["commit", "-q", "--amend", "-m", "second, better"]);
        let action = undo_last(&repo);
        assert_eq!((action.kind, head_sha(&repo)), (UndoKind::Amend, second));
    }

    #[test]
    fn undo_merge_moves_the_branch_back() {
        let (repo, first) = repo();
        repo.git(&["switch", "-q", "-c", "feature"]);
        repo.write("b.txt", "b\n");
        repo.commit_all("feature work");
        repo.git(&["switch", "-q", "main"]);
        repo.git(&["merge", "-q", "feature"]);
        let action = undo_last(&repo);
        assert_eq!(
            (action.kind, action.label, head_sha(&repo)),
            (UndoKind::Merge, "feature".to_string(), first)
        );
    }

    #[test]
    fn undo_rebase_restores_the_branch() {
        let (repo, _) = repo();
        repo.git(&["switch", "-q", "-c", "feature"]);
        repo.write("b.txt", "b\n");
        let before = repo.commit_all("feature work");
        repo.git(&["switch", "-q", "main"]);
        repo.write("c.txt", "c\n");
        repo.commit_all("main work");
        repo.git(&["switch", "-q", "feature"]);
        repo.git(&["rebase", "-q", "main"]);
        let action = undo_last(&repo);
        assert_eq!((action.kind, head_sha(&repo)), (UndoKind::Rebase, before));
    }

    #[test]
    fn undo_fixup_restores_the_branch_with_the_changes_staged() {
        let (repo, _) = repo();
        repo.write("b.txt", "b\n");
        let before = repo.commit_all("second");
        repo.write("a.txt", "fixed\n");
        repo.git(&["add", "a.txt"]);
        let first = repo.git(&["rev-parse", "HEAD~1"]);
        crate::git::rewrite::fixup(repo.path(), &first).unwrap();
        let action = undo_last(&repo);
        let staged = repo.git(&["diff", "--cached", "--name-only"]);
        assert_eq!(
            (action.kind, action.label, head_sha(&repo), staged),
            (
                UndoKind::Fixup,
                "first".to_string(),
                before,
                "a.txt".to_string()
            )
        );
    }

    #[test]
    fn undo_pull_fast_forward() {
        let (origin, first) = repo();
        let dir = tempfile::tempdir().unwrap();
        let clone = dir.path().join("clone");
        origin.git(&["clone", "-q", ".", clone.to_str().unwrap()]);
        origin.write("a.txt", "two\n");
        origin.commit_all("second");
        let git = |args: &[&str]| {
            std::process::Command::new("git")
                .arg("-C")
                .arg(&clone)
                .args(args)
                .output()
                .unwrap()
        };
        git(&["pull", "-q", "--ff-only"]);
        let action = last(&clone).unwrap().unwrap();
        undo(&clone, &action).unwrap();
        let head = String::from_utf8(git(&["rev-parse", "HEAD"]).stdout).unwrap();
        assert_eq!((action.kind, head.trim()), (UndoKind::Pull, first.as_str()));
    }

    #[test]
    fn undo_merge_refuses_to_lose_local_changes() {
        let (repo, _) = repo();
        repo.git(&["switch", "-q", "-c", "feature"]);
        repo.write("a.txt", "feature\n");
        repo.commit_all("feature work");
        repo.git(&["switch", "-q", "main"]);
        repo.git(&["merge", "-q", "feature"]);
        repo.write("a.txt", "local edit\n");
        let action = last(repo.path()).unwrap().unwrap();
        assert!(undo(repo.path(), &action).is_err());
    }

    #[test]
    fn undo_reset_after_undone_commit_restores_it() {
        let (repo, _) = repo();
        repo.write("a.txt", "two\n");
        let second = repo.commit_all("second");
        repo.git(&["reset", "-q", "--soft", "HEAD~1"]);
        let action = undo_last(&repo);
        assert_eq!((action.kind, head_sha(&repo)), (UndoKind::Reset, second));
    }

    #[test]
    fn stash_noop_reset_is_skipped() {
        let (repo, _) = repo();
        repo.write("a.txt", "two\n");
        repo.commit_all("second");
        repo.write("a.txt", "three\n");
        repo.git(&["stash", "-q"]);
        let action = last(repo.path()).unwrap().unwrap();
        assert_eq!(action.kind, UndoKind::Commit);
    }

    #[test]
    fn undo_checkout_switches_back() {
        let (repo, _) = repo();
        repo.git(&["switch", "-q", "-c", "feature"]);
        undo_last(&repo);
        assert_eq!(repo.git(&["branch", "--show-current"]), "main");
    }

    #[test]
    fn undo_checkout_refuses_with_local_changes() {
        let (repo, _) = repo();
        repo.git(&["switch", "-q", "-c", "feature"]);
        repo.write("a.txt", "dirty\n");
        let action = last(repo.path()).unwrap().unwrap();
        assert!(undo(repo.path(), &action).is_err());
    }

    #[test]
    fn undo_branch_delete_recreates_it() {
        let (repo, first) = repo();
        repo.git(&["branch", "old"]);
        repo.git(&["branch", "-q", "-D", "old"]);
        record_deleted_branch(repo.path(), "old", &first).unwrap();
        let action = undo_last(&repo);
        assert_eq!(
            (action.kind, repo.git(&["rev-parse", "old"])),
            (UndoKind::BranchDelete, first)
        );
    }

    #[test]
    fn stale_action_is_refused() {
        let (repo, _) = repo();
        repo.write("a.txt", "two\n");
        repo.commit_all("second");
        let action = last(repo.path()).unwrap().unwrap();
        repo.write("a.txt", "three\n");
        repo.commit_all("third");
        assert!(undo(repo.path(), &action).is_err());
    }
}
