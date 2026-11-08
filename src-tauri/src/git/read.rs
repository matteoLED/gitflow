//! Read-only Git queries. Nothing here changes the repository.

use std::path::Path;

use super::errors::{ErrorKind, GitError, GitResult};
use super::model::*;
use super::parser;
use super::runner::{RunOptions, git, git_text, git_with};
use super::validate;

pub const MAX_COMMITS_PER_PAGE: u32 = 500;

/// Whole file as context: the UI folds unchanged lines itself and can unfold them without another call.
const FULL_CONTEXT: &str = "--unified=1000000";

pub fn open_repository(path: &str) -> GitResult<RepositoryInfo> {
    let dir = validate::repo_path(path)?;
    let top = git_text(&dir, &["rev-parse", "--show-toplevel"]).map_err(|err| {
        GitError::new(
            ErrorKind::NotARepository,
            "This folder isn't a Git repository (or is a bare repository).",
        )
        .with_detail(err.detail.unwrap_or(err.message))
    })?;
    let top = top.trim().to_string();
    let name = Path::new(&top)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| top.clone());
    Ok(RepositoryInfo { path: top, name })
}

pub fn head(repo: &Path) -> GitResult<HeadInfo> {
    let branch = git_text(repo, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .ok()
        .map(|b| b.trim().to_string());
    let unborn = git(repo, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_err();
    Ok(HeadInfo { branch, unborn })
}

pub fn list_refs(repo: &Path) -> GitResult<RefsSnapshot> {
    let text = git_text(
        repo,
        &[
            "for-each-ref",
            parser::REF_FORMAT,
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )?;
    let mut snapshot = parser::parse_refs(&text);
    snapshot.tags.reverse(); // newest-looking names first (v2.0 before v1.0)
    snapshot.head = head(repo)?;
    snapshot.stashes =
        parser::parse_stashes(&git_text(repo, &["stash", "list", "--format=%gd%x00%gs"])?);
    Ok(snapshot)
}

/// History display filters, applied by git itself so pagination stays correct.
#[derive(Debug, Clone, Copy, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFilters {
    pub first_parent: bool,
    pub no_merges: bool,
}

pub fn list_commits(
    repo: &Path,
    rev: Option<&str>,
    skip: u32,
    limit: u32,
    filters: LogFilters,
) -> GitResult<Vec<CommitSummary>> {
    let rev = rev.map(validate::revision).transpose()?.unwrap_or("HEAD");
    if rev == "HEAD" && head(repo)?.unborn {
        return Ok(Vec::new());
    }
    let skip = format!("--skip={skip}");
    let limit = format!("--max-count={}", limit.clamp(1, MAX_COMMITS_PER_PAGE));
    let mut args = vec!["log", parser::LOG_FORMAT, "--decorate=full", &skip, &limit];
    if filters.first_parent {
        args.push("--first-parent");
    }
    if filters.no_merges {
        args.push("--no-merges");
    }
    args.extend(["--end-of-options", rev, "--"]);
    Ok(parser::parse_log(&git(repo, &args)?))
}

/// What a commit is compared against: its first parent, or the empty tree for a root commit.
fn commit_base(repo: &Path, hash: &str) -> GitResult<String> {
    let parent = format!("{hash}^1");
    if let Ok(out) = git_text(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            "--end-of-options",
            &parent,
        ],
    ) {
        return Ok(out.trim().to_string());
    }
    let opts = RunOptions {
        stdin: Some(b""),
        ..RunOptions::default()
    };
    let empty_tree = git_with(repo, &["hash-object", "-t", "tree", "--stdin"], &opts)?;
    Ok(String::from_utf8_lossy(&empty_tree).trim().to_string())
}

pub fn list_commit_files(repo: &Path, hash: &str) -> GitResult<Vec<ChangedFile>> {
    let hash = validate::object_id(hash)?;
    let base = commit_base(repo, hash)?;
    let mut files = parser::parse_name_status(&git(
        repo,
        &["diff", "-z", "-M", "--name-status", &base, hash],
    )?);
    let stats = parser::parse_numstat(&git(repo, &["diff", "-z", "-M", "--numstat", &base, hash])?);
    for file in &mut files {
        match stats.get(&file.path) {
            Some(Some((add, del))) => (file.additions, file.deletions) = (Some(*add), Some(*del)),
            Some(None) => file.binary = true,
            None => {}
        }
    }
    Ok(files)
}

fn to_file_diff(out: Vec<u8>) -> FileDiff {
    let patch = String::from_utf8_lossy(&out).into_owned();
    let binary = patch
        .lines()
        .any(|l| l.starts_with("Binary files ") || l == "GIT binary patch");
    FileDiff {
        patch: if binary { String::new() } else { patch },
        binary,
    }
}

fn path_args<'a>(path: &'a str, previous_path: Option<&'a str>) -> GitResult<Vec<&'a str>> {
    let mut args = vec!["--"];
    if let Some(prev) = previous_path {
        args.push(validate::relative_path(prev)?);
    }
    args.push(validate::relative_path(path)?);
    Ok(args)
}

pub fn commit_file_diff(
    repo: &Path,
    hash: &str,
    path: &str,
    previous_path: Option<&str>,
) -> GitResult<FileDiff> {
    let hash = validate::object_id(hash)?;
    let base = commit_base(repo, hash)?;
    let mut args = vec!["diff", "-M", "--no-ext-diff", FULL_CONTEXT, &base, hash];
    args.extend(path_args(path, previous_path)?);
    Ok(to_file_diff(git(repo, &args)?))
}

pub fn working_tree(repo: &Path) -> GitResult<Vec<WorkingTreeEntry>> {
    Ok(parser::parse_status(&git(
        repo,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkingSide {
    Staged,
    Unstaged,
    Untracked,
}

pub fn working_file_diff(
    repo: &Path,
    path: &str,
    previous_path: Option<&str>,
    side: WorkingSide,
) -> GitResult<FileDiff> {
    let out = match side {
        WorkingSide::Untracked => {
            let path = validate::relative_path(path)?;
            let opts = RunOptions {
                ok_codes: &[1],
                ..RunOptions::default()
            };
            git_with(
                repo,
                &[
                    "diff",
                    "--no-ext-diff",
                    "--no-index",
                    "--",
                    "/dev/null",
                    path,
                ],
                &opts,
            )?
        }
        WorkingSide::Staged => {
            let mut args = vec!["diff", "--cached", "-M", "--no-ext-diff", FULL_CONTEXT];
            args.extend(path_args(path, previous_path)?);
            git(repo, &args)?
        }
        WorkingSide::Unstaged => {
            let mut args = vec!["diff", "--no-ext-diff", FULL_CONTEXT];
            args.extend(path_args(path, None)?);
            git(repo, &args)?
        }
    };
    Ok(to_file_diff(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::TestRepo;

    fn repo_with_history() -> (TestRepo, String, String) {
        let repo = TestRepo::new();
        repo.write("src/a.rs", "one\ntwo\n");
        repo.write("logo.png", [0u8, 159, 146, 150]);
        let first = repo.commit_all("Initial commit");
        repo.write("src/a.rs", "one\nTWO\nthree\n");
        repo.git(&["mv", "logo.png", "my logo é.png"]);
        let second = repo.commit_all("Second");
        (repo, first, second)
    }

    #[test]
    fn open_repository_resolves_the_top_level_from_a_subfolder() {
        let (repo, _, _) = repo_with_history();
        let info = open_repository(&repo.path().join("src").to_string_lossy()).unwrap();
        assert_eq!(info.path, repo.git(&["rev-parse", "--show-toplevel"]));
    }

    #[test]
    fn open_repository_rejects_plain_folders() {
        let dir = tempfile::tempdir().unwrap();
        let err = open_repository(&dir.path().to_string_lossy()).unwrap_err();
        assert_eq!(err.kind, ErrorKind::NotARepository);
    }

    #[test]
    fn empty_repository_has_no_commits() {
        let repo = TestRepo::new();
        assert!(
            list_commits(repo.path(), None, 0, 50, LogFilters::default())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn empty_repository_head_is_unborn_on_main() {
        let repo = TestRepo::new();
        assert_eq!(
            head(repo.path()).unwrap(),
            HeadInfo {
                branch: Some("main".into()),
                unborn: true
            }
        );
    }

    #[test]
    fn commits_are_listed_newest_first() {
        let (repo, first, second) = repo_with_history();
        let hashes: Vec<_> = list_commits(repo.path(), None, 0, 50, LogFilters::default())
            .unwrap()
            .into_iter()
            .map(|c| c.hash)
            .collect();
        assert_eq!(hashes, vec![second, first]);
    }

    #[test]
    fn commits_paginate_with_skip() {
        let (repo, first, _) = repo_with_history();
        assert_eq!(
            list_commits(repo.path(), None, 1, 50, LogFilters::default()).unwrap()[0].hash,
            first
        );
    }

    #[test]
    fn head_commit_is_decorated_with_its_branch() {
        let (repo, _, _) = repo_with_history();
        let refs = &list_commits(repo.path(), None, 0, 1, LogFilters::default()).unwrap()[0].refs;
        assert!(refs.contains(&CommitRef {
            kind: RefKind::Branch,
            name: "main".into()
        }));
    }

    #[test]
    fn no_merges_filter_hides_merge_commits() {
        let (repo, _, _) = repo_with_history();
        repo.git(&["switch", "-q", "-c", "side"]);
        repo.write("side.txt", "x\n");
        repo.commit_all("Side");
        repo.git(&["switch", "-q", "main"]);
        repo.git(&["merge", "-q", "--no-ff", "--no-edit", "side"]);
        let filters = LogFilters {
            no_merges: true,
            ..LogFilters::default()
        };
        let commits = list_commits(repo.path(), None, 0, 50, filters).unwrap();
        assert!(commits.iter().all(|c| c.parents.len() < 2));
    }

    #[test]
    fn co_authors_come_from_trailers() {
        let repo = TestRepo::new();
        repo.write("a", "a");
        repo.git(&["add", "-A"]);
        repo.git(&[
            "commit",
            "-q",
            "-m",
            "Pair",
            "-m",
            "Co-authored-by: Bo Li <bo@x.io>",
        ]);
        let commits = list_commits(repo.path(), None, 0, 1, LogFilters::default()).unwrap();
        assert_eq!(commits[0].co_authors, vec!["Bo Li"]);
    }

    #[test]
    fn root_commit_files_are_diffed_against_the_empty_tree() {
        let (repo, first, _) = repo_with_history();
        let statuses: Vec<_> = list_commit_files(repo.path(), &first)
            .unwrap()
            .into_iter()
            .map(|f| f.status)
            .collect();
        assert_eq!(statuses, vec![FileStatus::Added, FileStatus::Added]);
    }

    #[test]
    fn renamed_binary_files_keep_their_previous_path() {
        let (repo, _, second) = repo_with_history();
        let files = list_commit_files(repo.path(), &second).unwrap();
        let renamed = files
            .iter()
            .find(|f| f.status == FileStatus::Renamed)
            .unwrap();
        assert_eq!(
            (renamed.path.as_str(), renamed.previous_path.as_deref()),
            ("my logo é.png", Some("logo.png"))
        );
    }

    #[test]
    fn commit_file_diff_returns_a_unified_patch() {
        let (repo, _, second) = repo_with_history();
        let diff = commit_file_diff(repo.path(), &second, "src/a.rs", None).unwrap();
        assert!(diff.patch.contains("+TWO"));
    }

    #[test]
    fn commit_file_diff_includes_the_whole_file_as_context() {
        let (repo, _, _) = repo_with_history();
        repo.write(
            "src/a.rs",
            (1..=50).map(|n| format!("line {n}\n")).collect::<String>(),
        );
        repo.commit_all("Many lines");
        repo.write(
            "src/a.rs",
            (1..=50)
                .map(|n| {
                    if n == 25 {
                        "changed\n".into()
                    } else {
                        format!("line {n}\n")
                    }
                })
                .collect::<String>(),
        );
        let hash = repo.commit_all("One change");
        let diff = commit_file_diff(repo.path(), &hash, "src/a.rs", None).unwrap();
        assert!(
            diff.patch.contains(
                " line 1
"
            ) && diff.patch.contains(" line 50")
        );
    }

    #[test]
    fn binary_diffs_are_flagged_without_patch() {
        let (repo, first, _) = repo_with_history();
        let diff = commit_file_diff(repo.path(), &first, "logo.png", None).unwrap();
        assert!(diff.binary && diff.patch.is_empty());
    }

    #[test]
    fn merge_commits_are_diffed_against_their_first_parent() {
        let (repo, _, _) = repo_with_history();
        repo.git(&["switch", "-q", "-c", "side"]);
        repo.write("side.txt", "x\n");
        repo.commit_all("Side");
        repo.git(&["switch", "-q", "main"]);
        repo.write("main.txt", "y\n");
        repo.commit_all("Main");
        repo.git(&["merge", "-q", "--no-edit", "side"]);
        let paths: Vec<_> = list_commit_files(repo.path(), &repo.git(&["rev-parse", "HEAD"]))
            .unwrap()
            .into_iter()
            .map(|f| f.path)
            .collect();
        assert_eq!(paths, vec!["side.txt"]);
    }

    #[test]
    fn working_tree_reports_untracked_files_with_unicode_names() {
        let (repo, _, _) = repo_with_history();
        repo.write("notes été.md", "hi\n");
        assert_eq!(working_tree(repo.path()).unwrap()[0].path, "notes été.md");
    }

    #[test]
    fn untracked_diff_shows_the_whole_file_as_added() {
        let (repo, _, _) = repo_with_history();
        repo.write("new.txt", "hello\n");
        let diff = working_file_diff(repo.path(), "new.txt", None, WorkingSide::Untracked).unwrap();
        assert!(diff.patch.contains("+hello"));
    }

    #[test]
    fn file_names_with_glob_characters_are_literal() {
        let (repo, _, _) = repo_with_history();
        repo.write("a*.txt", "star\n");
        repo.write("ab.txt", "other\n");
        repo.commit_all("Globs");
        repo.write("a*.txt", "star!\n");
        repo.write("ab.txt", "other!\n");
        let diff = working_file_diff(repo.path(), "a*.txt", None, WorkingSide::Unstaged).unwrap();
        assert!(!diff.patch.contains("other"));
    }

    #[test]
    fn refs_list_tags_and_local_branches() {
        let (repo, _, _) = repo_with_history();
        repo.git(&["tag", "v1.0"]);
        repo.git(&["branch", "feature/x"]);
        let refs = list_refs(repo.path()).unwrap();
        assert_eq!(
            (refs.branches.len(), refs.tags.clone()),
            (2, vec!["v1.0".to_string()])
        );
    }
}
