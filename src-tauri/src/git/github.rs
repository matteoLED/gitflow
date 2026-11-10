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
    /// OPEN or MERGED.
    pub state: String,
    pub url: String,
}

const PR_FIELDS: &str = "number,title,author,headRefName,baseRefName,headRefOid,isDraft,updatedAt,reviewDecision,state,url";

fn pull_requests_in(
    repo: &Path,
    gh_path: &Path,
    state: &str,
    limit: &str,
) -> GitResult<Vec<PullRequest>> {
    let out = gh(
        gh_path,
        repo,
        &[
            "pr", "list", "--state", state, "--limit", limit, "--json", PR_FIELDS,
        ],
    )?;
    serde_json::from_slice(&out)
        .map_err(|err| GitError::new(ErrorKind::Io, format!("Unexpected answer from gh: {err}")))
}

/// Open pull requests, then the most recently merged ones.
pub fn list_pull_requests(repo: &Path) -> GitResult<Vec<PullRequest>> {
    let gh_path = require_gh()?;
    // Two gh round trips of a second or more each: run them side by side.
    let (open, merged) = std::thread::scope(|scope| {
        let merged = scope.spawn(|| pull_requests_in(repo, &gh_path, "merged", "40"));
        let open = pull_requests_in(repo, &gh_path, "open", "100");
        (open, merged.join())
    });
    let mut prs = open?;
    prs.extend(merged.map_err(|_| GitError::new(ErrorKind::Io, "gh pr list crashed"))??);
    Ok(prs)
}

/// Whether GitHub merged a pull request of `branch` whose head was exactly `tip`: its work is on GitHub, even
/// when it was squashed long ago and git can no longer tell. Any doubt (no `gh`, offline) answers no.
pub(crate) fn merged_pull_request_at(repo: &Path, branch: &str, tip: &str) -> bool {
    let args = [
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "merged",
        "--limit",
        "20",
        "--json",
        "headRefOid",
    ];
    gh_json(repo, &args).is_ok_and(|prs| {
        prs.as_array()
            .is_some_and(|prs| prs.iter().any(|pr| pr["headRefOid"].as_str() == Some(tip)))
    })
}

fn gh_json(repo: &Path, args: &[&str]) -> GitResult<serde_json::Value> {
    let out = gh(&require_gh()?, repo, args)?;
    serde_json::from_slice(&out)
        .map_err(|err| GitError::new(ErrorKind::Io, format!("Unexpected answer from gh: {err}")))
}

/// Recent GitHub Actions runs, as `gh run list --json` returns them.
pub fn list_workflow_runs(repo: &Path) -> GitResult<serde_json::Value> {
    let fields = "databaseId,displayTitle,workflowName,status,conclusion,headBranch,event,createdAt,startedAt,updatedAt,url,number";
    // 100 runs: enough for the CI page's two-week trends, still one gh call.
    gh_json(repo, &["run", "list", "--limit", "100", "--json", fields])
}

/// One run with its jobs and their steps.
pub fn workflow_run(repo: &Path, id: u64) -> GitResult<serde_json::Value> {
    let id = id.to_string();
    let fields = "databaseId,displayTitle,workflowName,status,conclusion,headBranch,event,createdAt,updatedAt,url,jobs";
    gh_json(repo, &["run", "view", &id, "--json", fields])
}

/// Everything the pull request page shows: description, discussion, reviews, checks, files, mergeability.
pub fn pull_request_details(repo: &Path, number: u32) -> GitResult<serde_json::Value> {
    let number = number.to_string();
    let fields = "number,title,body,author,state,isDraft,url,createdAt,headRefName,baseRefName,additions,deletions,\
changedFiles,commits,comments,reviews,reviewRequests,statusCheckRollup,mergeStateStatus,mergeable,files";
    gh_json(repo, &["pr", "view", &number, "--json", fields])
}

/// Adds a comment to the pull request's conversation (`gh pr comment`); the body is one argv entry.
pub fn comment_pull_request(repo: &Path, number: u32, body: &str) -> GitResult<()> {
    let body = body.trim();
    if body.is_empty() || body.len() > 65_536 {
        return Err(GitError::invalid("Write a comment first."));
    }
    let number = number.to_string();
    let body_arg = format!("--body={body}");
    gh(&require_gh()?, repo, &["pr", "comment", &number, &body_arg]).map(|_| ())
}

const REVIEW_THREADS_QUERY: &str = "query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    reviewThreads(first: 100) { nodes {
      id isResolved isOutdated path line originalLine diffSide
      comments(first: 100) { nodes {
        id databaseId url body createdAt viewerCanUpdate viewerCanDelete
        author { login avatarUrl }
        reactionGroups { content viewerHasReacted reactors { totalCount } }
      } }
    } }
  } }
}";

/// The pull request's code comment threads, with their replies, resolution and reactions.
// ponytail: first 100 threads of 100 comments; paginate if a PR ever outgrows that.
pub fn review_threads(repo: &Path, number: u32) -> GitResult<serde_json::Value> {
    let query = format!("query={REVIEW_THREADS_QUERY}");
    let number = format!("number={number}");
    gh_json(
        repo,
        &[
            "api",
            "graphql",
            "-f",
            &query,
            "-F",
            "owner={owner}",
            "-F",
            "name={repo}",
            "-F",
            &number,
            "--jq",
            ".data.repository.pullRequest.reviewThreads.nodes",
        ],
    )
}

/// GraphQL node ids are opaque base64-ish tokens: anything else is refused before reaching gh.
fn node_id(id: &str) -> GitResult<&str> {
    let ok = !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_-=".contains(c));
    ok.then_some(id)
        .ok_or_else(|| GitError::invalid("Unknown GitHub id."))
}

fn graphql(repo: &Path, query: &str, fields: &[String]) -> GitResult<()> {
    let query = format!("query={query}");
    let mut args = vec!["api", "graphql", "-f", query.as_str()];
    for field in fields {
        args.extend(["-f", field.as_str()]);
    }
    gh(&require_gh()?, repo, &args).map(|_| ())
}

/// Marks a code comment thread resolved, or open again.
pub fn resolve_thread(repo: &Path, thread_id: &str, resolved: bool) -> GitResult<()> {
    let id = node_id(thread_id)?;
    let mutation = if resolved {
        "mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { id } } }"
    } else {
        "mutation($id: ID!) { unresolveReviewThread(input: {threadId: $id}) { thread { id } } }"
    };
    graphql(repo, mutation, &[format!("id={id}")])
}

const REACTIONS: [&str; 8] = [
    "THUMBS_UP",
    "THUMBS_DOWN",
    "LAUGH",
    "HOORAY",
    "CONFUSED",
    "HEART",
    "ROCKET",
    "EYES",
];

/// Adds or removes the user's reaction on a comment.
pub fn react(repo: &Path, subject_id: &str, content: &str, add: bool) -> GitResult<()> {
    let id = node_id(subject_id)?;
    if !REACTIONS.contains(&content) {
        return Err(GitError::invalid("Unknown reaction."));
    }
    let mutation = if add {
        "mutation($id: ID!, $content: ReactionContent!) { addReaction(input: {subjectId: $id, content: $content}) { subject { id } } }"
    } else {
        "mutation($id: ID!, $content: ReactionContent!) { removeReaction(input: {subjectId: $id, content: $content}) { subject { id } } }"
    };
    graphql(
        repo,
        mutation,
        &[format!("id={id}"), format!("content={content}")],
    )
}

/// Rewrites one of the user's code comments.
pub fn edit_review_comment(repo: &Path, comment_id: u64, body: &str) -> GitResult<()> {
    let body = format!("body={}", review_body(body)?);
    let endpoint = format!("repos/{{owner}}/{{repo}}/pulls/comments/{comment_id}");
    gh(
        &require_gh()?,
        repo,
        &["api", "--method", "PATCH", &endpoint, "-f", &body],
    )
    .map(|_| ())
}

/// Deletes one of the user's code comments.
pub fn delete_review_comment(repo: &Path, comment_id: u64) -> GitResult<()> {
    let endpoint = format!("repos/{{owner}}/{{repo}}/pulls/comments/{comment_id}");
    gh(
        &require_gh()?,
        repo,
        &["api", "--method", "DELETE", &endpoint],
    )
    .map(|_| ())
}

fn review_body(body: &str) -> GitResult<&str> {
    let body = body.trim();
    if body.is_empty() || body.len() > 65_536 {
        return Err(GitError::invalid("Write a comment first."));
    }
    Ok(body)
}

/// Comments one line of the pull request's diff. `side` is LEFT (old version) or RIGHT (new one).
pub fn comment_line(
    repo: &Path,
    number: u32,
    commit: &str,
    path: &str,
    line: u32,
    side: &str,
    body: &str,
) -> GitResult<()> {
    let body = review_body(body)?;
    let commit = validate::object_id(commit)?;
    let path = validate::relative_path(path)?;
    if side != "LEFT" && side != "RIGHT" {
        return Err(GitError::invalid("Unknown diff side."));
    }
    let endpoint = format!("repos/{{owner}}/{{repo}}/pulls/{number}/comments");
    // Each field is its own argv entry (`-f` keeps it a raw string, `@file` included): nothing reaches a shell.
    let fields = [
        format!("body={body}"),
        format!("commit_id={commit}"),
        format!("path={path}"),
        format!("side={side}"),
    ];
    let line = format!("line={line}");
    let mut args = vec!["api", "--method", "POST", &endpoint, "-F", &line];
    for field in &fields {
        args.extend(["-f", field.as_str()]);
    }
    gh(&require_gh()?, repo, &args).map(|_| ())
}

/// Answers a code comment's thread.
pub fn reply_review_comment(
    repo: &Path,
    number: u32,
    comment_id: u64,
    body: &str,
) -> GitResult<()> {
    let body = format!("body={}", review_body(body)?);
    let endpoint = format!("repos/{{owner}}/{{repo}}/pulls/{number}/comments/{comment_id}/replies");
    gh(
        &require_gh()?,
        repo,
        &["api", "--method", "POST", &endpoint, "-f", &body],
    )
    .map(|_| ())
}

/// Re-runs the failed jobs of the given GitHub Actions runs (`gh run rerun <id> --failed`).
pub fn rerun_failed_checks(repo: &Path, run_ids: &[u64]) -> GitResult<()> {
    if run_ids.is_empty() || run_ids.len() > 50 {
        return Err(GitError::invalid("No failing run to re-run."));
    }
    let gh_path = require_gh()?;
    for id in run_ids {
        let id = id.to_string();
        gh(&gh_path, repo, &["run", "rerun", &id, "--failed"])?;
    }
    Ok(())
}

/// GitHub logins and `org/team` slugs only: they end up as one argv entry, never a shell line.
fn valid_reviewer(login: &str) -> bool {
    !login.is_empty()
        && login.len() <= 80
        && !login.starts_with('-')
        && login
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '/' || c == '_')
}

/// Requests a review from a user or team (`gh pr edit --add-reviewer`).
pub fn add_reviewer(repo: &Path, number: u32, login: &str) -> GitResult<()> {
    let login = login.trim().trim_start_matches('@');
    if !valid_reviewer(login) {
        return Err(GitError::invalid("That isn't a GitHub login or team."));
    }
    let number = number.to_string();
    let arg = format!("--add-reviewer={login}");
    gh(&require_gh()?, repo, &["pr", "edit", &number, &arg]).map(|_| ())
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum PrState {
    Draft,
    Open,
    Closed,
}

/// The `gh` commands that move a PR from its current state to `target`, in order.
fn state_commands(closed: bool, draft: bool, target: PrState) -> Vec<&'static [&'static str]> {
    let mut steps: Vec<&'static [&'static str]> = Vec::new();
    if target == PrState::Closed {
        if !closed {
            steps.push(&["close"]);
        }
        return steps;
    }
    if closed {
        steps.push(&["reopen"]);
    }
    match (target, draft) {
        (PrState::Draft, false) => steps.push(&["ready", "--undo"]),
        (PrState::Open, true) => steps.push(&["ready"]),
        _ => {}
    }
    steps
}

/// Draft / open / closed, like Linear's status menu (`gh pr ready [--undo]`, `close`, `reopen`).
pub fn set_pull_request_state(repo: &Path, number: u32, target: PrState) -> GitResult<()> {
    let n = number.to_string();
    let current = gh_json(repo, &["pr", "view", &n, "--json", "state,isDraft"])?;
    let state = current
        .get("state")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if state == "MERGED" {
        return Err(GitError::invalid(
            "A merged pull request can't change state.",
        ));
    }
    let draft = current
        .get("isDraft")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let gh_path = require_gh()?;
    for command in state_commands(state == "CLOSED", draft, target) {
        let mut args = vec!["pr", command[0], n.as_str()];
        args.extend_from_slice(&command[1..]);
        gh(&gh_path, repo, &args)?;
    }
    Ok(())
}

const MAX_LOG_CHARS: usize = 400_000;

/// A GitHub Actions job's log (`gh run view --job <id> --log`), keeping its end when it is huge.
pub fn job_log(repo: &Path, job_id: u64, failed_only: bool) -> GitResult<String> {
    let id = job_id.to_string();
    let flag = if failed_only { "--log-failed" } else { "--log" };
    let out = gh(&require_gh()?, repo, &["run", "view", "--job", &id, flag])?;
    let text = String::from_utf8_lossy(&out).into_owned();
    Ok(match text.char_indices().rev().nth(MAX_LOG_CHARS) {
        Some((cut, _)) => text[cut..].to_string(),
        None => text,
    })
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MergeMethod {
    Squash,
    Merge,
    Rebase,
}

/// Merges on GitHub with the user's own `gh` login. No `--delete-branch`: gh would also switch the local
/// checkout, and branches are never switched behind the user's back.
pub fn merge_pull_request(repo: &Path, number: u32, method: MergeMethod) -> GitResult<()> {
    let flag = match method {
        MergeMethod::Squash => "--squash",
        MergeMethod::Merge => "--merge",
        MergeMethod::Rebase => "--rebase",
    };
    let number = number.to_string();
    gh(&require_gh()?, repo, &["pr", "merge", &number, flag]).map(|_| ())
}

/// The branch a new pull request targets and how far HEAD is past it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BranchComparison {
    pub base: String,
    pub ahead: u32,
}

fn ref_exists(repo: &Path, name: &str) -> bool {
    git(
        repo,
        &["rev-parse", "--verify", "--quiet", "--end-of-options", name],
    )
    .is_ok()
}

/// The remote's default branch (`origin/HEAD`), else `main` or `master` when they exist.
pub(crate) fn default_base(repo: &Path) -> Option<String> {
    let remote_head = git_text(
        repo,
        &[
            "symbolic-ref",
            "--quiet",
            "--short",
            "refs/remotes/origin/HEAD",
        ],
    )
    .ok();
    if let Some(name) = remote_head
        .as_deref()
        .and_then(|r| r.trim().strip_prefix("origin/"))
    {
        return Some(name.to_string());
    }
    ["main", "master"]
        .into_iter()
        .find(|b| ref_exists(repo, b) || ref_exists(repo, &format!("origin/{b}")))
        .map(String::from)
}

/// Commits on HEAD that `base` doesn't have, counted against the remote copy of base when there is one
/// (a stale local main would overcount).
pub fn compare_with_base(repo: &Path, base: Option<&str>) -> GitResult<Option<BranchComparison>> {
    let base = match base {
        Some(b) => super::write::checked_branch_name(repo, b)?,
        None => match default_base(repo) {
            Some(b) => b,
            None => return Ok(None),
        },
    };
    let remote = format!("origin/{base}");
    let target = if ref_exists(repo, &remote) {
        remote
    } else {
        base.clone()
    };
    if !ref_exists(repo, &target) {
        return Ok(None);
    }
    let range = format!("{target}..HEAD");
    let ahead = git_text(repo, &["rev-list", "--count", &range])?
        .trim()
        .parse()
        .unwrap_or(0);
    Ok(Some(BranchComparison { base, ahead }))
}

/// Opens a pull request from the checked-out branch (already pushed) into `base`; returns its URL.
/// Every value is a single `--flag=value` argv entry: nothing can be read as another option.
pub fn create_pull_request(
    repo: &Path,
    base: &str,
    title: &str,
    body: &str,
    draft: bool,
) -> GitResult<String> {
    let base = super::write::checked_branch_name(repo, base)?;
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 256 || title.chars().any(char::is_control) {
        return Err(GitError::invalid("Give the pull request a one-line title."));
    }
    if body.len() > 65_536 {
        return Err(GitError::invalid("The description is too long."));
    }
    let head = git_text(repo, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .map_err(|_| GitError::invalid("Check out a branch to open a pull request."))?;
    let head = head.trim();
    if head == base {
        return Err(GitError::invalid(
            "Pick a base other than the branch itself.",
        ));
    }
    let args = [
        format!("--base={base}"),
        format!("--head={head}"),
        format!("--title={title}"),
        format!("--body={body}"),
    ];
    let mut argv: Vec<&str> = vec!["pr", "create"];
    argv.extend(args.iter().map(String::as_str));
    if draft {
        argv.push("--draft");
    }
    let out = gh(&require_gh()?, repo, &argv)?;
    let text = String::from_utf8_lossy(&out);
    Ok(text
        .lines()
        .rev()
        .find(|l| l.starts_with("https://"))
        .unwrap_or("")
        .trim()
        .to_string())
}

/// `https://github.com/owner/name` for an `origin` hosted on GitHub.
pub fn web_url(repo: &Path) -> GitResult<Option<String>> {
    let remote = git_text(repo, &["remote", "get-url", "origin"]).unwrap_or_default();
    Ok(
        github_slug(remote.trim())
            .map(|(owner, name)| format!("https://github.com/{owner}/{name}")),
    )
}

/// Opens a GitHub page in the default browser. Only github.com URLs are accepted.
pub fn open_in_browser(url: &str) -> GitResult<()> {
    // Web pages only (links in pull requests and issues point anywhere): never file:, javascript:, app schemes.
    let allowed = ["https://", "http://localhost:", "http://127.0.0.1:"];
    let safe = allowed.iter().any(|prefix| url.starts_with(prefix))
        && !url.chars().any(|c| c.is_whitespace() || c.is_control());
    if !safe {
        return Err(GitError::invalid("Only web links can be opened."));
    }
    std::process::Command::new("/usr/bin/open")
        .arg(url)
        .status()
        .map_err(|err| GitError::new(ErrorKind::Io, format!("Couldn't open the browser: {err}")))?;
    Ok(())
}

/// What the UI needs to show a pull request: its commits and its whole diff.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestRange {
    /// Revision range of the PR's own commits, for the history list.
    pub range: String,
    /// Merge-base with the base branch: the PR's full diff is `merge_base..head`, as on GitHub.
    pub merge_base: Option<String>,
    pub head: String,
}

/// Fetches a PR's head (into FETCH_HEAD only: no local branch is created or moved) and its base,
/// then returns the revision range of the PR's own commits and its merge-base.
pub fn fetch_pull_request(
    repo: &Path,
    number: u32,
    base: &str,
    head_oid: &str,
) -> GitResult<PullRequestRange> {
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
    let base_ref = format!("refs/remotes/origin/{base}");
    // A commit id never changes content: when the head and the base are already here (reopening a PR, a
    // stack neighbour), skip the network round trip.
    let head_commit = format!("{head_oid}^{{commit}}");
    let local = git(repo, &["cat-file", "-e", &head_commit]).is_ok()
        && git(repo, &["rev-parse", "--verify", "--quiet", &base_ref]).is_ok();
    if !local {
        git_with(
            repo,
            &["fetch", "--no-tags", "origin", &pr_ref, base],
            &opts,
        )?;
    }
    let has_base = git(repo, &["rev-parse", "--verify", "--quiet", &base_ref]).is_ok();
    if !has_base {
        return Ok(PullRequestRange {
            range: head_oid.to_string(),
            merge_base: None,
            head: head_oid.to_string(),
        });
    }
    let merge_base = git_text(
        repo,
        &["merge-base", "--end-of-options", &base_ref, head_oid],
    )
    .ok()
    .map(|out| out.trim().to_string());
    Ok(PullRequestRange {
        range: format!("origin/{base}..{head_oid}"),
        merge_base,
        head: head_oid.to_string(),
    })
}

/// The three outcomes of a GitHub review, as `gh pr review` flags.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReviewEvent {
    Approve,
    RequestChanges,
    Comment,
}

/// Submits a review with the user's own `gh` login. The body travels as one argv entry (no shell).
pub fn submit_review(repo: &Path, number: u32, event: ReviewEvent, body: &str) -> GitResult<()> {
    let body = body.trim();
    if body.len() > 65_536 {
        return Err(GitError::invalid("The review is too long."));
    }
    let flag = match event {
        ReviewEvent::Approve => "--approve",
        ReviewEvent::RequestChanges => "--request-changes",
        ReviewEvent::Comment => "--comment",
    };
    if body.is_empty() && !matches!(event, ReviewEvent::Approve) {
        return Err(GitError::invalid("Write a comment first."));
    }
    let number = number.to_string();
    let body_arg = format!("--body={body}");
    let mut args = vec!["pr", "review", number.as_str(), flag];
    if !body.is_empty() {
        args.push(&body_arg);
    }
    gh(&require_gh()?, repo, &args).map(|_| ())
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
    #[test]
    fn branch_counts_commits_past_main() {
        let repo = crate::git::test_repo::TestRepo::new();
        repo.write("a.txt", "a");
        repo.commit_all("first");
        repo.git(&["branch", "-M", "main"]);
        repo.git(&["switch", "-c", "feature"]);
        repo.write("b.txt", "b");
        repo.commit_all("second");
        let found = super::compare_with_base(repo.path(), None).unwrap();
        assert_eq!(
            found,
            Some(super::BranchComparison {
                base: "main".into(),
                ahead: 1
            })
        );
    }

    #[test]
    fn pull_request_base_cannot_be_an_option() {
        let repo = crate::git::test_repo::TestRepo::new();
        assert!(super::create_pull_request(repo.path(), "--help", "t", "", false).is_err());
    }

    #[test]
    fn state_changes_run_the_right_gh_commands() {
        let closed_to_draft = state_commands(true, false, PrState::Draft);
        assert_eq!(
            closed_to_draft,
            vec![&["reopen"][..], &["ready", "--undo"][..]]
        );
        assert_eq!(
            state_commands(false, true, PrState::Open),
            vec![&["ready"][..]]
        );
        assert!(state_commands(false, false, PrState::Open).is_empty());
    }

    #[test]
    fn reviewers_are_logins_or_team_slugs() {
        assert!(valid_reviewer("octo-cat") && valid_reviewer("org/team_a"));
        assert!(!valid_reviewer("--repo=x") && !valid_reviewer("a b") && !valid_reviewer(""));
    }

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

    #[test]
    fn only_github_links_open_in_the_browser() {
        assert!(open_in_browser("javascript:alert(1)").is_err());
        assert!(open_in_browser("http://example.com/").is_err());
        assert!(open_in_browser("https://github.com/a b").is_err());
        assert!(open_in_browser("file:///etc/passwd").is_err());
    }

    #[test]
    fn node_ids_refuse_anything_but_id_characters() {
        assert!(super::node_id("PRRT_kwDOAbc-12=").is_ok());
        assert!(super::node_id("x; rm").is_err() && super::node_id("").is_err());
    }
}
