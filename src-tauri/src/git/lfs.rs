//! Git LFS: availability, tracked patterns and files. Pull and track only on an explicit click.

use std::path::Path;

use serde::Serialize;

use super::errors::{GitError, GitResult};
use super::runner::{NETWORK_TIMEOUT, RunOptions, extended_path, git_with};
use super::validate;

const MAX_PATHS: usize = 5000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LfsStatus {
    /// Patterns from `.gitattributes` with `filter=lfs`, as `git lfs track` lists them.
    pub patterns: Vec<String>,
}

fn lfs(repo: &Path, args: &[&str], network: bool) -> GitResult<String> {
    let path_env = extended_path();
    let opts = RunOptions {
        timeout: if network {
            NETWORK_TIMEOUT
        } else {
            RunOptions::default().timeout
        },
        env: &[("PATH", &path_env)],
        ..RunOptions::default()
    };
    git_with(repo, args, &opts).map(|out| String::from_utf8_lossy(&out).into_owned())
}

/// `    *.psd (.gitattributes)` lines of `git lfs track`, up to the excluded patterns.
fn parse_track_list(text: &str) -> Vec<String> {
    text.lines()
        .take_while(|line| !line.starts_with("Listing excluded"))
        .filter(|line| line.starts_with("    "))
        .map(|line| {
            let line = line.trim();
            line.rsplit_once(" (")
                .map_or(line, |(pattern, _)| pattern)
                .to_string()
        })
        .collect()
}

/// `None` when git-lfs isn't installed: the UI then shows nothing about LFS.
pub fn status(repo: &Path) -> Option<LfsStatus> {
    let text = lfs(repo, &["lfs", "track"], false).ok()?;
    Some(LfsStatus {
        patterns: parse_track_list(&text),
    })
}

/// Which of `paths` have `filter=lfs` (from `.gitattributes`), so new files count too.
pub fn tracked_paths(repo: &Path, paths: &[String]) -> GitResult<Vec<String>> {
    let paths: Vec<&str> = paths
        .iter()
        .take(MAX_PATHS)
        .map(|p| validate::relative_path(p))
        .collect::<GitResult<_>>()?;
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let input = paths.join("\0");
    let opts = RunOptions {
        stdin: Some(input.as_bytes()),
        ..RunOptions::default()
    };
    let out = git_with(repo, &["check-attr", "-z", "--stdin", "filter"], &opts)?;
    let text = String::from_utf8_lossy(&out);
    let fields: Vec<&str> = text.split('\0').collect();
    let (records, _) = fields.as_chunks::<3>();
    Ok(records
        .iter()
        .filter(|[_, _, value]| *value == "lfs")
        .map(|[path, _, _]| path.to_string())
        .collect())
}

pub fn pull(repo: &Path) -> GitResult<()> {
    lfs(repo, &["lfs", "pull"], true).map(|_| ())
}

/// Adds a pattern to `.gitattributes` (`git lfs track`); the user commits it like any change.
pub fn track(repo: &Path, pattern: &str) -> GitResult<()> {
    let pattern = pattern.trim();
    let valid = !pattern.is_empty()
        && pattern.len() <= 200
        && !pattern.starts_with('-')
        && !pattern.chars().any(char::is_control);
    if !valid {
        return Err(GitError::invalid("Invalid LFS pattern."));
    }
    lfs(repo, &["lfs", "track", "--", pattern], false).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::TestRepo;

    #[test]
    fn parses_tracked_patterns_without_excluded_ones() {
        let text = "Listing tracked patterns\n    *.psd (.gitattributes)\n    assets/big file.bin (.gitattributes)\nListing excluded patterns\n    *.txt (.gitattributes)\n";
        assert_eq!(parse_track_list(text), vec!["*.psd", "assets/big file.bin"]);
    }

    #[test]
    fn tracked_paths_follow_gitattributes() {
        let repo = TestRepo::new();
        repo.write(
            ".gitattributes",
            "*.psd filter=lfs diff=lfs merge=lfs -text\n",
        );
        let paths = vec!["a.psd".to_string(), "b.txt".to_string()];
        assert_eq!(tracked_paths(repo.path(), &paths).unwrap(), vec!["a.psd"]);
    }

    #[test]
    fn track_rejects_option_like_patterns() {
        assert!(track(TestRepo::new().path(), "--help").is_err());
    }
}
