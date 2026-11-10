//! Partial staging (hunks and lines picked in the UI, applied with `git apply`) and committing a change set as
//! several commits. Nothing here can lose work except `Discard`, which the user confirms and only touches the
//! selected lines.

use std::collections::HashSet;
use std::path::Path;

use serde::Deserialize;

use super::errors::{GitError, GitResult};
use super::read::{head, working_tree};
use super::runner::{RunOptions, git, git_with};
use super::{validate, write};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PatchMode {
    /// Hunks of the unstaged diff, applied to the index.
    Stage,
    /// Hunks of the staged diff, removed from the index.
    Unstage,
    /// Hunks of the unstaged diff, removed from the working tree.
    Discard,
}

/// C-style quoting git uses for names with `"` or `\`; other names go as is.
fn quoted(prefix: &str, path: &str) -> String {
    if path.contains(['"', '\\']) {
        format!(
            "\"{prefix}{}\"",
            path.replace('\\', "\\\\").replace('"', "\\\"")
        )
    } else {
        format!("{prefix}{path}")
    }
}

/// A git patch for one file: the header is made here from a validated path, the hunks come from the UI.
fn build_patch(path: &str, hunks: &str) -> GitResult<String> {
    let path = validate::relative_path(path)?;
    let valid = hunks.starts_with("@@ ")
        && hunks
            .lines()
            .all(|l| l.starts_with([' ', '+', '-', '\\']) || l.starts_with("@@ "));
    if !valid {
        return Err(GitError::invalid("Invalid patch."));
    }
    let (a, b) = (quoted("a/", path), quoted("b/", path));
    // git ends a name holding a space with a tab on the ---/+++ lines, so apply knows where it stops.
    let tab = if path.contains(' ') { "\t" } else { "" };
    let newline = if hunks.ends_with('\n') { "" } else { "\n" };
    Ok(format!(
        "diff --git {a} {b}\n--- {a}{tab}\n+++ {b}{tab}\n{hunks}{newline}"
    ))
}

pub fn apply_hunks(repo: &Path, path: &str, hunks: &str, mode: PatchMode) -> GitResult<()> {
    let patch = build_patch(path, hunks)?;
    let args: &[&str] = match mode {
        PatchMode::Stage => &["apply", "--cached", "--whitespace=nowarn", "-"],
        PatchMode::Unstage => &["apply", "--cached", "--reverse", "--whitespace=nowarn", "-"],
        PatchMode::Discard => &["apply", "--reverse", "--whitespace=nowarn", "-"],
    };
    let opts = RunOptions {
        stdin: Some(patch.as_bytes()),
        ..RunOptions::default()
    };
    git_with(repo, args, &opts).map(drop)
}

#[derive(Debug, Clone, Deserialize)]
pub struct CommitGroup {
    pub message: String,
    pub files: Vec<String>,
}

/// Paths in the working tree's change set, both sides of a rename included.
fn changed_paths(repo: &Path) -> GitResult<HashSet<String>> {
    Ok(working_tree(repo)?
        .into_iter()
        .filter(|e| !e.conflicted)
        .flat_map(|e| std::iter::once(e.path).chain(e.previous_path))
        .collect())
}

fn check_groups(groups: &[CommitGroup], changed: &HashSet<String>) -> GitResult<()> {
    if groups.is_empty() {
        return Err(GitError::invalid("No commit to create."));
    }
    let mut seen = HashSet::new();
    for group in groups {
        if group.message.trim().is_empty() || group.files.is_empty() {
            return Err(GitError::invalid(
                "Every commit needs a message and at least one file.",
            ));
        }
        validate::relative_paths(&group.files)?;
        if let Some(path) = group
            .files
            .iter()
            .find(|f| !changed.contains(*f) || !seen.insert(f.as_str()))
        {
            return Err(GitError::invalid(format!(
                "“{path}” isn't a pending change, or is in two commits."
            )));
        }
    }
    Ok(())
}

/// For each group in order: empties the index (working tree untouched), stages its files, commits.
/// Returns the new commit hashes. Files in no group stay uncommitted.
pub fn commit_groups(repo: &Path, groups: &[CommitGroup]) -> GitResult<Vec<String>> {
    check_groups(groups, &changed_paths(repo)?)?;
    let mut hashes = Vec::new();
    for group in groups {
        if head(repo)?.unborn {
            git(repo, &["read-tree", "--empty"])?;
        } else {
            git(repo, &["reset", "--quiet", "--mixed"])?; // index only, never the working tree
        }
        write::stage(repo, &group.files)?;
        hashes.push(write::commit(repo, &group.message)?);
    }
    Ok(hashes)
}

const MAX_SUMMARY_BYTES: usize = 60_000;

/// What an agent needs to group the pending changes into commits: the diff (capped) and the untracked files.
pub fn change_summary(repo: &Path) -> GitResult<String> {
    let mut diff =
        String::from_utf8_lossy(&git(repo, &["diff", "--no-ext-diff", "--cached"])?).into_owned();
    diff.push_str(&String::from_utf8_lossy(&git(
        repo,
        &["diff", "--no-ext-diff"],
    )?));
    if diff.len() > MAX_SUMMARY_BYTES {
        let mut cut = MAX_SUMMARY_BYTES;
        while !diff.is_char_boundary(cut) {
            cut -= 1;
        }
        diff.truncate(cut);
        diff.push_str("\n[diff truncated]\n");
    }
    let mut paths: Vec<String> = changed_paths(repo)?.into_iter().collect();
    paths.sort();
    let untracked: Vec<String> = working_tree(repo)?
        .into_iter()
        .filter(|e| e.unstaged == Some(super::model::FileStatus::Untracked))
        .map(|e| e.path)
        .collect();
    Ok(format!(
        "Changed paths (the only valid values for `files`):\n{}\n\nUntracked files (new, not in the diff):\n{}\n\nDiff:\n{diff}",
        paths.join("\n"),
        untracked.join("\n"),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::TestRepo;

    fn repo_with(content: &str) -> TestRepo {
        let repo = TestRepo::new();
        repo.write("a.txt", content);
        repo.commit_all("init");
        repo
    }

    #[test]
    fn stages_only_the_given_hunk() {
        let repo = repo_with("one\ntwo\nthree\n");
        repo.write("a.txt", "ONE\ntwo\nTHREE\n");
        let hunk = "@@ -1,3 +1,3 @@\n-one\n+ONE\n two\n three\n";
        apply_hunks(repo.path(), "a.txt", hunk, PatchMode::Stage).unwrap();
        assert_eq!(repo.git(&["show", ":a.txt"]), "ONE\ntwo\nthree");
    }

    #[test]
    fn unstages_a_staged_hunk() {
        let repo = repo_with("one\ntwo\n");
        repo.write("a.txt", "ONE\ntwo\n");
        repo.git(&["add", "a.txt"]);
        let hunk = "@@ -1,2 +1,2 @@\n-one\n+ONE\n two\n";
        apply_hunks(repo.path(), "a.txt", hunk, PatchMode::Unstage).unwrap();
        assert_eq!(repo.git(&["diff", "--cached"]), "");
    }

    #[test]
    fn discards_only_the_given_lines() {
        let repo = repo_with("one\ntwo\n");
        repo.write("a.txt", "ONE\ntwo\nthree\n");
        // Only "+three" picked: the unpicked "-one/+ONE" pair is kept as the worktree's "ONE" context.
        let hunk = "@@ -1,2 +1,3 @@\n ONE\n two\n+three\n";
        apply_hunks(repo.path(), "a.txt", hunk, PatchMode::Discard).unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.path().join("a.txt")).unwrap(),
            "ONE\ntwo\n"
        );
    }

    #[test]
    fn handles_names_with_spaces() {
        let repo = TestRepo::new();
        repo.write("my notes.txt", "a\n");
        repo.commit_all("init");
        repo.write("my notes.txt", "a\nb\n");
        let hunk = "@@ -1 +1,2 @@\n a\n+b\n";
        apply_hunks(repo.path(), "my notes.txt", hunk, PatchMode::Stage).unwrap();
        assert_eq!(repo.git(&["show", ":my notes.txt"]), "a\nb");
    }

    #[test]
    fn rejects_patches_with_their_own_headers() {
        let hunks = "@@ -1 +1 @@\n-a\n+b\ndiff --git a/x b/x\n";
        assert!(build_patch("a.txt", hunks).is_err());
    }

    #[test]
    fn rejects_paths_outside_the_repo() {
        assert!(build_patch("../x", "@@ -1 +1 @@\n-a\n+b\n").is_err());
    }

    #[test]
    fn commits_groups_in_order_and_leaves_the_rest() {
        let repo = repo_with("one\n");
        repo.write("a.txt", "two\n");
        repo.write("b.txt", "new\n");
        repo.write("c.txt", "left\n");
        let groups = vec![
            CommitGroup {
                message: "feat: b".into(),
                files: vec!["b.txt".into()],
            },
            CommitGroup {
                message: "fix: a".into(),
                files: vec!["a.txt".into()],
            },
        ];
        assert_eq!(commit_groups(repo.path(), &groups).unwrap().len(), 2);
        assert_eq!(repo.git(&["log", "--format=%s", "-2"]), "fix: a\nfeat: b");
        assert_eq!(repo.git(&["status", "--porcelain"]), "?? c.txt");
    }

    #[test]
    fn refuses_files_outside_the_change_set() {
        let repo = repo_with("one\n");
        repo.write("a.txt", "two\n");
        let groups = vec![CommitGroup {
            message: "x".into(),
            files: vec!["README.md".into()],
        }];
        assert!(commit_groups(repo.path(), &groups).is_err());
    }

    #[test]
    fn refuses_a_file_in_two_groups() {
        let changed = HashSet::from(["a.txt".to_string()]);
        let group = CommitGroup {
            message: "x".into(),
            files: vec!["a.txt".into()],
        };
        assert!(check_groups(&[group.clone(), group], &changed).is_err());
    }

    #[test]
    fn summary_lists_untracked_files() {
        let repo = repo_with("one\n");
        repo.write("new.txt", "x\n");
        assert!(change_summary(repo.path()).unwrap().contains("new.txt"));
    }
}
