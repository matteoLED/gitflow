//! Watches the open repository (FSEvents on macOS) so the UI refreshes on change instead of polling
//! `git status`. Bursts are coalesced into one `repo-changed` event once it settles (a long burst: once a second).

use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{RecvTimeoutError, channel};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::git::errors::{ErrorKind, GitError, GitResult};

/// A burst ends after this much quiet...
const DEBOUNCE: Duration = Duration::from_millis(150);
/// ...or is flushed after this long anyway, so a checkout or an install doesn't refresh the UI 4x a second.
const MAX_DELAY: Duration = Duration::from_secs(1);
/// Build output and dependencies change constantly and never matter to Git's view of the tree.
const IGNORED: [&str; 9] = [
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".expo",
    ".dart_tool",
    ".cache",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Change {
    /// Files of the working tree.
    Worktree,
    /// HEAD, refs or the index (commits, checkouts, fetches, staging).
    Git,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoChanged {
    pub repo_path: String,
    pub worktree: bool,
    pub git: bool,
}

/// What a changed path means for the UI; None when it can be ignored.
pub fn classify(repo: &Path, path: &Path) -> Option<Change> {
    let rel = path.strip_prefix(repo).ok()?;
    let mut parts = rel.components().filter_map(|c| match c {
        Component::Normal(name) => name.to_str(),
        _ => None,
    });
    let first = parts.next()?;
    if first == ".git" {
        // Object writes are noise; HEAD, refs, index and packed-refs are what the UI shows.
        return match parts.next() {
            Some("objects" | "logs" | "hooks" | "lfs") => None,
            Some(name) if name.ends_with(".lock") => None,
            _ => Some(Change::Git),
        };
    }
    let ignored = std::iter::once(first)
        .chain(parts)
        .any(|p| IGNORED.contains(&p));
    (!ignored).then_some(Change::Worktree)
}

static CURRENT: OnceLock<Mutex<Option<(PathBuf, RecommendedWatcher)>>> = OnceLock::new();

/// Watches `repo` (replacing any previous watch): only the active repository is watched.
pub fn watch(app: AppHandle, repo: &Path) -> GitResult<()> {
    let slot = CURRENT.get_or_init(Default::default);
    let mut current = slot
        .lock()
        .map_err(|_| GitError::new(ErrorKind::Io, "Watcher lock poisoned"))?;
    if current.as_ref().is_some_and(|(path, _)| path == repo) {
        return Ok(());
    }
    let (tx, rx) = channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(tx).map_err(|err| {
        GitError::new(ErrorKind::Io, format!("Can't watch the repository: {err}"))
    })?;
    watcher
        .watch(repo, RecursiveMode::Recursive)
        .map_err(|err| {
            GitError::new(ErrorKind::Io, format!("Can't watch the repository: {err}"))
        })?;
    let root = repo.to_path_buf();
    *current = Some((root.clone(), watcher));

    thread::spawn(move || {
        let (mut worktree, mut git) = (false, false);
        // First and latest relevant change of the pending burst.
        let mut burst = None::<(Instant, Instant)>;
        loop {
            match rx.recv_timeout(DEBOUNCE) {
                Ok(Ok(event)) => {
                    for path in &event.paths {
                        match classify(&root, path) {
                            Some(Change::Worktree) => worktree = true,
                            Some(Change::Git) => git = true,
                            None => continue,
                        }
                        let now = Instant::now();
                        burst = Some((burst.map_or(now, |(first, _)| first), now));
                    }
                }
                Ok(Err(_)) => {}
                Err(RecvTimeoutError::Disconnected) => break, // watcher replaced or dropped
                Err(RecvTimeoutError::Timeout) => {}
            }
            let settled = burst.is_some_and(|(first, last)| {
                last.elapsed() >= DEBOUNCE || first.elapsed() >= MAX_DELAY
            });
            if settled {
                let payload = RepoChanged {
                    repo_path: root.to_string_lossy().into_owned(),
                    worktree,
                    git,
                };
                let _ = app.emit("repo-changed", payload);
                (worktree, git, burst) = (false, false, None);
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const REPO: &str = "/r";
    fn kind(path: &str) -> Option<Change> {
        classify(Path::new(REPO), Path::new(path))
    }

    #[test]
    fn source_files_are_worktree_changes() {
        assert_eq!(kind("/r/src/main.rs"), Some(Change::Worktree));
    }

    #[test]
    fn dependencies_and_build_output_are_ignored() {
        assert_eq!(
            (
                kind("/r/node_modules/x/index.js"),
                kind("/r/apps/web/.next/cache/a")
            ),
            (None, None)
        );
    }

    #[test]
    fn refs_and_index_are_git_changes_but_objects_are_not() {
        assert_eq!(
            (
                kind("/r/.git/refs/heads/main"),
                kind("/r/.git/index"),
                kind("/r/.git/objects/ab/cd")
            ),
            (Some(Change::Git), Some(Change::Git), None)
        );
    }
}
