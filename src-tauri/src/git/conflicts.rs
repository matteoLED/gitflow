//! A merge, rebase, cherry-pick or revert stopped on conflicts: what it is, and how to finish or undo it.
//! Every step is the user's explicit choice; nothing here runs on its own.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::errors::{GitError, GitResult};
use super::runner::{git, git_long, git_text};
use super::validate;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum OperationKind {
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub kind: OperationKind,
    /// Rebase progress: the commit being replayed and how many there are.
    pub step: Option<(u32, u32)>,
    /// The branch being rebased, or merged in.
    pub branch: Option<String>,
    /// What each side of a conflict is, in the user's words: in a rebase "ours" is the base being rebased onto.
    pub ours: String,
    pub theirs: String,
}

/// A path inside `.git`, worktrees included.
fn git_path(repo: &Path, name: &str) -> GitResult<PathBuf> {
    let path = git_text(repo, &["rev-parse", "--git-path", name])?;
    Ok(repo.join(path.trim()))
}

fn read_trimmed(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn short_ref(name: &str) -> String {
    name.strip_prefix("refs/heads/").unwrap_or(name).to_string()
}

/// The operation in progress, if any.
pub fn operation(repo: &Path) -> GitResult<Option<Operation>> {
    let current = git_text(repo, &["branch", "--show-current"])
        .unwrap_or_default()
        .trim()
        .to_string();
    for dir in ["rebase-merge", "rebase-apply"] {
        let dir = git_path(repo, dir)?;
        if !dir.is_dir() {
            continue;
        }
        let number = |names: [&str; 2]| {
            names
                .iter()
                .find_map(|n| read_trimmed(&dir.join(n)))
                .and_then(|s| s.parse().ok())
        };
        let step = number(["msgnum", "next"]).zip(number(["end", "last"]));
        let branch = read_trimmed(&dir.join("head-name")).map(|h| short_ref(&h));
        let onto = read_trimmed(&dir.join("onto"))
            .and_then(|oid| {
                git_text(repo, &["name-rev", "--name-only", "--no-undefined", &oid]).ok()
            })
            .map(|n| n.trim().to_string())
            .unwrap_or_else(|| "upstream".into());
        let theirs = branch.clone().unwrap_or_else(|| "your commit".into());
        return Ok(Some(Operation {
            kind: OperationKind::Rebase,
            step,
            branch,
            ours: onto,
            theirs,
        }));
    }
    let head =
        |name: &str| -> GitResult<Option<String>> { Ok(read_trimmed(&git_path(repo, name)?)) };
    if let Some(oid) = head("MERGE_HEAD")? {
        let merged = read_trimmed(&git_path(repo, "MERGE_MSG")?)
            .and_then(|msg| {
                msg.lines()
                    .next()
                    .and_then(|l| l.split('\'').nth(1))
                    .map(str::to_string)
            })
            .unwrap_or_else(|| oid[..oid.len().min(7)].to_string());
        return Ok(Some(Operation {
            kind: OperationKind::Merge,
            step: None,
            branch: Some(merged.clone()),
            ours: if current.is_empty() {
                "HEAD".into()
            } else {
                current
            },
            theirs: merged,
        }));
    }
    for (name, kind) in [
        ("CHERRY_PICK_HEAD", OperationKind::CherryPick),
        ("REVERT_HEAD", OperationKind::Revert),
    ] {
        if let Some(oid) = head(name)? {
            return Ok(Some(Operation {
                kind,
                step: None,
                branch: None,
                ours: if current.is_empty() {
                    "HEAD".into()
                } else {
                    current
                },
                theirs: oid[..oid.len().min(7)].to_string(),
            }));
        }
    }
    Ok(None)
}

fn require(repo: &Path) -> GitResult<OperationKind> {
    operation(repo)?
        .map(|op| op.kind)
        .ok_or_else(|| GitError::invalid("No merge, rebase, cherry-pick or revert is in progress."))
}

const fn verb(kind: OperationKind) -> &'static str {
    match kind {
        OperationKind::Merge => "merge",
        OperationKind::Rebase => "rebase",
        OperationKind::CherryPick => "cherry-pick",
        OperationKind::Revert => "revert",
    }
}

/// Finishes the operation once every conflict is resolved and staged; the commit messages git prepared are kept.
pub fn continue_operation(repo: &Path) -> GitResult<()> {
    let kind = require(repo)?;
    let unresolved = git_text(repo, &["diff", "--name-only", "--diff-filter=U"])?;
    if !unresolved.trim().is_empty() {
        return Err(GitError::invalid(
            "Some files still have conflicts: resolve and mark them first.",
        ));
    }
    // `core.editor=true` accepts git's prepared message instead of opening an editor nobody can see.
    let args: &[&str] = match kind {
        OperationKind::Merge => &["-c", "core.editor=true", "commit", "--no-edit"],
        _ => &["-c", "core.editor=true", verb(kind), "--continue"],
    };
    git_long(repo, args).map(|_| ())
}

/// Stops the operation and puts the branch back as it was before it started.
pub fn abort_operation(repo: &Path) -> GitResult<()> {
    let kind = require(repo)?;
    git_long(repo, &[verb(kind), "--abort"]).map(|_| ())
}

/// Drops the commit being replayed (rebase) or picked (cherry-pick, revert, e.g. one that became empty)
/// and goes on with the next one.
pub fn skip_commit(repo: &Path) -> GitResult<()> {
    let kind = require(repo)?;
    match kind {
        OperationKind::Merge => return Err(GitError::invalid("A merge has no commit to skip.")),
        OperationKind::Rebase => drop_pending_reword(repo)?,
        _ => {}
    }
    git_long(repo, &["-c", "core.editor=true", verb(kind), "--skip"]).map(|_| ())
}

/// A reword is a pick followed by an `exec` amending with the message file `gitflow-msg-<sha>-…` (see
/// `rewrite::build_todo`). Skipping that pick must drop the amend too, or it would reword the previous commit.
fn drop_pending_reword(repo: &Path) -> GitResult<()> {
    let Ok(sha) = git_text(repo, &["rev-parse", "--verify", "--quiet", "REBASE_HEAD"]) else {
        return Ok(());
    };
    let todo_path = git_path(repo, "rebase-merge/git-rebase-todo")?;
    let Ok(todo) = fs::read_to_string(&todo_path) else {
        return Ok(());
    };
    let marker = format!("gitflow-msg-{}-", sha.trim());
    let kept: String = todo
        .lines()
        .filter(|l| !(l.starts_with("exec ") && l.contains(&marker)))
        .map(|l| format!("{l}\n"))
        .collect();
    if kept.lines().count() == todo.lines().count() {
        return Ok(());
    }
    fs::write(&todo_path, kept).map_err(|e| GitError::invalid(e.to_string()))
}

/// Resolves whole files with one side ("ours" or "theirs"), then marks them resolved.
pub fn take_side(repo: &Path, paths: &[String], theirs: bool) -> GitResult<()> {
    require(repo)?;
    let paths = validate::relative_paths(paths)?;
    let side = if theirs { "--theirs" } else { "--ours" };
    let mut args = vec!["checkout", side, "--"];
    args.extend(paths.iter().copied());
    git(repo, &args)?;
    let mut add = vec!["add", "--"];
    add.extend(paths);
    git(repo, &add).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::TestRepo;

    /// `main` and `feature` both change line 2 of a.txt.
    fn conflicting() -> TestRepo {
        let repo = TestRepo::new();
        repo.write("a.txt", "one\ntwo\nthree\n");
        repo.commit_all("init");
        repo.git(&["checkout", "-q", "-b", "feature"]);
        repo.write("a.txt", "one\nfeature\nthree\n");
        repo.commit_all("feature");
        repo.git(&["checkout", "-q", "main"]);
        repo.write("a.txt", "one\nmain\nthree\n");
        repo.commit_all("main");
        repo
    }

    fn merge(repo: &TestRepo) {
        let _ = std::process::Command::new("git")
            .arg("-C")
            .arg(repo.path())
            .args(["merge", "-q", "feature"])
            .output();
    }

    #[test]
    fn a_stopped_merge_is_detected_with_both_sides_named() {
        let repo = conflicting();
        merge(&repo);
        let op = operation(repo.path()).unwrap().unwrap();
        assert_eq!(
            (op.kind, op.ours.as_str(), op.theirs.as_str()),
            (OperationKind::Merge, "main", "feature")
        );
    }

    #[test]
    fn taking_a_side_then_continuing_commits_the_merge() {
        let repo = conflicting();
        merge(&repo);
        take_side(repo.path(), &["a.txt".into()], true).unwrap();
        continue_operation(repo.path()).unwrap();
        assert!(operation(repo.path()).unwrap().is_none());
        assert_eq!(
            fs::read_to_string(repo.path().join("a.txt")).unwrap(),
            "one\nfeature\nthree\n"
        );
    }

    #[test]
    fn continuing_refuses_while_conflicts_remain() {
        let repo = conflicting();
        merge(&repo);
        assert!(continue_operation(repo.path()).is_err());
    }

    #[test]
    fn aborting_restores_the_branch() {
        let repo = conflicting();
        merge(&repo);
        abort_operation(repo.path()).unwrap();
        assert!(operation(repo.path()).unwrap().is_none());
        assert_eq!(
            fs::read_to_string(repo.path().join("a.txt")).unwrap(),
            "one\nmain\nthree\n"
        );
    }

    #[test]
    fn a_stopped_rebase_reports_its_progress() {
        let repo = conflicting();
        repo.git(&["checkout", "-q", "feature"]);
        let _ = std::process::Command::new("git")
            .arg("-C")
            .arg(repo.path())
            .args(["rebase", "-q", "main"])
            .output();
        let op = operation(repo.path()).unwrap().unwrap();
        assert_eq!(
            (op.kind, op.step, op.branch.as_deref()),
            (OperationKind::Rebase, Some((1, 1)), Some("feature"))
        );
    }

    #[test]
    fn nothing_in_progress_is_none() {
        let repo = conflicting();
        assert!(operation(repo.path()).unwrap().is_none());
    }
}
