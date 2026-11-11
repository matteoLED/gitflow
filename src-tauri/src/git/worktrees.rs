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

/// A new worktree from `base` (an existing commit-ish, e.g. a PR's head) or the current HEAD. The user's own
/// checkout is never touched: uncommitted changes stay where they are. It's on a new `agent/<id>` branch, or on
/// `branch` when given: reused if it exists and isn't checked out elsewhere (then `base` is ignored), else
/// `branch-2`, `-3`… An invalid name falls back to `agent/<id>`.
pub fn create(repo: &Path, base: Option<&str>, branch: Option<&str>) -> GitResult<Worktree> {
    create_at(repo, &root(repo)?, base, branch)
}

fn create_at(
    repo: &Path,
    root: &Path,
    base: Option<&str>,
    branch: Option<&str>,
) -> GitResult<Worktree> {
    let base = match base {
        Some(name) => resolved_commit(repo, name)?,
        None => "HEAD".to_string(),
    };
    let id = new_id();
    std::fs::create_dir_all(root).map_err(|e| GitError::invalid(e.to_string()))?;
    let path = root.join(&id).to_string_lossy().into_owned();
    let wanted = branch.filter(|b| valid_branch(repo, b));
    if let Some(name) = wanted
        && branch_exists(repo, name)
        && !checked_out(repo, name)?
    {
        git(repo, &["worktree", "add", "-q", &path, name])?;
        return Ok(Worktree {
            path,
            branch: name.into(),
        });
    }
    let branch = match wanted {
        Some(name) => unused_name(repo, name),
        None => format!("agent/{id}"),
    };
    git(
        repo,
        &["worktree", "add", "-q", "-b", &branch, &path, &base],
    )?;
    Ok(Worktree { path, branch })
}

/// A well-formed branch name (no `@{-1}` shorthands, no leading dash that could pass for a flag).
fn valid_branch(repo: &Path, name: &str) -> bool {
    !name.starts_with('-')
        && git(repo, &["check-ref-format", &format!("refs/heads/{name}")]).is_ok()
}

fn branch_exists(repo: &Path, name: &str) -> bool {
    let full = format!("refs/heads/{name}");
    git(repo, &["rev-parse", "--verify", "--quiet", &full]).is_ok()
}

/// Whether any worktree of the repository (its main one included) has `name` checked out.
fn checked_out(repo: &Path, name: &str) -> GitResult<bool> {
    let line = format!("branch refs/heads/{name}");
    Ok(git_text(repo, &["worktree", "list", "--porcelain"])?
        .lines()
        .any(|l| l == line))
}

/// `name` if free, else the first of `name-2`, `name-3`… that doesn't exist yet.
fn unused_name(repo: &Path, name: &str) -> String {
    std::iter::once(name.to_string())
        .chain((2..).map(|n| format!("{name}-{n}")))
        .find(|b| !branch_exists(repo, b))
        .unwrap_or_default()
}

/// The commit a validated revision names, refused when it doesn't exist here.
fn resolved_commit(repo: &Path, name: &str) -> GitResult<String> {
    let name = super::validate::revision(name.trim())?;
    let commit = format!("{name}^{{commit}}");
    git_text(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            "--end-of-options",
            &commit,
        ],
    )
    .map(|out| out.trim().to_string())
    .map_err(|_| {
        GitError::invalid(format!(
            "“{name}” isn't in this repository yet: fetch, then try again."
        ))
    })
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
pub(crate) fn snapshot(dir: &Path) -> GitResult<String> {
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
/// Opens the pull request into `target` (a failing PR's branch the agent fixed), else the checked-out branch.
pub fn publish(
    repo: &Path,
    path: &str,
    title: &str,
    body: &str,
    target: Option<&str>,
) -> GitResult<String> {
    let worktree = owned(repo, &root(repo)?, path)?;
    let dir = Path::new(&worktree.path);
    let base = match target {
        Some(target) => super::validate::revision(target)?.to_string(),
        None => super::read::head(repo)?.branch.ok_or_else(|| {
            GitError::invalid("Check out the branch the pull request should target.")
        })?,
    };
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
        let worktree = create_at(repo.path(), &root, None, None).unwrap();
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
    fn a_worktree_can_start_from_another_commit_without_touching_the_checkout() {
        let (repo, _dir, root) = setup();
        repo.git(&["branch", "pr-head"]);
        repo.write("a.txt", "two\n");
        repo.commit_all("next");
        let worktree = create_at(repo.path(), &root, Some("pr-head"), None).unwrap();
        assert_eq!(
            fs::read_to_string(Path::new(&worktree.path).join("a.txt")).unwrap(),
            "one\n"
        );
    }

    #[test]
    fn a_worktree_base_that_is_an_option_or_unknown_is_refused() {
        let (repo, _dir, root) = setup();
        assert!(create_at(repo.path(), &root, Some("--orphan"), None).is_err());
        assert!(create_at(repo.path(), &root, Some("nope"), None).is_err());
    }

    #[test]
    fn removing_drops_the_worktree_and_its_branch() {
        let (repo, _dir, root) = setup();
        let worktree = create_at(repo.path(), &root, None, None).unwrap();
        remove_at(repo.path(), &root, &worktree.path, true).unwrap();
        assert!(list_at(repo.path(), &root).unwrap().is_empty());
        assert!(repo.git(&["branch", "--list", &worktree.branch]).is_empty());
    }

    #[test]
    fn the_diff_covers_commits_uncommitted_edits_and_new_files() {
        let (repo, _dir, root) = setup();
        let worktree = create_at(repo.path(), &root, None, None).unwrap();
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
        let a = create_at(repo.path(), &root, None, None).unwrap();
        let b = create_at(repo.path(), &root, None, None).unwrap();
        fs::write(Path::new(&b.path).join("a.txt"), "other\n").unwrap();
        git(Path::new(&b.path), &["commit", "-qam", "b"]).unwrap();
        let patch = compare_at(repo.path(), &root, &a.path, &b.path).unwrap();
        assert!(patch.contains("-one") && patch.contains("+other"));
        assert!(compare_at(repo.path(), &root, &a.path, "/tmp").is_err());
    }

    #[test]
    fn comparing_includes_uncommitted_work_and_leaves_the_index_alone() {
        let (repo, _dir, root) = setup();
        let a = create_at(repo.path(), &root, None, None).unwrap();
        let b = create_at(repo.path(), &root, None, None).unwrap();
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
    fn a_named_branch_is_created_then_reused_or_suffixed() {
        let (repo, _dir, root) = setup();
        let name = Some("mat/eng-1-fix");
        let first = create_at(repo.path(), &root, None, name).unwrap();
        assert_eq!(first.branch, "mat/eng-1-fix");
        // Still checked out in the first worktree: a suffixed branch instead.
        let second = create_at(repo.path(), &root, None, name).unwrap();
        assert_eq!(second.branch, "mat/eng-1-fix-2");
        remove_at(repo.path(), &root, &first.path, false).unwrap();
        // Free again: reused as is.
        let third = create_at(repo.path(), &root, None, name).unwrap();
        assert_eq!(third.branch, "mat/eng-1-fix");
    }

    #[test]
    fn an_invalid_branch_name_falls_back_to_an_agent_branch() {
        let (repo, _dir, root) = setup();
        for bad in ["bad..name", "-x", "@{-1}"] {
            let worktree = create_at(repo.path(), &root, None, Some(bad)).unwrap();
            assert!(worktree.branch.starts_with("agent/"));
        }
    }

    #[test]
    fn a_multi_line_prompt_becomes_a_one_line_title() {
        assert_eq!(one_line_title("\n Fix X\nthen Y"), "Fix X");
        assert_eq!(one_line_title("  "), "Agent changes");
    }
}
