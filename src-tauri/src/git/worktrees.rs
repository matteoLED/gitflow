//! Agent worktrees: each isolated agent run works in its own checkout of the repository, on its own branch,
//! so several can run at once without touching the user's files. Its work comes back through a merge.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use super::errors::{GitError, GitResult};
use super::runner::{git, git_text};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub branch: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    /// Files the agent changed and didn't commit.
    pub changed: u32,
    /// Commits on the agent's branch that the current branch doesn't have.
    pub ahead: u32,
}

/// Where agent worktrees live: `~/.gitflow/worktrees/<repo>-<hash>`, outside the repository (no stray files in
/// it), one folder per repository.
fn root(repo: &Path) -> GitResult<PathBuf> {
    let home = std::env::var("HOME").map_err(|_| GitError::invalid("No home folder."))?;
    let canonical = repo
        .canonicalize()
        .map_err(|e| GitError::invalid(e.to_string()))?;
    let name = canonical
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    // A short hash of the full path keeps two repositories with the same name apart.
    let hash = canonical
        .to_string_lossy()
        .bytes()
        .fold(0u32, |h, b| h.wrapping_mul(31).wrapping_add(b.into()));
    Ok(Path::new(&home)
        .join(".gitflow/worktrees")
        .join(format!("{name}-{hash:08x}")))
}

fn new_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", nanos & 0xffff_ffff_ffff)
}

/// A new worktree on a new `agent/<id>` branch, from the current HEAD (uncommitted changes stay where they are).
pub fn create(repo: &Path) -> GitResult<Worktree> {
    create_at(repo, &root(repo)?)
}

fn create_at(repo: &Path, root: &Path) -> GitResult<Worktree> {
    let id = new_id();
    let branch = format!("agent/{id}");
    std::fs::create_dir_all(root).map_err(|e| GitError::invalid(e.to_string()))?;
    let path = root.join(&id).to_string_lossy().into_owned();
    git(
        repo,
        &["worktree", "add", "-q", "-b", &branch, &path, "HEAD"],
    )?;
    Ok(Worktree { path, branch })
}

/// The repository's agent worktrees (others the user made by hand aren't the app's to touch).
pub fn list(repo: &Path) -> GitResult<Vec<Worktree>> {
    list_at(repo, &root(repo)?)
}

fn list_at(repo: &Path, root: &Path) -> GitResult<Vec<Worktree>> {
    let out = git_text(repo, &["worktree", "list", "--porcelain"])?;
    Ok(out
        .split("\n\n")
        .filter_map(|block| {
            let path = block.lines().find_map(|l| l.strip_prefix("worktree "))?;
            let branch = block
                .lines()
                .find_map(|l| l.strip_prefix("branch refs/heads/"))?;
            Path::new(path).starts_with(root).then(|| Worktree {
                path: path.into(),
                branch: branch.into(),
            })
        })
        .collect())
}

/// The worktree at `path`, refused unless it's one of this repository's agent worktrees.
fn owned(repo: &Path, root: &Path, path: &str) -> GitResult<Worktree> {
    list_at(repo, root)?
        .into_iter()
        .find(|w| w.path == path)
        .ok_or_else(|| GitError::invalid("This isn't one of the app's agent worktrees."))
}

/// Validates a worktree before an agent runs in it.
pub fn checked_path(repo: &Path, path: &str) -> GitResult<PathBuf> {
    owned(repo, &root(repo)?, path).map(|w| PathBuf::from(w.path))
}

pub fn status(repo: &Path, path: &str) -> GitResult<WorktreeStatus> {
    status_at(repo, &root(repo)?, path)
}

fn status_at(repo: &Path, root: &Path, path: &str) -> GitResult<WorktreeStatus> {
    let worktree = owned(repo, root, path)?;
    let dir = Path::new(&worktree.path);
    let changed = git_text(dir, &["status", "--porcelain"])?.lines().count() as u32;
    let range = format!("HEAD..{}", worktree.branch);
    let ahead = git_text(repo, &["rev-list", "--count", &range])?
        .trim()
        .parse()
        .unwrap_or(0);
    Ok(WorktreeStatus { changed, ahead })
}

/// Brings the agent's work into the current branch: what it left uncommitted is committed on its branch first
/// (with `message`), then merged. Conflicts stop the merge like any other, for the user to resolve.
pub fn merge(repo: &Path, path: &str, message: &str) -> GitResult<()> {
    merge_at(repo, &root(repo)?, path, message)
}

fn merge_at(repo: &Path, root: &Path, path: &str, message: &str) -> GitResult<()> {
    let worktree = owned(repo, root, path)?;
    let dir = Path::new(&worktree.path);
    let message = commit_leftovers(dir, message)?;
    let title = format!("Merge {}: {message}", worktree.branch);
    git(repo, &["merge", "--no-ff", "-m", &title, &worktree.branch]).map(|_| ())
}

/// Commits what the agent left uncommitted in its worktree, with `message` (or a default), which it returns.
fn commit_leftovers<'a>(dir: &Path, message: &'a str) -> GitResult<&'a str> {
    let message = match message.trim() {
        "" => "Agent changes",
        m => m,
    };
    if !git_text(dir, &["status", "--porcelain"])?.trim().is_empty() {
        git(dir, &["add", "-A"])?;
        git(dir, &["commit", "-q", "-m", message])?;
    }
    Ok(message)
}

/// Opens a pull request of the agent's branch into the branch checked out in the repository: what's left
/// uncommitted is committed with `title`, the branch is pushed, then `gh pr create`. Returns the PR's URL.
pub fn publish(repo: &Path, path: &str, title: &str, body: &str) -> GitResult<String> {
    let worktree = owned(repo, &root(repo)?, path)?;
    let dir = Path::new(&worktree.path);
    let base = super::read::head(repo)?
        .branch
        .ok_or_else(|| GitError::invalid("Check out the branch the pull request should target."))?;
    let title = commit_leftovers(dir, title)?;
    super::write::push(dir)?;
    super::github::create_pull_request(dir, &base, title, body, false)
}

/// Removes the worktree and, when asked, its branch: the user confirmed, so uncommitted agent changes go too.
pub fn remove(repo: &Path, path: &str, delete_branch: bool) -> GitResult<()> {
    remove_at(repo, &root(repo)?, path, delete_branch)
}

fn remove_at(repo: &Path, root: &Path, path: &str, delete_branch: bool) -> GitResult<()> {
    let worktree = owned(repo, root, path)?;
    git(repo, &["worktree", "remove", "--force", &worktree.path])?;
    if delete_branch {
        git(repo, &["branch", "-D", &worktree.branch])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::TestRepo;
    use std::fs;

    /// A repository, and a temporary folder standing in for `~/.gitflow/worktrees/<repo>`.
    fn setup() -> (TestRepo, tempfile::TempDir, PathBuf) {
        let repo = TestRepo::new();
        repo.write("a.txt", "one\n");
        repo.commit_all("init");
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        (repo, dir, root)
    }

    #[test]
    fn an_agent_worktree_merges_back_with_its_uncommitted_work() {
        let (repo, _dir, root) = setup();
        let worktree = create_at(repo.path(), &root).unwrap();
        assert_eq!(
            list_at(repo.path(), &root).unwrap(),
            std::slice::from_ref(&worktree)
        );
        fs::write(Path::new(&worktree.path).join("b.txt"), "agent\n").unwrap();
        assert_eq!(
            status_at(repo.path(), &root, &worktree.path)
                .unwrap()
                .changed,
            1
        );
        merge_at(repo.path(), &root, &worktree.path, "add b").unwrap();
        assert_eq!(
            fs::read_to_string(repo.path().join("b.txt")).unwrap(),
            "agent\n"
        );
    }

    #[test]
    fn removing_drops_the_worktree_and_its_branch() {
        let (repo, _dir, root) = setup();
        let worktree = create_at(repo.path(), &root).unwrap();
        remove_at(repo.path(), &root, &worktree.path, true).unwrap();
        assert!(list_at(repo.path(), &root).unwrap().is_empty());
        assert!(repo.git(&["branch", "--list", &worktree.branch]).is_empty());
    }

    #[test]
    fn paths_that_are_not_agent_worktrees_are_refused() {
        let (repo, _dir, root) = setup();
        assert!(owned(repo.path(), &root, "/tmp").is_err());
        let own = repo.path().to_string_lossy().into_owned();
        assert!(remove_at(repo.path(), &root, &own, true).is_err());
    }
}
