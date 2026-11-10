//! Commands that change repository state. None of them can discard work:
//! no reset --hard, no clean, no force push, and switch refuses to overwrite local changes.

use std::path::Path;

use super::errors::{GitError, GitResult};
use super::read::head;
use super::runner::{NETWORK_TIMEOUT, RunOptions, git, git_text, git_with};
use super::validate;

const NETWORK: RunOptions = RunOptions {
    timeout: NETWORK_TIMEOUT,
    stdin: None,
    ok_codes: &[],
    env: &[],
};

pub fn stage(repo: &Path, paths: &[String]) -> GitResult<()> {
    let mut args = vec!["add", "-A", "--"];
    args.extend(validate::relative_paths(paths)?);
    git(repo, &args).map(drop)
}

pub fn unstage(repo: &Path, paths: &[String]) -> GitResult<()> {
    let paths = validate::relative_paths(paths)?;
    // Without a first commit there is no HEAD to restore from; removing from the index is the equivalent.
    let mut args = if head(repo)?.unborn {
        vec!["rm", "--cached", "-r", "--quiet", "--"]
    } else {
        vec!["restore", "--staged", "--"]
    };
    args.extend(paths);
    git(repo, &args).map(drop)
}

/// Commits the index; returns the new commit hash.
pub fn commit(repo: &Path, message: &str) -> GitResult<String> {
    let message = message.trim();
    if message.is_empty() {
        return Err(GitError::invalid("Write a commit message first."));
    }
    let opts = RunOptions {
        stdin: Some(message.as_bytes()),
        ..RunOptions::default()
    };
    git_with(repo, &["commit", "--quiet", "--file=-"], &opts)?;
    Ok(git_text(repo, &["rev-parse", "HEAD"])?.trim().to_string())
}

/// `git switch` aborts on its own if uncommitted changes would be overwritten.
pub fn switch_branch(repo: &Path, name: &str) -> GitResult<()> {
    let name = validate::revision(name)?;
    git(repo, &["switch", "--no-guess", name]).map(drop)
}

/// Checks out a remote branch (`origin/feature`): switches to the local `feature` when it exists, else creates
/// it tracking the remote one. Like `switch`, it refuses to overwrite uncommitted work.
pub fn checkout_remote_branch(repo: &Path, remote_ref: &str) -> GitResult<String> {
    let remote_ref = validate::revision(remote_ref.trim())?;
    let (_, local) = remote_ref
        .split_once('/')
        .filter(|(remote, name)| !remote.is_empty() && !name.is_empty())
        .ok_or_else(|| GitError::invalid("Pick a remote branch like origin/feature."))?;
    let local = checked_branch_name(repo, local)?;
    let full = format!("refs/remotes/{remote_ref}");
    git(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            "--end-of-options",
            &full,
        ],
    )
    .map_err(|_| GitError::invalid(format!("“{remote_ref}” isn't a remote branch.")))?;
    let exists = git(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            "--end-of-options",
            &format!("refs/heads/{local}"),
        ],
    )
    .is_ok();
    if exists {
        git(repo, &["switch", "--no-guess", &local])?;
    } else {
        git(
            repo,
            &["switch", "--no-guess", "--track", "-c", &local, &full],
        )?;
    }
    Ok(local)
}

pub(crate) fn checked_branch_name(repo: &Path, name: &str) -> GitResult<String> {
    let name = validate::revision(name.trim())?;
    git_text(repo, &["check-ref-format", "--branch", name])
        .map(|n| n.trim().to_string())
        .map_err(|_| GitError::invalid(format!("“{name}” isn't a valid branch name.")))
}

pub fn create_branch(repo: &Path, name: &str, switch: bool) -> GitResult<()> {
    let name = checked_branch_name(repo, name)?;
    let args = if switch {
        vec!["switch", "-c", name.as_str()]
    } else {
        vec!["branch", "--end-of-options", name.as_str()]
    };
    git(repo, &args).map(drop)
}

/// Deletes a local branch; returns its tip so it can be restored. Never the checked-out branch.
///
/// Without `force`, only merged work goes: merged into HEAD or the upstream (`git branch -d`), into the default
/// branch, or squash-merged there (an equivalent commit exists on it), or by a pull request GitHub merged at this
/// very commit (asked to `gh` last). `merged_head`, the head of a pull request
/// merged on GitHub, also counts — only if the branch still points exactly there. `force` is the user's explicit
/// "delete anyway".
pub fn delete_branch(
    repo: &Path,
    name: &str,
    merged_head: Option<&str>,
    force: bool,
) -> GitResult<String> {
    let name = validate::revision(name)?;
    if head(repo)?.branch.as_deref() == Some(name) {
        return Err(GitError::invalid(
            "Switch to another branch before deleting this one.",
        ));
    }
    let full = format!("refs/heads/{name}");
    let tip = git_text(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            "--end-of-options",
            &full,
        ],
    )
    .map_err(|_| GitError::invalid(format!("“{name}” isn't a local branch.")))?
    .trim()
    .to_string();
    if let Some(oid) = merged_head
        && validate::object_id(oid)? != tip
        && !force
    {
        return Err(GitError::invalid(format!(
            "“{name}” has commits that aren't in its merged pull request; it was kept."
        )));
    }
    let merged = force
        || merged_head.is_some()
        || git(repo, &["branch", "-d", "--end-of-options", name]).is_ok()
        || merged_into_default(repo, &tip)
        || super::github::merged_pull_request_at(repo, name, &tip);
    if !merged {
        return Err(GitError::invalid(format!(
            "“{name}” isn't merged; it was kept so no commit is lost."
        )));
    }
    if ref_exists(repo, &full) {
        git(repo, &["branch", "-D", "--end-of-options", name])?;
    }
    Ok(tip)
}

fn ref_exists(repo: &Path, full: &str) -> bool {
    git(
        repo,
        &["rev-parse", "--verify", "--quiet", "--end-of-options", full],
    )
    .is_ok()
}

/// Whether `tip`'s work is on the default branch (origin's copy when there is one): merged, or squash-merged —
/// the branch's whole change as one commit has an equivalent there (`git cherry` compares patches).
fn merged_into_default(repo: &Path, tip: &str) -> bool {
    let Some(base) = super::github::default_base(repo) else {
        return false;
    };
    let target = [
        format!("refs/remotes/origin/{base}"),
        format!("refs/heads/{base}"),
    ]
    .into_iter()
    .find(|r| ref_exists(repo, r));
    let Some(target) = target else { return false };
    if git(repo, &["merge-base", "--is-ancestor", tip, &target]).is_ok() {
        return true;
    }
    let squashed = || -> GitResult<bool> {
        let base = git_text(repo, &["merge-base", &target, tip])?;
        let tree = git_text(repo, &["rev-parse", &format!("{tip}^{{tree}}")])?;
        // A throwaway commit, never referenced: git's gc drops it.
        let squash = git_text(
            repo,
            &[
                "commit-tree",
                tree.trim(),
                "-p",
                base.trim(),
                "-m",
                "squash check",
            ],
        )?;
        Ok(git_text(repo, &["cherry", &target, squash.trim()])?
            .trim_start()
            .starts_with('-'))
    };
    squashed().unwrap_or(false)
}

/// Brings a deleted branch back on the commit it pointed to.
pub fn restore_branch(repo: &Path, name: &str, tip: &str) -> GitResult<()> {
    let name = checked_branch_name(repo, name)?;
    let tip = validate::object_id(tip)?;
    git(repo, &["branch", "--end-of-options", &name, tip]).map(drop)
}

/// Deletes a branch on its remote (GitHub); returns the commit it pointed to, for undo. The default branch is
/// refused, and `--force-with-lease` makes the push fail if someone pushed to the branch since the last fetch.
pub fn delete_remote_branch(repo: &Path, remote: &str, name: &str) -> GitResult<String> {
    let (remote, name) = (validate::revision(remote)?, validate::revision(name)?);
    if remote.contains('/') {
        return Err(GitError::invalid("Invalid remote name."));
    }
    let default = git_text(
        repo,
        &[
            "symbolic-ref",
            "--quiet",
            &format!("refs/remotes/{remote}/HEAD"),
        ],
    )
    .map(|r| r.trim().rsplit('/').next().unwrap_or_default().to_string())
    .unwrap_or_default();
    if name == default || ["main", "master"].contains(&name) {
        return Err(GitError::invalid(format!(
            "“{name}” is the default branch; it can't be deleted here."
        )));
    }
    let tracking = format!("refs/remotes/{remote}/{name}");
    let tip = git_text(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            "--end-of-options",
            &tracking,
        ],
    )
    .map_err(|_| GitError::invalid(format!("“{remote}/{name}” isn't a remote branch.")))?
    .trim()
    .to_string();
    let lease = format!("--force-with-lease=refs/heads/{name}:{tip}");
    git_with(
        repo,
        &["push", &lease, "--", remote, &format!(":refs/heads/{name}")],
        &NETWORK,
    )?;
    Ok(tip)
}

/// Pushes a deleted remote branch back, on the commit it pointed to (only if nothing took its name since).
pub fn restore_remote_branch(repo: &Path, remote: &str, name: &str, tip: &str) -> GitResult<()> {
    let (remote, name, tip) = (
        validate::revision(remote)?,
        checked_branch_name(repo, name)?,
        validate::object_id(tip)?,
    );
    let lease = format!("--force-with-lease=refs/heads/{name}:");
    git_with(
        repo,
        &[
            "push",
            &lease,
            "--",
            remote,
            &format!("{tip}:refs/heads/{name}"),
        ],
        &NETWORK,
    )
    .map(drop)
}

pub fn fetch(repo: &Path) -> GitResult<()> {
    git_with(repo, &["fetch", "--all", "--prune"], &NETWORK).map(drop)
}

/// Fast-forward only: never creates a surprise merge commit or conflict.
pub fn pull(repo: &Path) -> GitResult<()> {
    git_with(repo, &["pull", "--ff-only"], &NETWORK).map(drop)
}

/// Pushes the current branch. A branch without upstream is published to `origin` (or the only remote).
pub fn push(repo: &Path) -> GitResult<()> {
    let branch = head(repo)?
        .branch
        .ok_or_else(|| GitError::invalid("Check out a branch before pushing."))?;
    if git(
        repo,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .is_ok()
    {
        return git_with(repo, &["push"], &NETWORK).map(drop);
    }
    let remotes = git_text(repo, &["remote"])?;
    let remotes: Vec<&str> = remotes.lines().collect();
    let remote = match remotes.as_slice() {
        [] => {
            return Err(GitError::invalid(
                "This repository has no remote to push to.",
            ));
        }
        [only] => *only,
        _ if remotes.contains(&"origin") => "origin",
        _ => {
            return Err(GitError::invalid(
                "Several remotes and none is “origin”: set an upstream in a terminal first.",
            ));
        }
    };
    git_with(
        repo,
        &[
            "push",
            "--set-upstream",
            remote,
            &format!("HEAD:refs/heads/{branch}"),
        ],
        &NETWORK,
    )
    .map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::model::FileStatus;
    use crate::git::read::{list_commits, list_refs, working_tree};
    use crate::git::test_repo::TestRepo;

    fn committed_repo() -> TestRepo {
        let repo = TestRepo::new();
        repo.write("a.txt", "a\n");
        repo.commit_all("Initial");
        repo
    }

    fn repo_with_remote() -> (TestRepo, tempfile::TempDir) {
        let remote = tempfile::tempdir().unwrap();
        let repo = committed_repo();
        repo.git(&[
            "init",
            "-q",
            "--bare",
            "-b",
            "main",
            &remote.path().to_string_lossy(),
        ]);
        repo.git(&["remote", "add", "origin", &remote.path().to_string_lossy()]);
        (repo, remote)
    }

    #[test]
    fn stage_then_commit_creates_a_commit() {
        let repo = committed_repo();
        repo.write("b c.txt", "b\n");
        stage(repo.path(), &["b c.txt".into()]).unwrap();
        commit(repo.path(), "  Add b  \n").unwrap();
        assert_eq!(
            list_commits(repo.path(), None, 0, 1, Default::default()).unwrap()[0].subject,
            "Add b"
        );
    }

    #[test]
    fn stage_records_deletions() {
        let repo = committed_repo();
        std::fs::remove_file(repo.path().join("a.txt")).unwrap();
        stage(repo.path(), &["a.txt".into()]).unwrap();
        assert_eq!(
            working_tree(repo.path()).unwrap()[0].staged,
            Some(FileStatus::Deleted)
        );
    }

    #[test]
    fn unstage_keeps_the_working_copy_change() {
        let repo = committed_repo();
        repo.write("a.txt", "changed\n");
        stage(repo.path(), &["a.txt".into()]).unwrap();
        unstage(repo.path(), &["a.txt".into()]).unwrap();
        let entry = &working_tree(repo.path()).unwrap()[0];
        assert_eq!(
            (entry.staged, entry.unstaged),
            (None, Some(FileStatus::Modified))
        );
    }

    #[test]
    fn unstage_works_before_the_first_commit() {
        let repo = TestRepo::new();
        repo.write("a.txt", "a\n");
        stage(repo.path(), &["a.txt".into()]).unwrap();
        unstage(repo.path(), &["a.txt".into()]).unwrap();
        assert_eq!(
            working_tree(repo.path()).unwrap()[0].unstaged,
            Some(FileStatus::Untracked)
        );
    }

    #[test]
    fn empty_commit_message_is_rejected() {
        let repo = committed_repo();
        assert!(commit(repo.path(), "   ").is_err());
    }

    #[test]
    fn remote_checkout_creates_a_tracking_branch() {
        let origin = committed_repo();
        origin.git(&["switch", "-q", "-c", "feature"]);
        let clone = crate::git::test_repo::TestRepo::new();
        clone.git(&["remote", "add", "origin", origin.path().to_str().unwrap()]);
        clone.git(&["fetch", "-q", "origin"]);
        assert_eq!(
            checkout_remote_branch(clone.path(), "origin/feature").unwrap(),
            "feature"
        );
        assert_eq!(
            clone
                .git(&["rev-parse", "--abbrev-ref", "feature@{upstream}"])
                .trim(),
            "origin/feature"
        );
    }

    #[test]
    fn switch_refuses_to_overwrite_local_changes() {
        let repo = committed_repo();
        repo.git(&["switch", "-q", "-c", "other"]);
        repo.write("a.txt", "other\n");
        repo.commit_all("Other");
        repo.git(&["switch", "-q", "main"]);
        repo.write("a.txt", "precious uncommitted work\n");
        assert!(switch_branch(repo.path(), "other").is_err());
    }

    #[test]
    fn refused_switch_leaves_the_work_untouched() {
        let repo = committed_repo();
        repo.git(&["switch", "-q", "-c", "other"]);
        repo.write("a.txt", "other\n");
        repo.commit_all("Other");
        repo.git(&["switch", "-q", "main"]);
        repo.write("a.txt", "precious\n");
        let _ = switch_branch(repo.path(), "other");
        assert_eq!(
            std::fs::read_to_string(repo.path().join("a.txt")).unwrap(),
            "precious\n"
        );
    }

    #[test]
    fn create_branch_can_switch_to_it() {
        let repo = committed_repo();
        create_branch(repo.path(), "feature/new", true).unwrap();
        assert_eq!(
            list_refs(repo.path()).unwrap().head.branch.as_deref(),
            Some("feature/new")
        );
    }

    #[test]
    fn create_branch_rejects_invalid_names() {
        let repo = committed_repo();
        assert!(create_branch(repo.path(), "bad..name", false).is_err());
    }

    #[test]
    fn push_without_remote_explains_why() {
        let repo = committed_repo();
        assert_eq!(
            push(repo.path()).unwrap_err().message,
            "This repository has no remote to push to."
        );
    }

    #[test]
    fn push_publishes_a_new_branch_and_sets_upstream() {
        let (repo, _remote) = repo_with_remote();
        push(repo.path()).unwrap();
        assert_eq!(
            list_refs(repo.path()).unwrap().branches[0]
                .upstream
                .as_deref(),
            Some("origin/main")
        );
    }

    #[test]
    fn pull_fast_forwards_from_the_remote() {
        let (repo, remote) = repo_with_remote();
        push(repo.path()).unwrap();
        let clone = tempfile::tempdir().unwrap();
        repo.git(&[
            "clone",
            "-q",
            &remote.path().to_string_lossy(),
            &clone.path().to_string_lossy(),
        ]);
        let run = |args: &[&str]| {
            std::process::Command::new("git")
                .arg("-C")
                .arg(clone.path())
                .args(args)
                .status()
                .unwrap()
        };
        std::fs::write(clone.path().join("new.txt"), "n\n").unwrap();
        run(&["add", "-A"]);
        run(&[
            "-c",
            "user.name=T",
            "-c",
            "user.email=t@e.x",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-q",
            "-m",
            "Remote change",
        ]);
        run(&["push", "-q"]);
        pull(repo.path()).unwrap();
        assert_eq!(
            list_commits(repo.path(), None, 0, 1, Default::default()).unwrap()[0].subject,
            "Remote change"
        );
    }

    fn repo_with_feature() -> TestRepo {
        let repo = committed_repo();
        repo.git(&["switch", "-q", "-c", "feature"]);
        repo.write("b.txt", "b\n");
        repo.commit_all("Feature");
        repo.git(&["switch", "-q", "main"]);
        repo
    }

    fn branches(repo: &TestRepo) -> Vec<String> {
        list_refs(repo.path())
            .unwrap()
            .branches
            .into_iter()
            .map(|b| b.name)
            .collect()
    }

    #[test]
    fn deleting_keeps_an_unmerged_branch() {
        let repo = repo_with_feature();
        assert!(delete_branch(repo.path(), "feature", None, false).is_err());
    }

    #[test]
    fn deleting_a_merged_branch_returns_its_tip() {
        let repo = repo_with_feature();
        repo.git(&["merge", "-q", "--ff-only", "feature"]);
        let tip = delete_branch(repo.path(), "feature", None, false).unwrap();
        assert_eq!(tip, repo.git(&["rev-parse", "HEAD"]).trim());
    }

    #[test]
    fn a_squash_merged_branch_goes_only_at_its_pull_request_head() {
        let repo = repo_with_feature();
        let head = repo.git(&["rev-parse", "feature"]).trim().to_string();
        assert!(delete_branch(repo.path(), "feature", Some(&"a".repeat(40)), false).is_err());
        assert!(delete_branch(repo.path(), "feature", Some(&head), false).is_ok());
    }

    #[test]
    fn the_checked_out_branch_is_never_deleted() {
        let repo = repo_with_feature();
        assert!(delete_branch(repo.path(), "main", None, false).is_err());
    }

    #[test]
    fn a_deleted_branch_can_be_restored() {
        let repo = repo_with_feature();
        let head = repo.git(&["rev-parse", "feature"]).trim().to_string();
        delete_branch(repo.path(), "feature", Some(&head), false).unwrap();
        restore_branch(repo.path(), "feature", &head).unwrap();
        assert!(branches(&repo).contains(&"feature".to_string()));
    }

    #[test]
    fn a_remote_branch_is_deleted_and_restored() {
        let (repo, _remote) = repo_with_remote();
        repo.git(&["push", "-q", "origin", "main", "main:feature"]);
        repo.git(&["fetch", "-q", "origin"]);
        let tip = delete_remote_branch(repo.path(), "origin", "feature").unwrap();
        assert!(
            repo.git(&["ls-remote", "--heads", "origin"])
                .lines()
                .all(|l| !l.ends_with("/feature"))
        );
        restore_remote_branch(repo.path(), "origin", "feature", &tip).unwrap();
        assert!(
            repo.git(&["ls-remote", "--heads", "origin"])
                .contains("refs/heads/feature")
        );
    }

    #[test]
    fn the_remote_default_branch_is_never_deleted() {
        let (repo, _remote) = repo_with_remote();
        repo.git(&["push", "-q", "origin", "main"]);
        repo.git(&["fetch", "-q", "origin"]);
        assert!(delete_remote_branch(repo.path(), "origin", "main").is_err());
    }

    #[test]
    fn a_remote_branch_pushed_to_since_the_fetch_is_kept() {
        let (repo, remote) = repo_with_remote();
        repo.git(&["push", "-q", "origin", "main", "main:feature"]);
        repo.git(&["fetch", "-q", "origin"]);
        // Someone else moves the branch on the remote: our tracking ref is now stale.
        repo.write("c.txt", "c\n");
        let newer = repo.commit_all("Newer");
        repo.git(&[
            "push",
            "-q",
            &remote.path().to_string_lossy(),
            &format!("{newer}:refs/heads/feature"),
        ]);
        assert!(delete_remote_branch(repo.path(), "origin", "feature").is_err());
    }

    #[test]
    fn a_squash_merged_branch_is_seen_as_merged() {
        let repo = repo_with_feature();
        repo.git(&["merge", "-q", "--squash", "feature"]);
        repo.git(&["commit", "-q", "-m", "Feature (squashed)"]);
        repo.git(&["switch", "-q", "-c", "other"]);
        assert!(delete_branch(repo.path(), "feature", None, false).is_ok());
    }

    #[test]
    fn force_deletes_an_unmerged_branch() {
        let repo = repo_with_feature();
        assert!(delete_branch(repo.path(), "feature", None, true).is_ok());
    }
}
