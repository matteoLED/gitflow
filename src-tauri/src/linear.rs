//! Linear: the user's issues across their organizations, read with personal API keys.
//! Keys live in the macOS Keychain (one entry per organization); only names and ids are stored on disk.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::git::errors::{ErrorKind, GitError, GitResult};

const ENDPOINT: &str = "https://api.linear.app/graphql";
const KEYCHAIN_SERVICE: &str = "gitflow.linear";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    /// Linear organization id; also the Keychain account name.
    pub id: String,
    pub name: String,
    pub url_key: String,
    pub user_name: String,
}

static ACCOUNTS_FILE: OnceLock<PathBuf> = OnceLock::new();

pub fn init(path: PathBuf) {
    let _ = ACCOUNTS_FILE.set(path);
}

fn io(err: impl std::fmt::Display) -> GitError {
    GitError::new(ErrorKind::Io, format!("Linear: {err}"))
}

fn read_accounts() -> Vec<Account> {
    ACCOUNTS_FILE
        .get()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn write_accounts(accounts: &[Account]) -> GitResult<()> {
    let path = ACCOUNTS_FILE.get().ok_or_else(|| io("storage not ready"))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(io)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(accounts).map_err(io)?).map_err(io)
}

fn keychain(org_id: &str) -> GitResult<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, org_id).map_err(io)
}

/// Keys read this launch: the Keychain is asked once per organization, not on every request.
fn cached_keys() -> &'static Mutex<HashMap<String, String>> {
    static KEYS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    KEYS.get_or_init(Default::default)
}

/// Debug builds are re-signed on every rebuild, so macOS forgets "Always allow" and asks for the
/// Keychain password at each launch. In development only, keys also go to a 0600 file next to the
/// account list; release builds use the Keychain alone.
#[cfg(debug_assertions)]
mod dev_store {
    use std::collections::HashMap;
    use std::os::unix::fs::OpenOptionsExt;

    fn path() -> Option<std::path::PathBuf> {
        Some(
            super::ACCOUNTS_FILE
                .get()?
                .with_file_name("linear-keys.dev.json"),
        )
    }
    fn read() -> HashMap<String, String> {
        path()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }
    pub fn get(org_id: &str) -> Option<String> {
        read().remove(org_id)
    }
    pub fn set(org_id: &str, key: Option<&str>) {
        let Some(path) = path() else { return };
        let mut keys = read();
        match key {
            Some(k) => keys.insert(org_id.to_string(), k.to_string()),
            None => keys.remove(org_id),
        };
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path);
        if let (Ok(mut file), Ok(json)) = (file, serde_json::to_vec(&keys)) {
            let _ = std::io::Write::write_all(&mut file, &json);
        }
    }
}

fn key_of(org_id: &str) -> GitResult<String> {
    if let Some(key) = cached_keys()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(org_id)
    {
        return Ok(key.clone());
    }
    #[cfg(debug_assertions)]
    let stored = dev_store::get(org_id);
    #[cfg(not(debug_assertions))]
    let stored: Option<String> = None;
    let key = match stored {
        Some(key) => key,
        None => keychain(org_id)?.get_password().map_err(|_| {
            GitError::invalid("This Linear account is no longer connected. Add its API key again.")
        })?,
    };
    #[cfg(debug_assertions)]
    dev_store::set(org_id, Some(&key));
    cached_keys()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(org_id.to_string(), key.clone());
    Ok(key)
}

/// Personal API keys look like `lin_api_…`; anything else is refused before it leaves the machine.
pub fn valid_key(key: &str) -> bool {
    key.starts_with("lin_api_")
        && key.len() < 200
        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        .http_status_as_error(false)
        .build()
        .into()
}

fn graphql(key: &str, query: &str, variables: Value) -> GitResult<Value> {
    let mut response = agent()
        .post(ENDPOINT)
        .header("Authorization", key)
        .header("Content-Type", "application/json")
        .send_json(json!({ "query": query, "variables": variables }))
        .map_err(|err| GitError::new(ErrorKind::Io, format!("Linear is unreachable: {err}")))?;
    let status = response.status().as_u16();
    let body: Value = response.body_mut().read_json().map_err(io)?;
    if let Some(message) = body.pointer("/errors/0/message").and_then(Value::as_str) {
        let kind = if status == 401 || message.contains("authentication") {
            ErrorKind::InvalidInput
        } else {
            ErrorKind::Io
        };
        return Err(GitError::new(kind, format!("Linear: {message}")));
    }
    if status >= 400 {
        return Err(io(format!("HTTP {status}")));
    }
    Ok(body.get("data").cloned().unwrap_or(Value::Null))
}

const VIEWER: &str = "query { viewer { name organization { id name urlKey } } }";

/// Checks the key with Linear, then keeps it in the Keychain under its organization.
pub fn add_account(key: &str) -> GitResult<Account> {
    let key = key.trim();
    if !valid_key(key) {
        return Err(GitError::invalid(
            "This isn't a Linear personal API key (lin_api_…).",
        ));
    }
    let data = graphql(key, VIEWER, json!({}))?;
    let org = data
        .pointer("/viewer/organization")
        .ok_or_else(|| io("no organization"))?;
    let text = |v: &Value, k: &str| {
        v.get(k)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let account = Account {
        id: text(org, "id"),
        name: text(org, "name"),
        url_key: text(org, "urlKey"),
        user_name: data
            .pointer("/viewer/name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    };
    keychain(&account.id)?.set_password(key).map_err(io)?;
    #[cfg(debug_assertions)]
    dev_store::set(&account.id, Some(key));
    cached_keys()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(account.id.clone(), key.to_string());
    let mut accounts: Vec<Account> = read_accounts()
        .into_iter()
        .filter(|a| a.id != account.id)
        .collect();
    accounts.push(account.clone());
    write_accounts(&accounts)?;
    Ok(account)
}

pub fn accounts() -> Vec<Account> {
    read_accounts()
}

pub fn remove_account(org_id: &str) -> GitResult<()> {
    if let Ok(entry) = keychain(org_id) {
        let _ = entry.delete_credential();
    }
    #[cfg(debug_assertions)]
    dev_store::set(org_id, None);
    cached_keys()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(org_id);
    let accounts: Vec<Account> = read_accounts()
        .into_iter()
        .filter(|a| a.id != org_id)
        .collect();
    write_accounts(&accounts)
}

const ISSUE_FIELDS: &str = "id identifier title priority priorityLabel url branchName updatedAt
    state { id name type color position } team { id key name } project { id name icon color } cycle { number }
    labels { nodes { id name color } } assignee { id name avatarUrl }";

/// Open issues, plus those closed in the last two weeks (the Done and Canceled columns).
const OPEN_OR_RECENT: &str = "{ or: [
    { state: { type: { nin: [\"completed\", \"canceled\"] } } },
    { completedAt: { gt: \"-P2W\" } },
    { canceledAt: { gt: \"-P2W\" } } ] }";

/// Issues assigned to the user (open, or closed recently), most recently updated first.
pub fn my_issues(org_id: &str) -> GitResult<Value> {
    let query = format!(
        "query {{ viewer {{ assignedIssues(first: 200, orderBy: updatedAt,
           filter: {OPEN_OR_RECENT}) {{ nodes {{ {ISSUE_FIELDS} }} }} }} }}"
    );
    let data = graphql(&key_of(org_id)?, &query, json!({}))?;
    Ok(data
        .pointer("/viewer/assignedIssues/nodes")
        .cloned()
        .unwrap_or(json!([])))
}

/// Every issue of the workspace (anyone's), open or closed recently, most recently updated first.
/// ponytail: capped at 250; paginate with `after:` if a workspace has more open issues than that.
pub fn all_issues(org_id: &str) -> GitResult<Value> {
    let query = format!(
        "query {{ issues(first: 250, orderBy: updatedAt, filter: {OPEN_OR_RECENT}) {{ nodes {{ {ISSUE_FIELDS} }} }} }}"
    );
    let data = graphql(&key_of(org_id)?, &query, json!({}))?;
    Ok(data.pointer("/issues/nodes").cloned().unwrap_or(json!([])))
}

/// A search term Linear accepts: some text, at most 200 characters.
fn search_term(term: &str) -> GitResult<&str> {
    let term = term.trim();
    if term.is_empty() || term.chars().count() > 200 {
        return Err(GitError::invalid("Invalid search."));
    }
    Ok(term)
}

/// Linear's full-text search over the whole workspace (closed issues included), best matches first.
pub fn search_issues(org_id: &str, term: &str) -> GitResult<Value> {
    let term = search_term(term)?;
    let query = format!(
        "query($term: String!) {{ searchIssues(term: $term, first: 10) {{ nodes {{ {ISSUE_FIELDS} }} }} }}"
    );
    let data = graphql(&key_of(org_id)?, &query, json!({ "term": term }))?;
    Ok(data
        .pointer("/searchIssues/nodes")
        .cloned()
        .unwrap_or(json!([])))
}

/// One issue in full: description, people, links (pull requests…) and recent comments.
pub fn issue(org_id: &str, id: &str) -> GitResult<Value> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !valid {
        return Err(GitError::invalid("Invalid issue id."));
    }
    let query = format!(
        "query($id: String!) {{ issue(id: $id) {{ {ISSUE_FIELDS} description createdAt
           creator {{ name avatarUrl }}
           attachments {{ nodes {{ title subtitle url sourceType }} }}
           comments(first: 50) {{ nodes {{ id body createdAt parent {{ id }}
             user {{ id name avatarUrl isMe }} botActor {{ name avatarUrl }} }} }} }} }}"
    );
    let data = graphql(&key_of(org_id)?, &query, json!({ "id": id }))?;
    data.get("issue")
        .cloned()
        .ok_or_else(|| GitError::invalid("Issue not found."))
}

/// The workspace's projects with their icon, color, status and progress.
pub fn projects(org_id: &str) -> GitResult<Value> {
    let query = "query { projects(first: 100, orderBy: updatedAt) { nodes {
        id name icon color progress targetDate url
        status { name type color } lead { name avatarUrl } teams { nodes { id key } } } } }";
    let data = graphql(&key_of(org_id)?, query, json!({}))?;
    Ok(data
        .pointer("/projects/nodes")
        .cloned()
        .unwrap_or(json!([])))
}

/// Every issue of a project (anyone's), open or closed recently.
pub fn project_issues(org_id: &str, project_id: &str) -> GitResult<Value> {
    if !valid_id(project_id) {
        return Err(GitError::invalid("Invalid project id."));
    }
    let query = format!(
        "query($id: String!) {{ project(id: $id) {{ issues(first: 250, orderBy: updatedAt,
           filter: {OPEN_OR_RECENT}) {{ nodes {{ {ISSUE_FIELDS} }} }} }} }}"
    );
    let data = graphql(&key_of(org_id)?, &query, json!({ "id": project_id }))?;
    Ok(data
        .pointer("/project/issues/nodes")
        .cloned()
        .unwrap_or(json!([])))
}

/// The current cycle of each team that runs cycles, with all of its issues (anyone's).
pub fn active_cycles(org_id: &str) -> GitResult<Value> {
    let key = key_of(org_id)?;
    // Two steps: asking every team for its cycle *and* its issues at once is "too complex" for Linear.
    let teams = "query { teams(first: 50) { nodes { id key name
        activeCycle { id number name startsAt endsAt progress } } } }";
    let mut cycles = cycles_of(&graphql(&key, teams, json!({}))?);
    let query = format!(
        "query($id: String!) {{ cycle(id: $id) {{ issues(first: 250) {{ nodes {{ {ISSUE_FIELDS} }} }} }} }}"
    );
    for cycle in &mut cycles {
        let id = cycle["id"]
            .as_str()
            .filter(|id| valid_id(id))
            .map(str::to_owned);
        let Some(id) = id else { continue };
        let data = graphql(&key, &query, json!({ "id": id }))?;
        cycle["issues"] = data
            .pointer("/cycle/issues/nodes")
            .cloned()
            .unwrap_or(json!([]));
    }
    Ok(Value::Array(cycles))
}

/// One entry per team with an active cycle: the cycle and its team (its issues come next).
fn cycles_of(data: &Value) -> Vec<Value> {
    let teams = data.pointer("/teams/nodes").and_then(Value::as_array);
    teams
        .into_iter()
        .flatten()
        .filter_map(|team| {
            let mut cycle = team.get("activeCycle").filter(|c| !c.is_null())?.clone();
            cycle["issues"] = json!([]);
            cycle["team"] = json!({ "id": team["id"], "key": team["key"], "name": team["name"] });
            Some(cycle)
        })
        .collect()
}

/// Workflow states of every team, to move an issue to another column.
pub fn team_states(org_id: &str) -> GitResult<Value> {
    let query = "query { teams(first: 100) { nodes { id key name states { nodes { id name type color position } } } } }";
    let data = graphql(&key_of(org_id)?, query, json!({}))?;
    Ok(data.pointer("/teams/nodes").cloned().unwrap_or(json!([])))
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Moves an issue to another workflow state (drag and drop on the board).
pub fn set_issue_state(org_id: &str, issue_id: &str, state_id: &str) -> GitResult<()> {
    let patch = IssuePatch {
        state_id: Some(state_id.to_string()),
        ..IssuePatch::default()
    };
    update_issue(org_id, issue_id, &patch)
}

const MAX_DESCRIPTION: usize = 200_000;

/// The fields of an issue to change; absent ones are left as they are.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuePatch {
    pub title: Option<String>,
    pub description: Option<String>,
    /// 0 none, 1 urgent … 4 low, as in Linear.
    pub priority: Option<u8>,
    pub state_id: Option<String>,
    /// `null` unassigns.
    #[serde(default, deserialize_with = "nullable")]
    pub assignee_id: Option<Option<String>>,
    pub label_ids: Option<Vec<String>>,
    /// `null` removes the issue from its project.
    #[serde(default, deserialize_with = "nullable")]
    pub project_id: Option<Option<String>>,
}

/// Tells an explicit `null` (Some(None)) from a missing field (None).
fn nullable<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(d).map(Some)
}

fn invalid_ids<'a>(mut ids: impl Iterator<Item = &'a String>) -> bool {
    ids.any(|id| !valid_id(id))
}

/// The `IssueUpdateInput` of a patch, checked first: it goes to Linear as variables, never in the query.
fn patch_input(patch: &IssuePatch) -> GitResult<Value> {
    let title = patch.title.as_deref().map(str::trim);
    if title.is_some_and(|t| t.is_empty() || t.chars().count() > 255) {
        return Err(GitError::invalid(
            "An issue needs a title (255 characters at most).",
        ));
    }
    if patch
        .description
        .as_ref()
        .is_some_and(|d| d.len() > MAX_DESCRIPTION)
    {
        return Err(GitError::invalid("This description is too long."));
    }
    let ids = patch
        .state_id
        .iter()
        .chain(patch.assignee_id.iter().flatten())
        .chain(patch.project_id.iter().flatten())
        .chain(patch.label_ids.iter().flatten());
    if invalid_ids(ids) || patch.priority.is_some_and(|p| p > 4) {
        return Err(GitError::invalid(
            "Invalid state, person, label, project or priority.",
        ));
    }
    let mut input = json!({});
    let fields = [
        ("title", title.map(|t| json!(t))),
        ("description", patch.description.as_ref().map(|d| json!(d))),
        ("priority", patch.priority.map(|p| json!(p))),
        ("stateId", patch.state_id.as_ref().map(|s| json!(s))),
        ("assigneeId", patch.assignee_id.as_ref().map(|a| json!(a))),
        ("labelIds", patch.label_ids.as_ref().map(|l| json!(l))),
        ("projectId", patch.project_id.as_ref().map(|p| json!(p))),
    ];
    for (name, value) in fields {
        if let Some(value) = value {
            input[name] = value;
        }
    }
    if input.as_object().is_some_and(serde_json::Map::is_empty) {
        return Err(GitError::invalid("Nothing to change."));
    }
    Ok(input)
}

/// Changes some fields of an issue (title, description, properties).
pub fn update_issue(org_id: &str, issue_id: &str, patch: &IssuePatch) -> GitResult<()> {
    if !valid_id(issue_id) {
        return Err(GitError::invalid("Invalid issue id."));
    }
    let input = patch_input(patch)?;
    let query = "mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }";
    let data = graphql(
        &key_of(org_id)?,
        query,
        json!({ "id": issue_id, "input": input }),
    )?;
    if data
        .pointer("/issueUpdate/success")
        .and_then(Value::as_bool)
        == Some(true)
    {
        Ok(())
    } else {
        Err(io("the issue wasn't updated"))
    }
}

/// Active members of a team, to assign an issue.
pub fn team_members(org_id: &str, team_id: &str) -> GitResult<Value> {
    if !valid_id(team_id) {
        return Err(GitError::invalid("Invalid team id."));
    }
    let query = "query($id: String!) { team(id: $id) { members(first: 250) { nodes { id name avatarUrl url active } } } }";
    let data = graphql(&key_of(org_id)?, query, json!({ "id": team_id }))?;
    let members = data
        .pointer("/team/members/nodes")
        .and_then(Value::as_array)
        .map(|m| {
            m.iter()
                .filter(|u| u["active"] != json!(false))
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    Ok(Value::Array(members))
}

/// Labels an issue of the team can take: the team's own and the workspace's (groups excluded).
pub fn labels(org_id: &str, team_id: &str) -> GitResult<Value> {
    if !valid_id(team_id) {
        return Err(GitError::invalid("Invalid team id."));
    }
    let query = "query($id: ID!) { issueLabels(first: 250, filter: {
        or: [{ team: { id: { eq: $id } } }, { team: { null: true } }] }) { nodes { id name color isGroup } } }";
    let data = graphql(&key_of(org_id)?, query, json!({ "id": team_id }))?;
    Ok(assignable_labels(&data))
}

/// Group labels only gather others: an issue can't take them.
fn assignable_labels(data: &Value) -> Value {
    let nodes = data.pointer("/issueLabels/nodes").and_then(Value::as_array);
    nodes
        .into_iter()
        .flatten()
        .filter(|l| l["isGroup"] != json!(true))
        .cloned()
        .collect()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewIssue {
    pub team_id: String,
    pub title: String,
    pub description: String,
    /// 0 none, 1 urgent … 4 low, as in Linear.
    pub priority: u8,
    pub state_id: Option<String>,
    pub assign_to_me: bool,
    #[serde(default)]
    pub project_id: Option<String>,
}

/// Creates an issue; returns it with what an agent needs to work on it.
pub fn create_issue(org_id: &str, issue: &NewIssue) -> GitResult<Value> {
    let title = issue.title.trim();
    if title.is_empty() || title.chars().count() > 255 {
        return Err(GitError::invalid(
            "An issue needs a title (255 characters at most).",
        ));
    }
    let state_ok = issue.state_id.as_deref().is_none_or(valid_id)
        && issue.project_id.as_deref().is_none_or(valid_id);
    if !valid_id(&issue.team_id) || !state_ok || issue.priority > 4 {
        return Err(GitError::invalid("Invalid team, state or priority."));
    }
    let key = key_of(org_id)?;
    let mut input = json!({
        "teamId": issue.team_id,
        "title": title,
        "description": issue.description,
        "priority": issue.priority,
    });
    if let Some(state) = &issue.state_id {
        input["stateId"] = json!(state);
    }
    if let Some(project) = &issue.project_id {
        input["projectId"] = json!(project);
    }
    if issue.assign_to_me {
        let me = graphql(&key, "query { viewer { id } }", json!({}))?;
        input["assigneeId"] = me.pointer("/viewer/id").cloned().unwrap_or(Value::Null);
    }
    let query = "mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success
        issue { id identifier title description url branchName } } }";
    let data = graphql(&key, query, json!({ "input": input }))?;
    data.pointer("/issueCreate/issue")
        .filter(|_| {
            data.pointer("/issueCreate/success")
                .and_then(Value::as_bool)
                == Some(true)
        })
        .cloned()
        .ok_or_else(|| io("the issue wasn't created"))
}

/// Every workspace the user belongs to, connected or not (best effort: Linear may refuse it to API keys).
pub fn organizations(org_id: &str) -> GitResult<Value> {
    let query = "query { availableUsers { users { organization { id name urlKey logoUrl } } } }";
    let data = graphql(&key_of(org_id)?, query, json!({}))?;
    let orgs: Vec<Value> = data
        .pointer("/availableUsers/users")
        .and_then(Value::as_array)
        .map(|users| {
            users
                .iter()
                .filter_map(|u| u.get("organization").cloned())
                .collect()
        })
        .unwrap_or_default();
    Ok(Value::Array(orgs))
}

const UPLOADS: &str = "https://uploads.linear.app/";
const MAX_IMAGE: u64 = 10 * 1024 * 1024;

/// Linear uploads need the API key, so `<img>` can't load them: fetched here and returned as a data: URL.
pub fn image(org_id: &str, url: &str) -> GitResult<String> {
    if !upload_url(url) {
        return Err(GitError::invalid("Not a Linear upload."));
    }
    let mut response = agent()
        .get(url)
        .header("Authorization", &key_of(org_id)?)
        .call()
        .map_err(io)?;
    let status = response.status().as_u16();
    let mime = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();
    if status >= 400 || !mime.starts_with("image/") {
        return Err(io(format!("image unavailable (HTTP {status})")));
    }
    let bytes = response
        .body_mut()
        .with_config()
        .limit(MAX_IMAGE)
        .read_to_vec()
        .map_err(io)?;
    Ok(format!(
        "data:{mime};base64,{}",
        crate::git::read::base64(&bytes)
    ))
}

fn upload_url(url: &str) -> bool {
    url.starts_with(UPLOADS)
        && url.len() < 600
        && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

const MAX_COMMENT: usize = 50_000;

/// A comment's Markdown: some text, capped.
fn comment_body(body: &str) -> GitResult<&str> {
    let body = body.trim();
    if body.is_empty() || body.len() > MAX_COMMENT {
        return Err(GitError::invalid(
            "A comment needs some text (50,000 characters at most).",
        ));
    }
    Ok(body)
}

/// The `CommentCreateInput` of a comment on an issue, or of a reply in a thread (`parent_id`).
fn comment_input(issue_id: &str, body: &str, parent_id: Option<&str>) -> GitResult<Value> {
    if !valid_id(issue_id) || parent_id.is_some_and(|p| !valid_id(p)) {
        return Err(GitError::invalid("Invalid issue or comment id."));
    }
    let mut input = json!({ "issueId": issue_id, "body": comment_body(body)? });
    if let Some(parent) = parent_id {
        input["parentId"] = json!(parent);
    }
    Ok(input)
}

fn succeeded(data: &Value, mutation: &str, failure: &str) -> GitResult<()> {
    let success = data
        .pointer(&format!("/{mutation}/success"))
        .and_then(Value::as_bool);
    if success == Some(true) {
        Ok(())
    } else {
        Err(io(failure))
    }
}

/// Comments on an issue, or replies to `parent_id`'s thread.
pub fn create_comment(
    org_id: &str,
    issue_id: &str,
    body: &str,
    parent_id: Option<&str>,
) -> GitResult<()> {
    let input = comment_input(issue_id, body, parent_id)?;
    let query =
        "mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }";
    let data = graphql(&key_of(org_id)?, query, json!({ "input": input }))?;
    succeeded(&data, "commentCreate", "the comment wasn't posted")
}

/// Rewrites one of the user's comments (Linear refuses others').
pub fn update_comment(org_id: &str, id: &str, body: &str) -> GitResult<()> {
    if !valid_id(id) {
        return Err(GitError::invalid("Invalid comment id."));
    }
    let body = comment_body(body)?;
    let query = "mutation($id: String!, $input: CommentUpdateInput!) {
        commentUpdate(id: $id, input: $input) { success } }";
    let variables = json!({ "id": id, "input": { "body": body } });
    let data = graphql(&key_of(org_id)?, query, variables)?;
    succeeded(&data, "commentUpdate", "the comment wasn't updated")
}

pub fn delete_comment(org_id: &str, id: &str) -> GitResult<()> {
    if !valid_id(id) {
        return Err(GitError::invalid("Invalid comment id."));
    }
    let query = "mutation($id: String!) { commentDelete(id: $id) { success } }";
    let data = graphql(&key_of(org_id)?, query, json!({ "id": id }))?;
    succeeded(&data, "commentDelete", "the comment wasn't deleted")
}

const IMAGE_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/// The `fileUpload` variables of an image, checked first: PNG, JPEG, GIF or WebP of 10 MB at most.
fn upload_variables(content_type: &str, filename: &str, size: usize) -> GitResult<Value> {
    let name_ok = !filename.is_empty()
        && filename.chars().count() <= 255
        && !filename
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\');
    if !IMAGE_TYPES.contains(&content_type) || !name_ok || size == 0 || size as u64 > MAX_IMAGE {
        return Err(GitError::invalid(
            "Only PNG, JPEG, GIF or WebP images of 10 MB at most.",
        ));
    }
    Ok(json!({ "contentType": content_type, "filename": filename, "size": size }))
}

/// Headers of the upload PUT: type and cache first, then Linear's own (which win on a clash).
fn upload_headers(content_type: &str, file: &Value) -> Vec<(String, String)> {
    let mut headers = vec![
        ("Content-Type".to_string(), content_type.to_string()),
        (
            "Cache-Control".to_string(),
            "public, max-age=31536000".to_string(),
        ),
    ];
    for h in file["headers"].as_array().into_iter().flatten() {
        if let (Some(k), Some(v)) = (h["key"].as_str(), h["value"].as_str()) {
            headers.retain(|(name, _)| !name.eq_ignore_ascii_case(k));
            headers.push((k.to_string(), v.to_string()));
        }
    }
    headers
}

/// Uploads a pasted or dropped image to Linear's storage; returns its asset URL for `![](…)`.
pub fn upload_image(
    org_id: &str,
    filename: &str,
    content_type: &str,
    bytes: &[u8],
) -> GitResult<String> {
    let variables = upload_variables(content_type, filename, bytes.len())?;
    let query = "mutation($contentType: String!, $filename: String!, $size: Int!) {
        fileUpload(contentType: $contentType, filename: $filename, size: $size) {
          success uploadFile { uploadUrl assetUrl headers { key value } } } }";
    let data = graphql(&key_of(org_id)?, query, variables)?;
    let file = data
        .pointer("/fileUpload/uploadFile")
        .ok_or_else(|| io("Linear refused the upload"))?;
    let text = |p: &str| file.pointer(p).and_then(Value::as_str).unwrap_or_default();
    let (target, asset) = (text("/uploadUrl"), text("/assetUrl"));
    if !target.starts_with("https://") || !upload_url(asset) {
        return Err(io("unexpected upload URL"));
    }
    // The signed URL carries its own rights: the API key never goes there.
    let mut request = agent().put(target);
    for (name, value) in upload_headers(content_type, file) {
        request = request.header(name, value);
    }
    let status = request.send(bytes).map_err(io)?.status().as_u16();
    if status >= 400 {
        return Err(io(format!("upload failed (HTTP {status})")));
    }
    Ok(asset.to_string())
}

/// Release pipelines (with their stages) and the latest releases, in one request.
/// ponytail: the 100 most recently updated releases; paginate with `after:` if older ones matter.
const RELEASES: &str = "query {
    releasePipelines(first: 50) { nodes { id name type url stages { nodes { id name type color position } } } }
    releases(first: 100, orderBy: updatedAt) { nodes {
      id name version description url startDate targetDate startedAt completedAt canceledAt createdAt
      issueCount stage { id name type color position } pipeline { id name } } } }";

/// `{ pipelines, releases }` out of the answer to RELEASES; missing lists are empty.
fn release_lists(data: &Value) -> Value {
    let nodes = |path: &str| data.pointer(path).cloned().unwrap_or(json!([]));
    let mut pipelines = nodes("/releasePipelines/nodes");
    for pipeline in pipelines.as_array_mut().into_iter().flatten() {
        pipeline["stages"] = pipeline
            .pointer("/stages/nodes")
            .cloned()
            .unwrap_or(json!([]));
    }
    json!({ "pipelines": pipelines, "releases": nodes("/releases/nodes") })
}

/// Linear's releases: its pipelines (with their stages) and their latest releases.
pub fn releases(org_id: &str) -> GitResult<Value> {
    let data = graphql(&key_of(org_id)?, RELEASES, json!({}))?;
    Ok(release_lists(&data))
}

/// The issues shipped in (or planned for) a release.
pub fn release_issues(org_id: &str, release_id: &str) -> GitResult<Value> {
    if !valid_id(release_id) {
        return Err(GitError::invalid("Invalid release id."));
    }
    let query = format!(
        "query($id: String!) {{ release(id: $id) {{ issues(first: 250) {{ nodes {{ {ISSUE_FIELDS} }} }} }} }}"
    );
    let data = graphql(&key_of(org_id)?, &query, json!({ "id": release_id }))?;
    Ok(data
        .pointer("/release/issues/nodes")
        .cloned()
        .unwrap_or(json!([])))
}

/// What a release says about itself: its notes (Linear's release-note documents) and attached documents,
/// each as `{ title, url, content }` in Markdown.
pub fn release_writing(org_id: &str, release_id: &str) -> GitResult<Value> {
    if !valid_id(release_id) {
        return Err(GitError::invalid("Invalid release id."));
    }
    let query = "query($id: String!) { release(id: $id) {
        releaseNotes { title url documentContent { content } }
        documents(first: 10) { nodes { title url content } } } }";
    let data = graphql(&key_of(org_id)?, query, json!({ "id": release_id }))?;
    Ok(writing_of(&data))
}

/// Notes first, then documents; empty ones left out.
fn writing_of(data: &Value) -> Value {
    let notes = data
        .pointer("/release/releaseNotes")
        .and_then(Value::as_array);
    let docs = data
        .pointer("/release/documents/nodes")
        .and_then(Value::as_array);
    let notes = notes.into_iter().flatten().map(|n| {
        json!({ "title": n["title"], "url": n["url"], "content": n.pointer("/documentContent/content") })
    });
    let docs = docs
        .into_iter()
        .flatten()
        .map(|d| json!({ "title": d["title"], "url": d["url"], "content": d["content"] }));
    Value::Array(
        notes
            .chain(docs)
            .filter(|w| w["content"].as_str().is_some_and(|c| !c.trim().is_empty()))
            .collect(),
    )
}

#[cfg(test)]
mod release_writing_tests {
    use super::*;

    #[test]
    fn keeps_notes_then_documents_with_content() {
        let data = json!({ "release": {
            "releaseNotes": [{ "title": "v1", "url": "u", "documentContent": { "content": "## Notes" } }],
            "documents": { "nodes": [{ "title": "Plan", "url": "d", "content": "" }, { "title": "QA", "url": "q", "content": "ok" }] }
        }});
        let titles: Vec<_> = writing_of(&data)
            .as_array()
            .unwrap()
            .iter()
            .map(|w| w["title"].clone())
            .collect();
        assert_eq!(titles, [json!("v1"), json!("QA")]);
    }
}

fn stage_variables(release_id: &str, stage_id: &str) -> GitResult<Value> {
    if !valid_id(release_id) || !valid_id(stage_id) {
        return Err(GitError::invalid("Invalid release or stage id."));
    }
    Ok(json!({ "id": release_id, "input": { "stageId": stage_id } }))
}

/// Moves a release to another stage of its pipeline (Linear stamps started/completed dates).
pub fn set_release_stage(org_id: &str, release_id: &str, stage_id: &str) -> GitResult<()> {
    let variables = stage_variables(release_id, stage_id)?;
    let query = "mutation($id: String!, $input: ReleaseUpdateInput!) {
        releaseUpdate(id: $id, input: $input) { success } }";
    let data = graphql(&key_of(org_id)?, query, variables)?;
    succeeded(&data, "releaseUpdate", "the release wasn't moved")
}

#[cfg(test)]
mod release_tests {
    use super::*;

    #[test]
    fn release_lists_flatten_stages() {
        let data = json!({
            "releasePipelines": { "nodes": [{ "id": "p", "stages": { "nodes": [{ "id": "s" }] } }] },
            "releases": { "nodes": [{ "id": "r" }] }
        });
        assert_eq!(
            release_lists(&data),
            json!({ "pipelines": [{ "id": "p", "stages": [{ "id": "s" }] }], "releases": [{ "id": "r" }] })
        );
    }

    #[test]
    fn release_lists_default_to_empty() {
        assert_eq!(
            release_lists(&json!({})),
            json!({ "pipelines": [], "releases": [] })
        );
    }

    #[test]
    fn stage_moves_refuse_odd_ids() {
        assert!(stage_variables("r-1", "s\" }").is_err());
    }

    #[test]
    fn stage_moves_send_only_the_stage() {
        assert_eq!(
            stage_variables("r-1", "s-1").unwrap(),
            json!({ "id": "r-1", "input": { "stageId": "s-1" } })
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reply_names_its_thread() {
        assert_eq!(
            comment_input("issue-1", " Hi ", Some("c-1")).unwrap(),
            json!({ "issueId": "issue-1", "body": "Hi", "parentId": "c-1" })
        );
    }

    #[test]
    fn a_comment_on_the_issue_has_no_parent() {
        assert_eq!(
            comment_input("issue-1", "Hi", None).unwrap(),
            json!({ "issueId": "issue-1", "body": "Hi" })
        );
    }

    #[test]
    fn comments_refuse_odd_ids() {
        assert!(comment_input("issue-1", "Hi", Some("x\" }")).is_err());
    }

    #[test]
    fn comments_need_text_and_are_capped() {
        let long = "a".repeat(MAX_COMMENT + 1);
        assert!(
            [comment_body("  "), comment_body(&long)]
                .iter()
                .all(Result::is_err)
        );
    }

    #[test]
    fn only_small_common_images_are_uploaded() {
        assert!(upload_variables("image/png", "shot.png", 1024).is_ok());
        assert!(
            upload_variables("image/svg+xml", "a.svg", 10).is_err()
                && upload_variables("image/png", "a.png", 10 * 1024 * 1024 + 1).is_err()
                && upload_variables("image/png", "../a.png", 10).is_err()
                && upload_variables("image/png", "a.png", 0).is_err()
        );
    }

    #[test]
    fn linear_upload_headers_win() {
        let file = json!({ "headers": [{ "key": "cache-control", "value": "no-cache" },
                                       { "key": "x-goog-meta", "value": "1" }] });
        assert_eq!(
            upload_headers("image/png", &file),
            vec![
                ("Content-Type".to_string(), "image/png".to_string()),
                ("cache-control".to_string(), "no-cache".to_string()),
                ("x-goog-meta".to_string(), "1".to_string()),
            ]
        );
    }

    fn draft(title: &str, priority: u8) -> NewIssue {
        NewIssue {
            team_id: "team-1".into(),
            title: title.into(),
            description: String::new(),
            priority,
            state_id: None,
            assign_to_me: false,
            project_id: None,
        }
    }

    #[test]
    fn a_search_needs_text_of_at_most_200_characters() {
        let long = "é".repeat(201);
        assert!(
            [search_term("  "), search_term(&long)]
                .iter()
                .all(Result::is_err)
        );
        assert_eq!(search_term(" fix login ").unwrap(), "fix login");
        assert!(search_issues("org", "").is_err());
    }

    #[test]
    fn an_issue_needs_a_title() {
        assert!(create_issue("org", &draft("   ", 0)).is_err());
    }

    #[test]
    fn priorities_stop_at_low() {
        assert!(create_issue("org", &draft("Fix it", 5)).is_err());
    }

    fn patch(json: Value) -> IssuePatch {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn a_patch_sends_only_its_fields() {
        let input = patch_input(&patch(json!({ "title": " New ", "priority": 2 }))).unwrap();
        assert_eq!(input, json!({ "title": "New", "priority": 2 }));
    }

    #[test]
    fn null_unassigns_and_leaves_the_project() {
        let input = patch_input(&patch(json!({ "assigneeId": null, "projectId": null }))).unwrap();
        assert_eq!(input, json!({ "assigneeId": null, "projectId": null }));
    }

    #[test]
    fn a_patch_keeps_an_empty_label_list() {
        let input = patch_input(&patch(json!({ "labelIds": [] }))).unwrap();
        assert_eq!(input, json!({ "labelIds": [] }));
    }

    #[test]
    fn a_patch_cannot_blank_the_title() {
        assert!(patch_input(&patch(json!({ "title": "  " }))).is_err());
    }

    #[test]
    fn a_patch_refuses_odd_ids() {
        assert!(patch_input(&patch(json!({ "labelIds": ["ok", "x\" } }"] }))).is_err());
    }

    #[test]
    fn a_patch_refuses_unknown_priorities() {
        assert!(patch_input(&patch(json!({ "priority": 5 }))).is_err());
    }

    #[test]
    fn an_empty_patch_is_refused() {
        assert!(patch_input(&IssuePatch::default()).is_err());
    }

    #[test]
    fn group_labels_cannot_be_picked() {
        let data = json!({ "issueLabels": { "nodes": [
            { "id": "g", "isGroup": true }, { "id": "l", "isGroup": false }
        ] } });
        assert_eq!(
            assignable_labels(&data),
            json!([{ "id": "l", "isGroup": false }])
        );
    }

    #[test]
    fn descriptions_are_capped() {
        let long = "a".repeat(MAX_DESCRIPTION + 1);
        assert!(patch_input(&patch(json!({ "description": long }))).is_err());
    }

    #[test]
    fn only_personal_api_keys_are_accepted() {
        assert!(valid_key("lin_api_ABCdef123"));
        assert!(
            !valid_key("Bearer lin_api_x")
                && !valid_key("lin_oauth_x")
                && !valid_key("lin_api_\nX-Evil: 1")
        );
    }

    #[test]
    fn only_linear_uploads_are_fetched_with_the_key() {
        assert!(upload_url("https://uploads.linear.app/a/b/c.png"));
        assert!(
            !upload_url("https://uploads.linear.app.evil.com/x")
                && !upload_url("https://evil.com/?u=https://uploads.linear.app/")
                && !upload_url("http://uploads.linear.app/x")
        );
    }

    #[test]
    fn only_teams_running_a_cycle_have_one() {
        let data = json!({ "teams": { "nodes": [
            { "id": "a", "key": "A", "name": "A", "activeCycle": null },
            { "id": "b", "key": "B", "name": "B", "activeCycle": { "number": 4 } }
        ] } });
        assert_eq!(
            cycles_of(&data),
            vec![
                json!({ "number": 4, "issues": [], "team": { "id": "b", "key": "B", "name": "B" } })
            ]
        );
    }
}

/// One Linear inbox notification about an issue, flattened for the app's inbox.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinearNotification {
    pub id: String,
    /// issueAssignedToYou, issueNewComment, issueMention, issueStatusChanged…
    pub kind: String,
    pub updated_at: String,
    pub read: bool,
    pub actor: Option<String>,
    pub issue_id: String,
    pub identifier: String,
    pub title: String,
    pub url: String,
    /// Start of the comment the notification is about, if any.
    pub comment: Option<String>,
}

const NOTIFICATIONS: &str = "query { notifications(first: 50) { nodes {
    id type updatedAt readAt actor { name }
    ... on IssueNotification { issue { id identifier title url } comment { body } } } } }";

/// Issue notifications of `notifications { nodes }`; project updates and the like are left out.
fn parse_notifications(data: &Value) -> Vec<LinearNotification> {
    let nodes = data
        .pointer("/notifications/nodes")
        .and_then(Value::as_array);
    let text = |v: &Value, p: &str| v.pointer(p).and_then(Value::as_str).map(str::to_owned);
    nodes
        .into_iter()
        .flatten()
        .filter_map(|n| {
            Some(LinearNotification {
                id: text(n, "/id")?,
                kind: text(n, "/type").unwrap_or_default(),
                updated_at: text(n, "/updatedAt")?,
                read: n.get("readAt").is_some_and(|r| !r.is_null()),
                actor: text(n, "/actor/name"),
                issue_id: text(n, "/issue/id")?,
                identifier: text(n, "/issue/identifier")?,
                title: text(n, "/issue/title")?,
                url: text(n, "/issue/url").unwrap_or_default(),
                comment: text(n, "/comment/body").map(|b| b.chars().take(200).collect()),
            })
        })
        .collect()
}

/// The user's Linear inbox (not archived), newest first.
pub fn notifications(org_id: &str) -> GitResult<Vec<LinearNotification>> {
    let data = graphql(&key_of(org_id)?, NOTIFICATIONS, json!({}))?;
    Ok(parse_notifications(&data))
}

/// `readAt` is an ISO timestamp from the app (marks read) or none (marks unread).
fn valid_timestamp(at: &str) -> bool {
    !at.is_empty()
        && at.len() <= 40
        && at
            .chars()
            .all(|c| c.is_ascii_digit() || "-:.TZ+".contains(c))
}

/// Marks a notification read at `read_at`, or unread when it's None.
pub fn set_notification_read(org_id: &str, id: &str, read_at: Option<&str>) -> GitResult<()> {
    if !valid_id(id) || read_at.is_some_and(|at| !valid_timestamp(at)) {
        return Err(GitError::invalid("Invalid notification."));
    }
    let mutation = "mutation($id: String!, $readAt: DateTime) {
        notificationUpdate(id: $id, input: { readAt: $readAt }) { success } }";
    graphql(
        &key_of(org_id)?,
        mutation,
        json!({ "id": id, "readAt": read_at }),
    )
    .map(|_| ())
}

/// Archives a notification: it leaves Linear's inbox, like Done in the app.
pub fn archive_notification(org_id: &str, id: &str) -> GitResult<()> {
    if !valid_id(id) {
        return Err(GitError::invalid("Invalid notification."));
    }
    let mutation = "mutation($id: String!) { notificationArchive(id: $id) { success } }";
    graphql(&key_of(org_id)?, mutation, json!({ "id": id })).map(|_| ())
}

#[cfg(test)]
mod notification_tests {
    use super::*;

    fn sample() -> Value {
        json!({ "notifications": { "nodes": [
            { "id": "n1", "type": "issueNewComment", "updatedAt": "2026-11-10T09:00:00Z", "readAt": null,
              "actor": { "name": "Ada" },
              "issue": { "id": "i1", "identifier": "ENG-1", "title": "Crash", "url": "https://linear.app/x/issue/ENG-1" },
              "comment": { "body": "Looks good" } },
            { "id": "n2", "type": "issueAssignedToYou", "updatedAt": "2026-11-09T09:00:00Z",
              "readAt": "2026-11-09T10:00:00Z", "actor": null,
              "issue": { "id": "i2", "identifier": "ENG-2", "title": "Inbox", "url": "https://linear.app/x/issue/ENG-2" } },
            { "id": "n3", "type": "projectUpdateCreated", "updatedAt": "2026-11-08T09:00:00Z", "readAt": null }
        ] } })
    }

    #[test]
    fn notifications_without_an_issue_are_left_out() {
        assert_eq!(parse_notifications(&sample()).len(), 2);
    }

    #[test]
    fn a_null_read_at_is_unread() {
        let list = parse_notifications(&sample());
        assert_eq!((list[0].read, list[1].read), (false, true));
    }

    #[test]
    fn comments_come_along() {
        assert_eq!(
            parse_notifications(&sample())[0].comment.as_deref(),
            Some("Looks good")
        );
    }

    #[test]
    fn timestamps_cannot_carry_anything_else() {
        assert!(!valid_timestamp("2026-11-10T09:00:00Z\"}"));
    }
}
