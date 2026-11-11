//! GitHub releases through `gh api`: list, create, edit, delete, and GitHub's generated notes.
//! Payloads go to gh as JSON on stdin, never through a shell.

use std::path::Path;

use serde::Deserialize;
use serde_json::{Value, json};

use super::errors::{ErrorKind, GitError, GitResult};
use super::github::require_gh;
use super::runner::{gh, gh_with_input, git_text};
use super::tags::tag_name;
use super::validate;

const RELEASES: &str = "repos/{owner}/{repo}/releases";
/// GitHub's own limit on a release body.
const MAX_BODY: usize = 125_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInput {
    pub tag_name: String,
    /// Branch or commit the tag is created on when it doesn't exist yet.
    pub target: Option<String>,
    pub name: String,
    pub body: String,
    pub draft: bool,
    pub prerelease: bool,
}

fn parse(out: &[u8]) -> GitResult<Value> {
    serde_json::from_slice(out)
        .map_err(|err| GitError::new(ErrorKind::Io, format!("Unexpected answer from gh: {err}")))
}

fn api(repo: &Path, method: &str, endpoint: &str, payload: Option<&Value>) -> GitResult<Value> {
    let gh_path = require_gh()?;
    let out = match payload {
        None => gh(&gh_path, repo, &["api", "--method", method, endpoint])?,
        Some(body) => gh_with_input(
            &gh_path,
            repo,
            &["api", "--method", method, endpoint, "--input", "-"],
            body.to_string().as_bytes(),
        )?,
    };
    if out.iter().all(u8::is_ascii_whitespace) {
        return Ok(Value::Null); // DELETE answers 204 with no body
    }
    parse(&out)
}

fn optional_revision(target: Option<&str>) -> GitResult<Option<&str>> {
    match target.map(str::trim).filter(|t| !t.is_empty()) {
        None => Ok(None),
        Some(t) => validate::revision(t).map(Some),
    }
}

fn payload(repo: &Path, input: &ReleaseInput) -> GitResult<Value> {
    let tag = tag_name(repo, input.tag_name.trim())?;
    if input.body.len() > MAX_BODY || input.name.len() > 1_000 {
        return Err(GitError::invalid("The release notes are too long."));
    }
    let mut body = json!({
        "tag_name": tag,
        "name": input.name.trim(),
        "body": input.body,
        "draft": input.draft,
        "prerelease": input.prerelease,
    });
    if let Some(target) = optional_revision(input.target.as_deref())? {
        body["target_commitish"] = json!(target);
    }
    Ok(body)
}

/// The 50 most recent releases, drafts included (for users who can see them).
pub fn list_releases(repo: &Path) -> GitResult<Value> {
    api(repo, "GET", &format!("{RELEASES}?per_page=50"), None)
}

pub fn create_release(repo: &Path, input: &ReleaseInput) -> GitResult<Value> {
    api(repo, "POST", RELEASES, Some(&payload(repo, input)?))
}

pub fn update_release(repo: &Path, id: u64, input: &ReleaseInput) -> GitResult<Value> {
    api(
        repo,
        "PATCH",
        &format!("{RELEASES}/{id}"),
        Some(&payload(repo, input)?),
    )
}

/// Deletes the release only: its tag stays, locally and on GitHub.
pub fn delete_release(repo: &Path, id: u64) -> GitResult<()> {
    api(repo, "DELETE", &format!("{RELEASES}/{id}"), None).map(drop)
}

/// GitHub's generated notes (`{ name, body }`) for `tag`, from `previous` (GitHub picks one when absent).
pub fn generate_notes(
    repo: &Path,
    tag: &str,
    previous: Option<&str>,
    target: Option<&str>,
) -> GitResult<Value> {
    let mut body = json!({ "tag_name": tag_name(repo, tag.trim())? });
    if let Some(previous) = previous.map(str::trim).filter(|p| !p.is_empty()) {
        body["previous_tag_name"] = json!(tag_name(repo, previous)?);
    }
    if let Some(target) = optional_revision(target)? {
        body["target_commitish"] = json!(target);
    }
    api(
        repo,
        "POST",
        &format!("{RELEASES}/generate-notes"),
        Some(&body),
    )
}

/// Commits in `from..to` (all of `to` without `from`), subject and body, for the AI changelog's prompt.
// ponytail: capped at 300 commits; enough for a release, a giant range only loses its oldest commits.
pub fn release_commits(repo: &Path, from: Option<&str>, to: &str) -> GitResult<String> {
    let to = validate::revision(to.trim())?;
    let range = match optional_revision(from)? {
        Some(from) => format!("{from}..{to}"),
        None => to.to_string(),
    };
    git_text(
        repo,
        &[
            "log",
            "-n",
            "300",
            "--format=- %h %s%n%w(0,2,2)%b",
            &range,
            "--",
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::TestRepo;

    fn input(tag: &str, target: Option<&str>) -> ReleaseInput {
        ReleaseInput {
            tag_name: tag.into(),
            target: target.map(Into::into),
            name: " v1 ".into(),
            body: "notes".into(),
            draft: true,
            prerelease: false,
        }
    }

    #[test]
    fn payload_carries_the_target_when_given() {
        let repo = TestRepo::new();
        let body = payload(repo.path(), &input("v1.0.0", Some("main"))).unwrap();
        assert_eq!(
            (
                body["tag_name"].as_str(),
                body["target_commitish"].as_str(),
                body["name"].as_str()
            ),
            (Some("v1.0.0"), Some("main"), Some("v1"))
        );
    }

    #[test]
    fn payload_refuses_option_like_tags() {
        let repo = TestRepo::new();
        assert!(payload(repo.path(), &input("--help", None)).is_err());
    }

    #[test]
    fn release_commits_lists_only_the_range() {
        let repo = TestRepo::new();
        repo.write("a", "1");
        repo.commit_all("old");
        repo.git(&["tag", "v1"]);
        repo.write("a", "2");
        repo.commit_all("Add exports (#12)");
        let log = release_commits(repo.path(), Some("v1"), "HEAD").unwrap();
        assert!(log.contains("Add exports (#12)") && !log.contains("old"));
    }
}
