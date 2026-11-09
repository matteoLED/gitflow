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
    labels { nodes { name color } } assignee { name avatarUrl }";

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
           assignee {{ name avatarUrl }} creator {{ name avatarUrl }}
           attachments {{ nodes {{ title subtitle url sourceType }} }}
           comments(first: 30) {{ nodes {{ body createdAt user {{ name avatarUrl }} botActor {{ name avatarUrl }} }} }} }} }}"
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
    if !valid_id(issue_id) || !valid_id(state_id) {
        return Err(GitError::invalid("Invalid issue or state id."));
    }
    let query = "mutation($id: String!, $state: String!) { issueUpdate(id: $id, input: { stateId: $state }) { success } }";
    let data = graphql(
        &key_of(org_id)?,
        query,
        json!({ "id": issue_id, "state": state_id }),
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn an_issue_needs_a_title() {
        assert!(create_issue("org", &draft("   ", 0)).is_err());
    }

    #[test]
    fn priorities_stop_at_low() {
        assert!(create_issue("org", &draft("Fix it", 5)).is_err());
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
