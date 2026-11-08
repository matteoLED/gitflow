//! GitHub features through the user's own `gh` login (the app never sees a token).
//! Avatars are cosmetic and degrade to `None`; pull requests and the profile report errors.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use super::errors::{ErrorKind, GitError, GitResult};
use super::runner::{NETWORK_TIMEOUT, RunOptions, gh, git, git_text, git_with};
use super::validate;

const AVATAR_HOST: &str = "https://avatars.githubusercontent.com";
const NOREPLY: &str = "@users.noreply.github.com";

/// Avatar per author email, for the lifetime of the app (gh also caches the API response on disk).
fn cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// `123+login@users.noreply.github.com` or `login@users.noreply.github.com` → avatar URL, without any request.
pub fn noreply_avatar(email: &str) -> Option<String> {
    let local = email.strip_suffix(NOREPLY)?;
    let id_or_login = match local.split_once('+') {
        Some((id, _)) if id.bytes().all(|b| b.is_ascii_digit()) => format!("u/{id}"),
        _ => local.to_string(),
    };
    is_slug_part(&id_or_login.replace("u/", ""))
        .then(|| format!("{AVATAR_HOST}/{id_or_login}?s=80"))
}

fn is_slug_part(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
}

/// `owner/name` of a github.com remote URL (https, ssh or scp-like syntax).
pub fn github_slug(url: &str) -> Option<(String, String)> {
    let rest = [
        "https://github.com/",
        "ssh://git@github.com/",
        "git@github.com:",
    ]
    .iter()
    .find_map(|prefix| url.trim().strip_prefix(prefix))?;
    let (owner, name) = rest
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .split_once('/')?;
    (is_slug_part(owner) && is_slug_part(name)).then(|| (owner.to_string(), name.to_string()))
}

fn find_gh() -> Option<PathBuf> {
    // Apps launched from Finder get a minimal PATH, so also look where Homebrew installs gh.
    let from_path = std::env::var_os("PATH")
        .into_iter()
        .flat_map(|p| std::env::split_paths(&p).collect::<Vec<_>>());
    from_path
        .chain(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from))
        .map(|dir| dir.join("gh"))
        .find(|candidate| candidate.is_file())
}

fn require_gh() -> GitResult<PathBuf> {
    find_gh().ok_or_else(|| {
        GitError::new(
            ErrorKind::GitNotFound,
            "The GitHub CLI (gh) isn't installed. Install it and run `gh auth login`.",
        )
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubUser {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrAuthor {
    pub login: String,
}

/// Same shape as `gh pr list --json` output, passed through to the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u32,
    pub title: String,
    pub author: PrAuthor,
    pub head_ref_name: String,
    pub base_ref_name: String,
    pub head_ref_oid: String,
    pub is_draft: bool,
    pub updated_at: String,
    pub review_decision: Option<String>,
}

const PR_FIELDS: &str =
    "number,title,author,headRefName,baseRefName,headRefOid,isDraft,updatedAt,reviewDecision";

pub fn list_pull_requests(repo: &Path) -> GitResult<Vec<PullRequest>> {
    let out = gh(
        &require_gh()?,
        repo,
        &[
            "pr", "list", "--state", "open", "--limit", "100", "--json", PR_FIELDS,
        ],
    )?;
    serde_json::from_slice(&out)
        .map_err(|err| GitError::new(ErrorKind::Io, format!("Unexpected answer from gh: {err}")))
}

/// Fetches a PR's head (into FETCH_HEAD only: no local branch is created or moved) and its base,
/// then returns the revision range of the PR's own commits.
pub fn fetch_pull_request(
    repo: &Path,
    number: u32,
    base: &str,
    head_oid: &str,
) -> GitResult<String> {
    let base = validate::revision(base)?;
    let head_oid = validate::object_id(head_oid)?;
    if base.contains("..") {
        return Err(GitError::invalid("Invalid base branch."));
    }
    let pr_ref = format!("pull/{number}/head");
    let opts = RunOptions {
        timeout: NETWORK_TIMEOUT,
        ..RunOptions::default()
    };
    git_with(
        repo,
        &["fetch", "--no-tags", "origin", &pr_ref, base],
        &opts,
    )?;
    let base_ref = format!("refs/remotes/origin/{base}");
    let has_base = git(repo, &["rev-parse", "--verify", "--quiet", &base_ref]).is_ok();
    Ok(if has_base {
        format!("origin/{base}..{head_oid}")
    } else {
        head_oid.to_string()
    })
}

pub fn github_user(repo: &Path) -> GitResult<GithubUser> {
    let jq = "{login: .login, name: .name, avatarUrl: .avatar_url}";
    let out = gh(
        &require_gh()?,
        repo,
        &["api", "--cache", "1h", "user", "--jq", jq],
    )?;
    serde_json::from_slice(&out)
        .map_err(|err| GitError::new(ErrorKind::Io, format!("Unexpected answer from gh: {err}")))
}

fn api_avatar(repo: &Path, hash: &str) -> Option<String> {
    let remote = git_text(repo, &["remote", "get-url", "origin"]).ok()?;
    let (owner, name) = github_slug(&remote)?;
    let endpoint = format!("repos/{owner}/{name}/commits/{hash}");
    let out = gh(
        &find_gh()?,
        repo,
        &[
            "api",
            "--cache",
            "24h",
            &endpoint,
            "--jq",
            ".author.avatar_url // empty",
        ],
    )
    .ok()?;
    let url = String::from_utf8_lossy(&out).trim().to_string();
    url.starts_with(AVATAR_HOST).then_some(url)
}

pub fn avatar_url(repo: &Path, hash: &str, email: &str) -> GitResult<Option<String>> {
    let hash = validate::object_id(hash)?;
    if let Some(url) = noreply_avatar(email) {
        return Ok(Some(url));
    }
    if let Some(cached) = cache().lock().ok().and_then(|c| c.get(email).cloned()) {
        return Ok(cached);
    }
    let url = api_avatar(repo, hash);
    if let Ok(mut c) = cache().lock() {
        c.insert(email.to_string(), url.clone());
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noreply_with_numeric_id_uses_the_id() {
        assert_eq!(
            noreply_avatar("583231+octocat@users.noreply.github.com").as_deref(),
            Some("https://avatars.githubusercontent.com/u/583231?s=80")
        );
    }

    #[test]
    fn noreply_without_id_uses_the_login() {
        assert_eq!(
            noreply_avatar("octocat@users.noreply.github.com").as_deref(),
            Some("https://avatars.githubusercontent.com/octocat?s=80")
        );
    }

    #[test]
    fn regular_emails_are_not_noreply() {
        assert_eq!(noreply_avatar("me@example.com"), None);
    }

    #[test]
    fn slug_from_scp_like_ssh_remote() {
        assert_eq!(
            github_slug("git@github.com:matteoLED/gitflow.git"),
            Some(("matteoLED".into(), "gitflow".into()))
        );
    }

    #[test]
    fn slug_from_https_remote() {
        assert_eq!(
            github_slug("https://github.com/a-b/c.d"),
            Some(("a-b".into(), "c.d".into()))
        );
    }

    #[test]
    fn non_github_remotes_have_no_slug() {
        assert_eq!(github_slug("git@gitlab.com:a/b.git"), None);
    }

    #[test]
    fn slugs_reject_path_tricks() {
        assert_eq!(github_slug("https://github.com/a/../../x"), None);
    }
}
