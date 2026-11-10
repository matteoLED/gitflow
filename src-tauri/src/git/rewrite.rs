//! Rewriting history from the commit list: cherry-pick, revert, and an interactive rebase run without an editor.
//! Each one refuses on a dirty working tree; one that stops on conflicts hands over to `conflicts`.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::conflicts;
use super::errors::{ErrorKind, GitError, GitResult};
use super::runner::{NETWORK_TIMEOUT, RunOptions, git, git_text, git_with};
use super::validate;

const MAX_REBASE_COMMITS: usize = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Outcome {
    Done,
    /// Stopped on conflicts (or a failed step): the operation bar takes over.
    Stopped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RebaseAction {
    Pick,
    Reword,
    Squash,
    Fixup,
    Drop,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseStep {
    pub hash: String,
    pub action: RebaseAction,
    /// The new message, for `reword` only.
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseCommit {
    pub hash: String,
    pub subject: String,
    pub message: String,
    pub author: String,
    pub authored_at: String,
}

fn ensure_ready(repo: &Path) -> GitResult<()> {
    if conflicts::operation(repo)?.is_some() {
        return Err(GitError::invalid(
            "Finish or abort the operation in progress first.",
        ));
    }
    let status = git_text(repo, &["status", "--porcelain", "--untracked-files=no"])?;
    if !status.trim().is_empty() {
        return Err(GitError::new(
            ErrorKind::DirtyWorkingTree,
            "You have uncommitted changes: commit or stash them first.",
        ));
    }
    Ok(())
}

/// The full hash of a commit given by the UI.
fn full_hash(repo: &Path, hash: &str) -> GitResult<String> {
    let spec = format!("{}^{{commit}}", validate::object_id(hash)?);
    git_text(repo, &["rev-parse", "--verify", "--quiet", &spec])
        .map(|s| s.trim().to_string())
        .map_err(|_| GitError::invalid("This commit doesn't exist in the repository."))
}

fn parent_count(repo: &Path, sha: &str) -> GitResult<usize> {
    let line = git_text(repo, &["rev-list", "--parents", "-n", "1", sha])?;
    Ok(line.split_whitespace().count().saturating_sub(1))
}

fn is_ancestor(repo: &Path, ancestor: &str, of: &str) -> bool {
    git_text(repo, &["merge-base", ancestor, of]).is_ok_and(|base| base.trim() == ancestor)
}

fn on_a_remote(repo: &Path, sha: &str) -> GitResult<bool> {
    let out = git_text(repo, &["branch", "-r", "--contains", sha])?;
    Ok(!out.trim().is_empty())
}

/// A failure that left an operation in progress is a stop on conflicts, not an error.
fn finish(repo: &Path, result: GitResult<Vec<u8>>) -> GitResult<Outcome> {
    match result {
        Ok(_) => Ok(Outcome::Done),
        Err(_) if conflicts::operation(repo)?.is_some() => Ok(Outcome::Stopped),
        Err(err) => Err(err),
    }
}

fn single_parent_commit(repo: &Path, hash: &str, verb: &str) -> GitResult<String> {
    let sha = full_hash(repo, hash)?;
    if parent_count(repo, &sha)? > 1 {
        return Err(GitError::invalid(format!(
            "Merge commits can't be {verb} from here."
        )));
    }
    Ok(sha)
}

pub fn cherry_pick(repo: &Path, hash: &str) -> GitResult<Outcome> {
    ensure_ready(repo)?;
    let sha = single_parent_commit(repo, hash, "cherry-picked")?;
    if is_ancestor(repo, &sha, "HEAD") {
        return Err(GitError::invalid(
            "This commit is already on the current branch.",
        ));
    }
    finish(repo, git(repo, &["cherry-pick", &sha]))
}

pub fn revert(repo: &Path, hash: &str) -> GitResult<Outcome> {
    ensure_ready(repo)?;
    let sha = single_parent_commit(repo, hash, "reverted")?;
    finish(repo, git(repo, &["revert", "--no-edit", &sha]))
}

/// The commits from `from` up to HEAD, oldest first, with their full messages.
pub fn rebase_plan(repo: &Path, from: &str) -> GitResult<Vec<RebaseCommit>> {
    let from = full_hash(repo, from)?;
    if !is_ancestor(repo, &from, "HEAD") {
        return Err(GitError::invalid(
            "This commit isn't on the current branch.",
        ));
    }
    let range = match parent_of(repo, &from) {
        Some(parent) => format!("{parent}..HEAD"),
        None => "HEAD".to_string(),
    };
    let out = git(
        repo,
        &[
            "log",
            "--reverse",
            "--format=%H%x00%P%x00%an%x00%aI%x00%B%x1e",
            "--end-of-options",
            &range,
            "--",
        ],
    )?;
    let text = String::from_utf8_lossy(&out);
    let mut commits = Vec::new();
    for record in text
        .split('\x1e')
        .map(str::trim_start)
        .filter(|r| !r.is_empty())
    {
        let fields: Vec<&str> = record.splitn(5, '\0').collect();
        let [hash, parents, author, date, message] = fields[..] else {
            continue;
        };
        if parents.split_whitespace().count() > 1 {
            return Err(GitError::invalid(
                "There are merge commits in this range: interactive rebase only handles a straight line of commits.",
            ));
        }
        let message = message.trim_end().to_string();
        commits.push(RebaseCommit {
            hash: hash.to_string(),
            subject: message.lines().next().unwrap_or_default().to_string(),
            message,
            author: author.to_string(),
            authored_at: date.to_string(),
        });
    }
    if commits.len() > MAX_REBASE_COMMITS {
        return Err(GitError::invalid(format!(
            "Too many commits to rebase at once (more than {MAX_REBASE_COMMITS})."
        )));
    }
    Ok(commits)
}

fn parent_of(repo: &Path, sha: &str) -> Option<String> {
    let spec = format!("{sha}^1");
    git_text(repo, &["rev-parse", "--verify", "--quiet", &spec])
        .ok()
        .map(|s| s.trim().to_string())
}

/// Checks the steps cover exactly the planned commits and make sense; returns the first rewritten index.
fn check_steps(plan: &[RebaseCommit], steps: &[RebaseStep]) -> GitResult<Option<usize>> {
    let mut planned: Vec<&str> = plan.iter().map(|c| c.hash.as_str()).collect();
    let mut given: Vec<&str> = steps.iter().map(|s| s.hash.as_str()).collect();
    planned.sort_unstable();
    given.sort_unstable();
    if planned != given {
        return Err(GitError::invalid(
            "The branch changed since the list was opened: reopen it.",
        ));
    }
    match steps.iter().find(|s| s.action != RebaseAction::Drop) {
        None => return Err(GitError::invalid("Keep at least one commit.")),
        Some(s) if matches!(s.action, RebaseAction::Squash | RebaseAction::Fixup) => {
            return Err(GitError::invalid(
                "The first kept commit can't be squashed: there's nothing before it.",
            ));
        }
        _ => {}
    }
    let empty_reword = steps.iter().any(|s| {
        s.action == RebaseAction::Reword && s.message.as_deref().is_none_or(|m| m.trim().is_empty())
    });
    if empty_reword {
        return Err(GitError::invalid("A reworded commit needs a message."));
    }
    Ok(steps
        .iter()
        .zip(plan)
        .position(|(s, c)| s.action != RebaseAction::Pick || s.hash != c.hash))
}

/// The todo list git reads. A reword is a pick, then an amend with the new message once its squashes are in.
fn build_todo(
    steps: &[RebaseStep],
    mut message_file: impl FnMut(&str) -> GitResult<String>,
) -> GitResult<String> {
    let mut todo = String::new();
    let mut pending: Option<String> = None;
    for step in steps {
        let starts_group = matches!(step.action, RebaseAction::Pick | RebaseAction::Reword);
        if starts_group {
            flush(&mut todo, pending.take());
        }
        let word = match step.action {
            RebaseAction::Pick | RebaseAction::Reword => "pick",
            RebaseAction::Squash => "squash",
            RebaseAction::Fixup => "fixup",
            RebaseAction::Drop => "drop",
        };
        todo.push_str(&format!("{word} {}\n", step.hash));
        if step.action == RebaseAction::Reword {
            pending = Some(message_file(step.message.as_deref().unwrap_or_default())?);
        }
    }
    flush(&mut todo, pending);
    Ok(todo)
}

fn flush(todo: &mut String, message_file: Option<String>) {
    if let Some(path) = message_file {
        todo.push_str(&format!(
            "exec git commit --amend --quiet --allow-empty --no-verify --file={path}\n"
        ));
    }
}

/// Only characters a shell takes literally: these paths end up in the editor command and `exec` lines.
fn shell_safe(path: &Path) -> GitResult<String> {
    path.to_str()
        .filter(|p| {
            !p.is_empty()
                && p.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"/_.-".contains(&b))
        })
        .map(str::to_string)
        .ok_or_else(|| {
            GitError::invalid(
                "The temporary folder's path has unusual characters: the rebase can't run safely.",
            )
        })
}

/// A new file under the temp dir with an app-generated name, never one that already exists.
fn temp_file(kind: &str, content: &str) -> GitResult<PathBuf> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let name = format!(
        "gitflow-{kind}-{}-{nanos}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let path = std::env::temp_dir().join(name);
    shell_safe(&path)?;
    let io = |e: std::io::Error| GitError::new(ErrorKind::Io, e.to_string());
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(io)?;
    file.write_all(content.as_bytes()).map_err(io)?;
    Ok(path)
}

/// Rebases from `from` (included) to HEAD following `steps`, oldest first, without opening any editor.
/// Refuses to rewrite commits already on a remote unless `confirmed`.
pub fn interactive_rebase(
    repo: &Path,
    from: &str,
    steps: &[RebaseStep],
    confirmed: bool,
) -> GitResult<Outcome> {
    ensure_ready(repo)?;
    let plan = rebase_plan(repo, from)?;
    let Some(first) = check_steps(&plan, steps)? else {
        return Ok(Outcome::Done);
    };
    if !confirmed && on_a_remote(repo, &plan[first].hash)? {
        return Err(GitError::new(
            ErrorKind::AlreadyPushed,
            "These commits are already on origin; you'll need to force-push.",
        ));
    }
    let mut files = Vec::new();
    let result = run_rebase(repo, &plan[0].hash, steps, &mut files);
    let outcome = finish(repo, result);
    // ponytail: on a stop, later `exec` lines still need their message files; the OS temp cleanup removes them.
    if !matches!(outcome, Ok(Outcome::Stopped)) {
        for file in files {
            let _ = std::fs::remove_file(file);
        }
    }
    outcome
}

fn run_rebase(
    repo: &Path,
    oldest: &str,
    steps: &[RebaseStep],
    files: &mut Vec<PathBuf>,
) -> GitResult<Vec<u8>> {
    let todo = build_todo(steps, |message| {
        let path = temp_file("msg", &format!("{}\n", message.trim()))?;
        files.push(path.clone());
        shell_safe(&path)
    })?;
    let todo_path = temp_file("todo", &todo)?;
    let editor = format!("cp {}", shell_safe(&todo_path)?);
    files.push(todo_path);
    let parent = parent_of(repo, oldest);
    let mut args = vec!["rebase", "--interactive"];
    match &parent {
        Some(parent) => args.push(parent),
        None => args.push("--root"),
    }
    let env = [
        ("GIT_SEQUENCE_EDITOR", editor.as_str()),
        ("GIT_EDITOR", "true"),
    ];
    git_with(
        repo,
        &args,
        &RunOptions {
            timeout: NETWORK_TIMEOUT,
            env: &env,
            ..RunOptions::default()
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::TestRepo;

    /// Commits a, b, c on top of "init", each adding its own file.
    fn three() -> (TestRepo, Vec<String>) {
        let repo = TestRepo::new();
        repo.write("init.txt", "init\n");
        repo.commit_all("init");
        let hashes = ["a", "b", "c"]
            .iter()
            .map(|name| {
                repo.write(&format!("{name}.txt"), name);
                repo.commit_all(name)
            })
            .collect();
        (repo, hashes)
    }

    fn step(hash: &str, action: RebaseAction) -> RebaseStep {
        RebaseStep {
            hash: hash.to_string(),
            action,
            message: None,
        }
    }

    fn subjects(repo: &TestRepo) -> String {
        repo.git(&["log", "--format=%s", "--reverse"])
    }

    #[test]
    fn plan_lists_commits_oldest_first() {
        let (repo, h) = three();
        let plan = rebase_plan(repo.path(), &h[1]).unwrap();
        let hashes: Vec<_> = plan.iter().map(|c| c.hash.clone()).collect();
        assert_eq!(hashes, vec![h[1].clone(), h[2].clone()]);
    }

    #[test]
    fn reorders_commits() {
        let (repo, h) = three();
        let steps = [
            step(&h[2], RebaseAction::Pick),
            step(&h[0], RebaseAction::Pick),
            step(&h[1], RebaseAction::Pick),
        ];
        interactive_rebase(repo.path(), &h[0], &steps, false).unwrap();
        assert_eq!(subjects(&repo), "init\nc\na\nb");
    }

    #[test]
    fn drops_a_commit() {
        let (repo, h) = three();
        let steps = [
            step(&h[0], RebaseAction::Pick),
            step(&h[1], RebaseAction::Drop),
            step(&h[2], RebaseAction::Pick),
        ];
        interactive_rebase(repo.path(), &h[0], &steps, false).unwrap();
        assert_eq!(subjects(&repo), "init\na\nc");
    }

    #[test]
    fn squash_keeps_both_messages_without_an_editor() {
        let (repo, h) = three();
        let steps = [
            step(&h[0], RebaseAction::Pick),
            step(&h[1], RebaseAction::Squash),
            step(&h[2], RebaseAction::Fixup),
        ];
        interactive_rebase(repo.path(), &h[0], &steps, false).unwrap();
        assert_eq!(repo.git(&["log", "-1", "--format=%B"]), "a\n\nb");
    }

    #[test]
    fn rewords_a_commit_with_a_multiline_message() {
        let (repo, h) = three();
        let mut reword = step(&h[1], RebaseAction::Reword);
        reword.message = Some("New title\n\nWith a body; and $(quotes) \"too\"".into());
        let steps = [
            step(&h[0], RebaseAction::Pick),
            reword,
            step(&h[2], RebaseAction::Pick),
        ];
        interactive_rebase(repo.path(), &h[0], &steps, false).unwrap();
        assert_eq!(
            repo.git(&["log", "-1", "--format=%B", "HEAD~1"]),
            "New title\n\nWith a body; and $(quotes) \"too\""
        );
    }

    #[test]
    fn rebases_from_the_root_commit() {
        let (repo, h) = three();
        let root = repo.git(&["rev-list", "--max-parents=0", "HEAD"]);
        let mut steps = vec![step(&root, RebaseAction::Pick)];
        steps.extend(h.iter().map(|x| step(x, RebaseAction::Pick)));
        steps.swap(2, 3);
        interactive_rebase(repo.path(), &root, &steps, false).unwrap();
        assert_eq!(subjects(&repo), "init\na\nc\nb");
    }

    #[test]
    fn refuses_with_uncommitted_changes() {
        let (repo, h) = three();
        repo.write("a.txt", "dirty");
        let err = interactive_rebase(repo.path(), &h[0], &[], false).unwrap_err();
        assert_eq!(err.kind, ErrorKind::DirtyWorkingTree);
    }

    #[test]
    fn refuses_pushed_commits_until_confirmed() {
        let (repo, h) = three();
        repo.git(&["update-ref", "refs/remotes/origin/main", &h[2]]);
        let steps = [
            step(&h[0], RebaseAction::Pick),
            step(&h[1], RebaseAction::Drop),
            step(&h[2], RebaseAction::Pick),
        ];
        let err = interactive_rebase(repo.path(), &h[0], &steps, false).unwrap_err();
        assert_eq!(err.kind, ErrorKind::AlreadyPushed);
    }

    #[test]
    fn refuses_steps_that_do_not_match_the_branch() {
        let (repo, h) = three();
        let steps = [step(&h[0], RebaseAction::Pick)];
        assert!(interactive_rebase(repo.path(), &h[0], &steps, false).is_err());
    }

    #[test]
    fn todo_puts_the_reword_after_its_squashes() {
        let steps = [
            RebaseStep {
                message: Some("m".into()),
                ..step("aa", RebaseAction::Reword)
            },
            step("bb", RebaseAction::Squash),
            step("cc", RebaseAction::Pick),
        ];
        let todo = build_todo(&steps, |_| Ok("/tmp/msg".into())).unwrap();
        assert_eq!(
            todo,
            "pick aa\nsquash bb\nexec git commit --amend --quiet --allow-empty --no-verify --file=/tmp/msg\npick cc\n"
        );
    }

    #[test]
    fn cherry_picks_a_commit_from_another_branch() {
        let (repo, h) = three();
        repo.git(&["checkout", "-q", "-b", "other", &h[0]]);
        assert_eq!(cherry_pick(repo.path(), &h[2]).unwrap(), Outcome::Done);
        assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "c");
    }

    #[test]
    fn reverts_a_commit() {
        let (repo, h) = three();
        revert(repo.path(), &h[1]).unwrap();
        assert!(!repo.path().join("b.txt").exists());
    }

    #[test]
    fn a_conflicting_cherry_pick_stops_for_the_operation_bar() {
        let (repo, h) = three();
        repo.git(&["checkout", "-q", "-b", "other", &h[0]]);
        repo.write("c.txt", "conflict");
        repo.commit_all("other c");
        assert_eq!(cherry_pick(repo.path(), &h[2]).unwrap(), Outcome::Stopped);
    }
}
