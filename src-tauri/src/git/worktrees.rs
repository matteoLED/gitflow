//! Agent worktrees: each isolated agent run works in its own checkout of the repository, on its own branch,
//! so several can run at once without touching the user's files. Its work comes back through a merge.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use super::errors::{GitError, GitResult};
use super::runner::{RunOptions, git, git_text, git_with};

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

/// Full-file context, like the app's other diffs: the viewer folds unchanged runs itself.
const FULL_CONTEXT: &str = "--unified=1000000";

/// Everything the agent did since its branch left the current one: its commits plus what it left uncommitted
/// (new files included), as one multi-file patch.
pub fn diff(repo: &Path, path: &str) -> GitResult<String> {
    diff_at(repo, &root(repo)?, path)
}

fn diff_at(repo: &Path, root: &Path, path: &str) -> GitResult<String> {
    let worktree = owned(repo, root, path)?;
    let base = git_text(repo, &["merge-base", "HEAD", &worktree.branch])?;
    let tree = snapshot(Path::new(&worktree.path))?;
    // One diff from the merge base to everything in the worktree: commits, edits and new files alike.
    git_text(
        repo,
        &[
            "diff",
            "--no-ext-diff",
            "-M",
            FULL_CONTEXT,
            base.trim(),
            &tree,
        ],
    )
}

/// The worktree as it is on disk, committed or not, written as a tree through a throwaway index: the agent's
/// own index and files are left alone. Ignored files stay out, as they would from a commit.
fn snapshot(dir: &Path) -> GitResult<String> {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let index = std::env::temp_dir().join(format!("gitflow-index-{}-{n}", std::process::id()));
    let index_path = index.to_string_lossy().into_owned();
    let opts = RunOptions {
        env: &[("GIT_INDEX_FILE", index_path.as_str())],
        ..RunOptions::default()
    };
    let tree = (|| {
        git_with(dir, &["read-tree", "HEAD"], &opts)?;
        git_with(dir, &["add", "-A"], &opts)?;
        git_with(dir, &["write-tree"], &opts)
    })();
    let _ = std::fs::remove_file(&index);
    Ok(String::from_utf8_lossy(&tree?).trim().to_string())
}

/// The difference between two agents' worktrees, uncommitted work included: what `b` has that `a` doesn't.
pub fn compare(repo: &Path, a: &str, b: &str) -> GitResult<String> {
    compare_at(repo, &root(repo)?, a, b)
}

fn compare_at(repo: &Path, root: &Path, a: &str, b: &str) -> GitResult<String> {
    let (a, b) = (owned(repo, root, a)?, owned(repo, root, b)?);
    // Agents usually leave their work uncommitted: compare what is on disk in each worktree.
    let (a, b) = (snapshot(Path::new(&a.path))?, snapshot(Path::new(&b.path))?);
    git_text(repo, &["diff", "--no-ext-diff", "-M", FULL_CONTEXT, &a, &b])
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
    // Checked before anything is committed or pushed: a run's title is the start of its prompt, possibly
    // several lines, which `gh pr create` would refuse after the push.
    let title = one_line_title(title);
    let title = commit_leftovers(dir, &title)?;
    super::write::push(dir)?;
    super::github::create_pull_request(dir, &base, title, body, false)
}

/// The first non-empty line, without control characters, at most 200 characters.
fn one_line_title(title: &str) -> String {
    let line = title
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("Agent changes");
    line.chars().filter(|c| !c.is_control()).take(200).collect()
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
    fn the_diff_covers_commits_uncommitted_edits_and_new_files() {
        let (repo, _dir, root) = setup();
        let worktree = create_at(repo.path(), &root).unwrap();
        let dir = Path::new(&worktree.path);
        fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        git(dir, &["commit", "-qam", "two"]).unwrap();
        fs::write(dir.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        fs::write(dir.join("new.txt"), "fresh\n").unwrap();
        let patch = diff_at(repo.path(), &root, &worktree.path).unwrap();
        assert!(
            ["+two", "+three", "+fresh", "b/new.txt"]
                .iter()
                .all(|s| patch.contains(s))
        );
    }

    #[test]
    fn comparing_two_worktrees_diffs_their_branches() {
        let (repo, _dir, root) = setup();
        let a = create_at(repo.path(), &root).unwrap();
        let b = create_at(repo.path(), &root).unwrap();
        fs::write(Path::new(&b.path).join("a.txt"), "other\n").unwrap();
        git(Path::new(&b.path), &["commit", "-qam", "b"]).unwrap();
        let patch = compare_at(repo.path(), &root, &a.path, &b.path).unwrap();
        assert!(patch.contains("-one") && patch.contains("+other"));
        assert!(compare_at(repo.path(), &root, &a.path, "/tmp").is_err());
    }

    #[test]
    fn comparing_includes_uncommitted_work_and_leaves_the_index_alone() {
        let (repo, _dir, root) = setup();
        let a = create_at(repo.path(), &root).unwrap();
        let b = create_at(repo.path(), &root).unwrap();
        fs::write(Path::new(&b.path).join("new.txt"), "draft\n").unwrap();
        let patch = compare_at(repo.path(), &root, &a.path, &b.path).unwrap();
        assert!(patch.contains("+draft"));
        assert_eq!(
            git_text(Path::new(&b.path), &["status", "--porcelain"]).unwrap(),
            "?? new.txt\n"
        );
    }

    #[test]
    fn paths_that_are_not_agent_worktrees_are_refused() {
        let (repo, _dir, root) = setup();
        assert!(owned(repo.path(), &root, "/tmp").is_err());
        let own = repo.path().to_string_lossy().into_owned();
        assert!(remove_at(repo.path(), &root, &own, true).is_err());
    }

    #[test]
    fn a_multi_line_prompt_becomes_a_one_line_title() {
        assert_eq!(one_line_title("\n Fix X\nthen Y"), "Fix X");
        assert_eq!(one_line_title("  "), "Agent changes");
    }
}
