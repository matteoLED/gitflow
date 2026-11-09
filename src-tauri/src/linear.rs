//! Linear: the user's issues across their organizations, read with personal API keys.
//! Keys live in the macOS Keychain (one entry per organization); only names and ids are stored on disk.

use std::path::PathBuf;
use std::sync::OnceLock;
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

fn key_of(org_id: &str) -> GitResult<String> {
    keychain(org_id)?.get_password().map_err(|_| {
        GitError::invalid("This Linear account is no longer connected. Add its API key again.")
    })
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
    let accounts: Vec<Account> = read_accounts()
        .into_iter()
        .filter(|a| a.id != org_id)
        .collect();
    write_accounts(&accounts)
}

const ISSUE_FIELDS: &str = "id identifier title priority priorityLabel url branchName updatedAt
    state { name type color } team { id key name } project { name } cycle { number }
    labels { nodes { name color } }";

/// Open issues assigned to the user, most recently updated first.
pub fn my_issues(org_id: &str) -> GitResult<Value> {
    let query = format!(
        "query {{ viewer {{ assignedIssues(first: 150, orderBy: updatedAt,
           filter: {{ state: {{ type: {{ nin: [\"completed\", \"canceled\"] }} }} }}) {{ nodes {{ {ISSUE_FIELDS} }} }} }} }}"
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

/// Workflow states of every team, to move an issue to another column.
pub fn team_states(org_id: &str) -> GitResult<Value> {
    let query = "query { teams(first: 100) { nodes { id states { nodes { id name type color position } } } } }";
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
}
