//! Tauri command surface: thin, typed wrappers. Blocking git calls run off the async runtime.

use std::path::PathBuf;

use crate::git::errors::{ErrorKind, GitError, GitResult};
use crate::git::github::{GithubUser, PullRequest};
use crate::git::identity::GitIdentity;
use crate::git::model::*;
use crate::git::read::{self, LogFilters, WorkingSide};
use crate::git::{github, identity, validate, write};

async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> GitResult<T> + Send + 'static,
) -> GitResult<T> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|err| GitError::new(ErrorKind::Io, format!("Background task failed: {err}")))?
}

fn repo(path: &str) -> GitResult<PathBuf> {
    validate::repo_path(path)
}

#[tauri::command]
pub async fn open_repository(path: String) -> GitResult<RepositoryInfo> {
    blocking(move || read::open_repository(&path)).await
}

#[tauri::command]
pub async fn list_refs(repo_path: String) -> GitResult<RefsSnapshot> {
    blocking(move || read::list_refs(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn list_commits(
    repo_path: String,
    rev: Option<String>,
    skip: u32,
    limit: u32,
    filters: Option<LogFilters>,
) -> GitResult<Vec<CommitSummary>> {
    let filters = filters.unwrap_or_default();
    blocking(move || read::list_commits(&repo(&repo_path)?, rev.as_deref(), skip, limit, filters))
        .await
}

#[tauri::command]
pub async fn list_commit_files(repo_path: String, hash: String) -> GitResult<Vec<ChangedFile>> {
    blocking(move || read::list_commit_files(&repo(&repo_path)?, &hash)).await
}

#[tauri::command]
pub async fn get_commit_diff(
    repo_path: String,
    hash: String,
    path: String,
    previous_path: Option<String>,
) -> GitResult<FileDiff> {
    blocking(move || {
        read::commit_file_diff(&repo(&repo_path)?, &hash, &path, previous_path.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn get_working_tree(repo_path: String) -> GitResult<Vec<WorkingTreeEntry>> {
    blocking(move || read::working_tree(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn get_working_diff(
    repo_path: String,
    path: String,
    previous_path: Option<String>,
    side: WorkingSide,
) -> GitResult<FileDiff> {
    blocking(move || {
        read::working_file_diff(&repo(&repo_path)?, &path, previous_path.as_deref(), side)
    })
    .await
}

#[tauri::command]
pub async fn get_avatar_url(
    repo_path: String,
    hash: String,
    email: String,
) -> GitResult<Option<String>> {
    blocking(move || github::avatar_url(&repo(&repo_path)?, &hash, &email)).await
}

#[tauri::command]
pub async fn list_pull_requests(repo_path: String) -> GitResult<Vec<PullRequest>> {
    blocking(move || github::list_pull_requests(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn fetch_pull_request(
    repo_path: String,
    number: u32,
    base: String,
    head_oid: String,
) -> GitResult<String> {
    blocking(move || github::fetch_pull_request(&repo(&repo_path)?, number, &base, &head_oid)).await
}

#[tauri::command]
pub async fn get_github_user(repo_path: String) -> GitResult<GithubUser> {
    blocking(move || github::github_user(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn get_git_identity() -> GitResult<GitIdentity> {
    blocking(identity::read_identity).await
}

#[tauri::command]
pub async fn set_git_identity(name: String, email: String) -> GitResult<GitIdentity> {
    blocking(move || identity::write_identity(&name, &email)).await
}

#[tauri::command]
pub async fn stage_files(repo_path: String, paths: Vec<String>) -> GitResult<()> {
    blocking(move || write::stage(&repo(&repo_path)?, &paths)).await
}

#[tauri::command]
pub async fn unstage_files(repo_path: String, paths: Vec<String>) -> GitResult<()> {
    blocking(move || write::unstage(&repo(&repo_path)?, &paths)).await
}

#[tauri::command]
pub async fn create_commit(repo_path: String, message: String) -> GitResult<String> {
    blocking(move || write::commit(&repo(&repo_path)?, &message)).await
}

#[tauri::command]
pub async fn switch_branch(repo_path: String, name: String) -> GitResult<()> {
    blocking(move || write::switch_branch(&repo(&repo_path)?, &name)).await
}

#[tauri::command]
pub async fn create_branch(repo_path: String, name: String, switch: bool) -> GitResult<()> {
    blocking(move || write::create_branch(&repo(&repo_path)?, &name, switch)).await
}

#[tauri::command]
pub async fn fetch(repo_path: String) -> GitResult<()> {
    blocking(move || write::fetch(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn pull(repo_path: String) -> GitResult<()> {
    blocking(move || write::pull(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn push(repo_path: String) -> GitResult<()> {
    blocking(move || write::push(&repo(&repo_path)?)).await
}
