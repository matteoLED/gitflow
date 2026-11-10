//! Submodules: read their state, and init/update them on an explicit click only.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::Serialize;

use super::errors::GitResult;
use super::runner::{NETWORK_TIMEOUT, RunOptions, extended_path, git_text, git_with};
use super::validate;

const MAX_SUBMODULES: usize = 500;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SubmoduleState {
    UpToDate,
    Uninitialized,
    /// Checked out at another commit than the one the superproject records.
    OutOfDate,
    /// Uncommitted or untracked changes inside the submodule.
    Modified,
    Conflicted,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Submodule {
    /// Relative to the repository root (nested submodules included).
    pub path: String,
    /// Commit the superproject records.
    pub recorded: String,
    /// Commit checked out in the submodule; `None` when not initialized.
    pub checked_out: Option<String>,
    pub state: SubmoduleState,
}

/// `git submodule status` lines: a state flag, the sha, the path, then an optional `(describe)`.
fn parse_status(text: &str) -> Vec<(char, String, String)> {
    text.lines()
        .filter_map(|line| {
            let flag = line.chars().next()?;
            let (sha, rest) = line[flag.len_utf8()..].split_once(' ')?;
            let path = rest.rsplit_once(" (").map_or(rest, |(path, _)| path);
            Some((flag, sha.to_string(), path.to_string()))
        })
        .take(MAX_SUBMODULES)
        .collect()
}

/// Paths of top-level submodules with changes inside (`S.M.` / `S..U` in porcelain v2).
fn dirty_submodules(repo: &Path) -> GitResult<HashSet<String>> {
    let text = git_text(repo, &["status", "--porcelain=v2", "--untracked-files=no"])?;
    Ok(text
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.splitn(9, ' ').collect();
            let sub = fields.get(2)?.as_bytes();
            let dirty =
                line.starts_with("1 ") && sub[0] == b'S' && (sub[2] == b'M' || sub[3] == b'U');
            dirty
                .then(|| fields.get(8).map(|p| p.to_string()))
                .flatten()
        })
        .collect())
}

pub fn list(repo: &Path) -> GitResult<Vec<Submodule>> {
    if !repo.join(".gitmodules").is_file() {
        return Ok(Vec::new());
    }
    let actual = parse_status(&git_text(repo, &["submodule", "status", "--recursive"])?);
    let recorded: HashMap<String, String> = parse_status(&git_text(
        repo,
        &["submodule", "status", "--cached", "--recursive"],
    )?)
    .into_iter()
    .map(|(_, sha, path)| (path, sha))
    .collect();
    let dirty = dirty_submodules(repo)?;
    Ok(actual
        .into_iter()
        .map(|(flag, sha, path)| {
            let state = match flag {
                '-' => SubmoduleState::Uninitialized,
                '+' => SubmoduleState::OutOfDate,
                'U' => SubmoduleState::Conflicted,
                _ if dirty.contains(&path) => SubmoduleState::Modified,
                _ => SubmoduleState::UpToDate,
            };
            Submodule {
                recorded: recorded.get(&path).cloned().unwrap_or_else(|| sha.clone()),
                checked_out: (state != SubmoduleState::Uninitialized).then_some(sha),
                path,
                state,
            }
        })
        .collect())
}

/// `git submodule update --init --recursive`, for one submodule or all. Never `--force`: local
/// changes inside a submodule make git refuse rather than lose them.
pub fn init_update(repo: &Path, path: Option<&str>) -> GitResult<()> {
    let mut args = vec!["submodule", "update", "--init", "--recursive", "--"];
    if let Some(path) = path {
        args.push(validate::relative_path(path)?);
    }
    let path_env = extended_path();
    let opts = RunOptions {
        timeout: NETWORK_TIMEOUT,
        env: &[("PATH", &path_env)],
        ..RunOptions::default()
    };
    git_with(repo, &args, &opts).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::TestRepo;

    /// A superproject with `lib` as a submodule, both committed.
    fn superproject() -> (TestRepo, TestRepo) {
        let lib = TestRepo::new();
        lib.write("lib.txt", "v1");
        lib.commit_all("lib v1");
        let main = TestRepo::new();
        let url = lib.path().to_string_lossy().into_owned();
        main.git(&[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            &url,
            "lib",
        ]);
        main.commit_all("add lib");
        (main, lib)
    }

    #[test]
    fn parses_flags_paths_with_spaces_and_describe() {
        let parsed = parse_status("-abc my lib (v1.0)\n abd other\n");
        assert_eq!(
            parsed,
            vec![
                ('-', "abc".into(), "my lib".into()),
                (' ', "abd".into(), "other".into())
            ]
        );
    }

    #[test]
    fn repository_without_submodules_lists_none() {
        assert!(list(TestRepo::new().path()).unwrap().is_empty());
    }

    #[test]
    fn fresh_submodule_is_up_to_date() {
        let (main, _lib) = superproject();
        assert_eq!(
            list(main.path()).unwrap()[0].state,
            SubmoduleState::UpToDate
        );
    }

    #[test]
    fn edited_submodule_is_modified() {
        let (main, _lib) = superproject();
        main.write("lib/lib.txt", "edited");
        assert_eq!(
            list(main.path()).unwrap()[0].state,
            SubmoduleState::Modified
        );
    }

    #[test]
    fn moved_submodule_head_is_out_of_date() {
        let (main, _lib) = superproject();
        main.git(&[
            "-C",
            "lib",
            "-c",
            "user.name=T",
            "-c",
            "user.email=t@e",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "ahead",
        ]);
        let found = &list(main.path()).unwrap()[0];
        assert_ne!(Some(&found.recorded), found.checked_out.as_ref());
    }

    #[test]
    fn deinitialized_submodule_is_reinitialized_by_init_update() {
        let (main, _lib) = superproject();
        main.git(&["submodule", "deinit", "-q", "-f", "lib"]);
        assert_eq!(
            list(main.path()).unwrap()[0].state,
            SubmoduleState::Uninitialized
        );
        init_update(main.path(), Some("lib")).unwrap();
        assert_eq!(
            list(main.path()).unwrap()[0].state,
            SubmoduleState::UpToDate
        );
    }
}
