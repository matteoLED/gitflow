//! Agent worktrees: each isolated agent run works in its own checkout of the repository, on its own branch,
//! so several can run at once without touching the user's files. Its work comes back through a merge.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use super::errors::{GitError, GitResult};
use super::runner::{RunOptions, git, git_long, git_text, git_with};

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

/// Where agent worktrees live: `~/.local/share/gitflow/worktrees/<repo>-<hash>`, outside the repository (no
/// stray files in it), one folder per repository. Never under a folder named `.git…`: TypeScript ignores
/// symlinks whose path contains `/.git` (its `ignoredPaths`), so in a pnpm workspace under `~/.gitflow` every
/// declaration build failed with TS2883 ("cannot be named without a reference to '.pnpm/…'").
fn root(repo: &Path) -> GitResult<PathBuf> {
    root_in(repo, ".local/share/gitflow/worktrees")
}

/// Where worktrees were made before: still listed and managed until they're merged or deleted.
fn legacy_root(repo: &Path) -> GitResult<PathBuf> {
    root_in(repo, ".gitflow/worktrees")
}

/// The root holding `path`: the legacy one for older worktrees, else today's.
fn root_for(repo: &Path, path: &str) -> GitResult<PathBuf> {
    let legacy = legacy_root(repo)?;
    if Path::new(path).starts_with(&legacy) {
        Ok(legacy)
    } else {
        root(repo)
    }
}

/// A worktree moved out of the legacy root keeps answering to its old path, which the UI still holds.
fn current(repo: &Path, path: &str) -> GitResult<String> {
    current_in(&root(repo)?, &legacy_root(repo)?, path)
}

fn current_in(root: &Path, legacy: &Path, path: &str) -> GitResult<String> {
    let old = Path::new(path);
    if old.starts_with(legacy)
        && !old.exists()
        && let Some(name) = old.file_name()
    {
        let moved = root.join(name);
        if moved.exists() {
            return Ok(moved.to_string_lossy().into_owned());
        }
    }
    Ok(path.into())
}

/// Moves an older worktree out of `~/.gitflow` (see `root`) before its work is committed, so hooks that build
/// TypeScript pass there too. Returns where the worktree is now.
fn relocate(repo: &Path, path: &str) -> GitResult<String> {
    relocate_in(repo, &root(repo)?, &legacy_root(repo)?, path)
}

fn relocate_in(repo: &Path, root: &Path, legacy: &Path, path: &str) -> GitResult<String> {
    let path = current_in(root, legacy, path)?;
    if !Path::new(&path).starts_with(legacy) {
        return Ok(path);
    }
    owned(repo, legacy, &path)?;
    let name = Path::new(&path)
        .file_name()
        .ok_or_else(|| GitError::invalid("This isn't one of the app's agent worktrees."))?;
    std::fs::create_dir_all(root).map_err(|e| GitError::invalid(e.to_string()))?;
    let target = root.join(name).to_string_lossy().into_owned();
    git(repo, &["worktree", "move", &path, &target])?;
    Ok(target)
}

fn root_in(repo: &Path, dir: &str) -> GitResult<PathBuf> {
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
        .join(dir)
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
        // A new branch for an issue starts from the default branch, not from whatever is checked out:
        // otherwise it carries that branch's commits and its PR conflicts once those land another way.
        None if branch.is_some() => fresh_default(repo).unwrap_or_else(|| "HEAD".to_string()),
        None => "HEAD".to_string(),
    };
    let id = new_id();
    std::fs::create_dir_all(root).map_err(|e| GitError::invalid(e.to_string()))?;
    let path = root.join(&id).to_string_lossy().into_owned();
    let wanted = branch.filter(|b| valid_branch(repo, b));
    let mut base = base;
    if let Some(name) = wanted
        && branch_exists(repo, name)
    {
        if !checked_out(repo, name)? {
            git(repo, &["worktree", "add", "-q", &path, name])?;
            return Ok(Worktree {
                path,
                branch: name.into(),
            });
        }
        // Busy elsewhere: a sibling branch, but from this one (its work included), never from scratch.
        base = name.to_string();
    }
    let branch = match wanted {
        Some(name) => unused_name(repo, name),
        None => format!("agent/{id}"),
    };
    git(
        repo,
        &[
            "worktree",
            "add",
            "-q",
            "--no-track",
            "-b",
            &branch,
            &path,
            &base,
        ],
    )?;
    Ok(Worktree { path, branch })
}

/// The remote's default branch, fetched first so the new branch starts from today's state (offline: as last
/// fetched), else the local one.
fn fresh_default(repo: &Path) -> Option<String> {
    let name = super::github::default_base(repo)?;
    let _ = git(repo, &["fetch", "-q", "origin", "--end-of-options", &name]);
    let remote = format!("origin/{name}");
    [remote, name]
        .into_iter()
        .find_map(|r| resolved_commit(repo, &r).ok())
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

/// Where a conversation goes on working on `branch` (its pull request's): the app's worktree already holding
/// it (an earlier run's, or one an agent made there), else a new one on it.
pub fn reopen(repo: &Path, branch: &str) -> GitResult<Worktree> {
    reopen_at(repo, &root(repo)?, &[legacy_root(repo)?], branch)
}

fn reopen_at(repo: &Path, root: &Path, older: &[PathBuf], branch: &str) -> GitResult<Worktree> {
    let mut ours = list_at(repo, root)?;
    for dir in older {
        ours.extend(list_at(repo, dir)?);
    }
    match ours.into_iter().find(|w| w.branch == branch) {
        Some(open) => Ok(open),
        None => create_at(repo, root, None, Some(branch)),
    }
}

/// The repository's agent worktrees (others the user made by hand aren't the app's to touch).
pub fn list(repo: &Path) -> GitResult<Vec<Worktree>> {
    let mut all = list_at(repo, &root(repo)?)?;
    all.extend(list_at(repo, &legacy_root(repo)?)?);
    Ok(all)
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
    let path = &current(repo, path)?;
    owned(repo, &root_for(repo, path)?, path).map(|w| PathBuf::from(w.path))
}

pub fn status(repo: &Path, path: &str) -> GitResult<WorktreeStatus> {
    let path = &current(repo, path)?;
    status_at(repo, &root_for(repo, path)?, path)
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
    let path = &current(repo, path)?;
    diff_at(repo, &root_for(repo, path)?, path)
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
    let (a, b) = (&current(repo, a)?, &current(repo, b)?);
    let (a, b) = (
        owned(repo, &root_for(repo, a)?, a)?,
        owned(repo, &root_for(repo, b)?, b)?,
    );
    compare_worktrees(repo, a, b)
}

#[cfg(test)]
fn compare_at(repo: &Path, root: &Path, a: &str, b: &str) -> GitResult<String> {
    compare_worktrees(repo, owned(repo, root, a)?, owned(repo, root, b)?)
}

fn compare_worktrees(repo: &Path, a: Worktree, b: Worktree) -> GitResult<String> {
    // Agents usually leave their work uncommitted: compare what is on disk in each worktree.
    let (a, b) = (snapshot(Path::new(&a.path))?, snapshot(Path::new(&b.path))?);
    git_text(repo, &["diff", "--no-ext-diff", "-M", FULL_CONTEXT, &a, &b])
}

/// Brings the agent's work into the current branch: what it left uncommitted is committed on its branch first
/// (with `message`), then merged. Conflicts stop the merge like any other, for the user to resolve.
pub fn merge(repo: &Path, path: &str, message: &str, skip_hooks: bool) -> GitResult<()> {
    let path = &relocate(repo, path)?;
    merge_at(repo, &root_for(repo, path)?, path, message, skip_hooks)
}

fn merge_at(
    repo: &Path,
    root: &Path,
    path: &str,
    message: &str,
    skip_hooks: bool,
) -> GitResult<()> {
    let worktree = owned(repo, root, path)?;
    let dir = Path::new(&worktree.path);
    let message = commit_leftovers(dir, message, skip_hooks)?;
    let title = format!("Merge {}: {message}", worktree.branch);
    let mut args = vec!["merge", "--no-ff", "-m", &title, &worktree.branch];
    if skip_hooks {
        args.insert(1, "--no-verify");
    }
    git_long(repo, &args)?;
    // Its work is in the current branch now: the worktree and its branch are done. A merge stopped by
    // conflicts returned above and keeps both, for the user to finish.
    git(repo, &["worktree", "remove", &worktree.path])?;
    git(repo, &["branch", "-d", &worktree.branch]).map(|_| ())
}

/// Frees the agent's branch for the user's checkout: removes its worktree but keeps the branch. Git refuses
/// while the agent left uncommitted work there (no `--force`), so nothing is lost.
pub fn release(repo: &Path, path: &str) -> GitResult<()> {
    let path = &current(repo, path)?;
    release_at(repo, &root_for(repo, path)?, path)
}

fn release_at(repo: &Path, root: &Path, path: &str) -> GitResult<()> {
    let worktree = owned(repo, root, path)?;
    git(repo, &["worktree", "remove", &worktree.path]).map(|_| ())
}

/// Commits what the agent left uncommitted in its worktree, with `message` (or a default), which it returns.
fn commit_leftovers<'a>(dir: &Path, message: &'a str, skip_hooks: bool) -> GitResult<&'a str> {
    let message = match message.trim() {
        "" => "Agent changes",
        m => m,
    };
    if !git_text(dir, &["status", "--porcelain"])?.trim().is_empty() {
        git(dir, &["add", "-A"])?;
        // `skip_hooks`: the user chose to commit past a failing hook (its environment, not the change; CI checks).
        let mut args = vec!["commit", "-q", "-m", message];
        if skip_hooks {
            args.push("--no-verify");
        }
        git_long(dir, &args)?;
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
    skip_hooks: bool,
) -> GitResult<String> {
    let path = &relocate(repo, path)?;
    let worktree = owned(repo, &root_for(repo, path)?, path)?;
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
    let title = commit_leftovers(dir, &title, skip_hooks)?;
    super::write::push_verified(dir, !skip_hooks)?;
    let url = super::github::create_pull_request(dir, &base, title, body, false)?;
    // Committed, pushed, in review: the branch is freed for the user's checkout. Kept if removal fails.
    let _ = git(repo, &["worktree", "remove", &worktree.path]);
    Ok(url)
}

/// Puts the agent's branch on GitHub once it's done: what's left uncommitted is committed with `title`, then
/// the branch is pushed (its upstream set the first time). The pull request is the user's call (`publish`).
pub fn push(repo: &Path, path: &str, title: &str) -> GitResult<()> {
    let path = &relocate(repo, path)?;
    let worktree = owned(repo, &root_for(repo, path)?, path)?;
    let dir = Path::new(&worktree.path);
    commit_leftovers(dir, &one_line_title(title), false)?;
    super::write::push(dir)
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
    let path = &current(repo, path)?;
    remove_at(repo, &root_for(repo, path)?, path, delete_branch)
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
        merge_at(repo.path(), &root, &worktree.path, "add b", false).unwrap();
        assert_eq!(
            fs::read_to_string(repo.path().join("b.txt")).unwrap(),
            "agent\n"
        );
        assert!(list_at(repo.path(), &root).unwrap().is_empty());
        assert!(repo.git(&["branch", "--list", &worktree.branch]).is_empty());
    }

    #[test]
    fn releasing_frees_the_branch_but_refuses_to_drop_uncommitted_work() {
        let (repo, _dir, root) = setup();
        let worktree = create_at(repo.path(), &root, None, Some("issue")).unwrap();
        fs::write(Path::new(&worktree.path).join("b.txt"), "agent\n").unwrap();
        assert!(release_at(repo.path(), &root, &worktree.path).is_err());
        fs::remove_file(Path::new(&worktree.path).join("b.txt")).unwrap();
        release_at(repo.path(), &root, &worktree.path).unwrap();
        repo.git(&["switch", "-q", "issue"]);
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
    fn worktrees_never_live_under_a_dot_git_folder() {
        // TypeScript drops symlinks whose path contains "/.git": pnpm workspaces would stop building.
        let repo = tempfile::tempdir().unwrap();
        let root = super::root(repo.path()).unwrap();
        assert!(!root.to_string_lossy().contains("/.git"));
    }

    #[test]
    fn older_worktrees_move_out_of_dot_gitflow_and_keep_their_old_path() {
        let (repo, _dir, legacy) = setup();
        let home = tempfile::tempdir().unwrap();
        let new_root = home.path().canonicalize().unwrap().join("worktrees");
        let old = create_at(repo.path(), &legacy, None, None).unwrap();
        std::fs::write(Path::new(&old.path).join("work.txt"), "kept\n").unwrap();
        let moved = relocate_in(repo.path(), &new_root, &legacy, &old.path).unwrap();
        assert!(Path::new(&moved).starts_with(&new_root));
        assert!(Path::new(&moved).join("work.txt").exists());
        assert_eq!(current_in(&new_root, &legacy, &old.path).unwrap(), moved);
    }

    #[test]
    fn a_conversation_continues_in_the_worktree_holding_its_branch() {
        let (repo, _dir, root) = setup();
        let first = create_at(repo.path(), &root, None, Some("feature")).unwrap();
        let again = reopen_at(repo.path(), &root, &[], "feature").unwrap();
        assert_eq!(again, first);
    }

    #[test]
    fn a_branch_checked_out_by_the_user_gets_a_sibling_with_its_work() {
        let (repo, _dir, root) = setup();
        repo.git(&["switch", "-q", "-c", "feature"]);
        repo.write("work.txt", "x\n");
        repo.commit_all("work");
        let sibling = create_at(repo.path(), &root, None, Some("feature")).unwrap();
        assert_eq!(sibling.branch, "feature-2");
        assert!(Path::new(&sibling.path).join("work.txt").exists());
    }

    #[test]
    fn an_issue_branch_starts_from_the_default_branch_not_the_checked_out_one() {
        let (repo, _dir, root) = setup();
        repo.git(&["branch", "-M", "main"]);
        repo.git(&["switch", "-q", "-c", "feature"]);
        repo.write("feature.txt", "x\n");
        repo.commit_all("feature work");
        let worktree = create_at(repo.path(), &root, None, Some("issue-branch")).unwrap();
        assert!(!Path::new(&worktree.path).join("feature.txt").exists());
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
