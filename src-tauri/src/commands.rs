//! Tauri command surface: thin, typed wrappers. Blocking git calls run off the async runtime.

use std::path::PathBuf;

use crate::agents;
use crate::browser;
use crate::code_graph;
use crate::git::errors::{ErrorKind, GitError, GitResult};
use crate::git::github::{GithubUser, PullRequest, PullRequestRange, ReviewEvent};
use crate::git::identity::GitIdentity;
use crate::git::model::*;
use crate::git::read::{self, LogFilters, WorkingSide};
use crate::git::{conflicts, files, github, identity, rewrite, validate, worktrees, write};
use crate::linear;
use crate::preview;
use crate::preview_view;
use crate::terminal;
use crate::watcher;

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
pub async fn list_files(repo_path: String) -> GitResult<Vec<String>> {
    blocking(move || files::list_files(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn read_file(repo_path: String, path: String) -> GitResult<files::EditorFile> {
    blocking(move || files::read_file(&repo(&repo_path)?, &path)).await
}

#[tauri::command]
pub async fn write_file(
    repo_path: String,
    path: String,
    content: String,
    expected_mtime: Option<u64>,
) -> GitResult<u64> {
    blocking(move || files::write_file(&repo(&repo_path)?, &path, &content, expected_mtime)).await
}

#[tauri::command]
pub async fn search_files(
    repo_path: String,
    query: String,
    options: files::MatchOptions,
) -> GitResult<files::SearchResults> {
    blocking(move || files::search(&repo(&repo_path)?, &query, options)).await
}

#[tauri::command]
pub async fn replace_in_files(
    repo_path: String,
    request: files::ReplaceRequest,
) -> GitResult<files::ReplaceOutcome> {
    blocking(move || files::replace(&repo(&repo_path)?, &request)).await
}

#[tauri::command]
pub async fn create_file(repo_path: String, path: String) -> GitResult<()> {
    blocking(move || files::create_file(&repo(&repo_path)?, &path)).await
}

#[tauri::command]
pub async fn create_dir(repo_path: String, path: String) -> GitResult<()> {
    blocking(move || files::create_dir(&repo(&repo_path)?, &path)).await
}

#[tauri::command]
pub async fn rename_path(repo_path: String, from: String, to: String) -> GitResult<()> {
    blocking(move || files::rename_path(&repo(&repo_path)?, &from, &to)).await
}

#[tauri::command]
pub async fn duplicate_file(repo_path: String, path: String) -> GitResult<String> {
    blocking(move || files::duplicate_file(&repo(&repo_path)?, &path)).await
}

#[tauri::command]
pub async fn delete_path(repo_path: String, path: String) -> GitResult<()> {
    blocking(move || files::delete_path(&repo(&repo_path)?, &path)).await
}

#[tauri::command]
pub async fn reveal_path(repo_path: String, path: String) -> GitResult<()> {
    blocking(move || files::reveal_path(&repo(&repo_path)?, &path)).await
}

#[tauri::command]
pub async fn line_changes(repo_path: String, path: String) -> GitResult<Vec<files::LineChange>> {
    blocking(move || files::line_changes(&repo(&repo_path)?, &path)).await
}

#[tauri::command]
pub async fn blame_file(
    repo_path: String,
    path: String,
) -> GitResult<Vec<crate::git::blame::BlameHunk>> {
    blocking(move || crate::git::blame::blame_file(&repo(&repo_path)?, &path)).await
}

#[tauri::command]
pub async fn file_history(
    repo_path: String,
    path: String,
) -> GitResult<Vec<crate::git::blame::FileCommit>> {
    blocking(move || crate::git::blame::file_history(&repo(&repo_path)?, &path)).await
}

#[tauri::command]
pub async fn commit_pull_request(
    repo_path: String,
    sha: String,
) -> GitResult<Option<crate::git::blame::CommitPullRequest>> {
    blocking(move || crate::git::blame::commit_pull_request(&repo(&repo_path)?, &sha)).await
}

#[tauri::command]
pub async fn lsp_start(
    app: tauri::AppHandle,
    repo_path: String,
    language: String,
) -> GitResult<String> {
    blocking(move || crate::lsp::start(app, &repo(&repo_path)?, &language)).await
}

#[tauri::command]
pub fn lsp_send(id: String, message: String) -> GitResult<()> {
    crate::lsp::send(&id, &message)
}

#[tauri::command]
pub fn lsp_stop(id: String) {
    crate::lsp::stop(&id)
}

#[tauri::command]
pub async fn get_operation(repo_path: String) -> GitResult<Option<conflicts::Operation>> {
    blocking(move || conflicts::operation(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn continue_operation(repo_path: String) -> GitResult<()> {
    blocking(move || conflicts::continue_operation(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn abort_operation(repo_path: String) -> GitResult<()> {
    blocking(move || conflicts::abort_operation(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn skip_rebase_commit(repo_path: String) -> GitResult<()> {
    blocking(move || conflicts::skip_commit(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn cherry_pick_commit(repo_path: String, hash: String) -> GitResult<rewrite::Outcome> {
    blocking(move || rewrite::cherry_pick(&repo(&repo_path)?, &hash)).await
}

#[tauri::command]
pub async fn revert_commit(repo_path: String, hash: String) -> GitResult<rewrite::Outcome> {
    blocking(move || rewrite::revert(&repo(&repo_path)?, &hash)).await
}

#[tauri::command]
pub async fn rebase_plan(repo_path: String, from: String) -> GitResult<Vec<rewrite::RebaseCommit>> {
    blocking(move || rewrite::rebase_plan(&repo(&repo_path)?, &from)).await
}

#[tauri::command]
pub async fn interactive_rebase(
    repo_path: String,
    from: String,
    steps: Vec<rewrite::RebaseStep>,
    confirmed: bool,
) -> GitResult<rewrite::Outcome> {
    blocking(move || rewrite::interactive_rebase(&repo(&repo_path)?, &from, &steps, confirmed))
        .await
}

#[tauri::command]
pub async fn resolve_with_side(
    repo_path: String,
    paths: Vec<String>,
    theirs: bool,
) -> GitResult<()> {
    blocking(move || conflicts::take_side(&repo(&repo_path)?, &paths, theirs)).await
}

#[tauri::command]
pub async fn create_agent_worktree(repo_path: String) -> GitResult<worktrees::Worktree> {
    blocking(move || worktrees::create(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn list_agent_worktrees(repo_path: String) -> GitResult<Vec<worktrees::Worktree>> {
    blocking(move || worktrees::list(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn agent_worktree_status(
    repo_path: String,
    path: String,
) -> GitResult<worktrees::WorktreeStatus> {
    blocking(move || worktrees::status(&repo(&repo_path)?, &path)).await
}

#[tauri::command]
pub async fn agent_worktree_diff(repo_path: String, path: String) -> GitResult<String> {
    blocking(move || worktrees::diff(&repo(&repo_path)?, &path)).await
}

#[tauri::command]
pub async fn compare_agent_worktrees(repo_path: String, a: String, b: String) -> GitResult<String> {
    blocking(move || worktrees::compare(&repo(&repo_path)?, &a, &b)).await
}

#[tauri::command]
pub async fn publish_agent_worktree(
    repo_path: String,
    path: String,
    title: String,
    body: String,
) -> GitResult<String> {
    blocking(move || worktrees::publish(&repo(&repo_path)?, &path, &title, &body)).await
}

#[tauri::command]
pub async fn merge_agent_worktree(
    repo_path: String,
    path: String,
    message: String,
) -> GitResult<()> {
    blocking(move || worktrees::merge(&repo(&repo_path)?, &path, &message)).await
}

#[tauri::command]
pub async fn remove_agent_worktree(
    repo_path: String,
    path: String,
    delete_branch: bool,
) -> GitResult<()> {
    blocking(move || worktrees::remove(&repo(&repo_path)?, &path, delete_branch)).await
}

#[tauri::command]
pub async fn list_slash_commands(
    repo_path: String,
) -> GitResult<Vec<agents::definitions::SlashCommand>> {
    blocking(move || agents::definitions::list_commands(&repo(&repo_path)?)).await
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
pub async fn list_commit_files(
    repo_path: String,
    hash: String,
    base: Option<String>,
) -> GitResult<Vec<ChangedFile>> {
    blocking(move || read::list_commit_files(&repo(&repo_path)?, &hash, base.as_deref())).await
}

#[tauri::command]
pub async fn get_commit_diff(
    repo_path: String,
    hash: String,
    path: String,
    previous_path: Option<String>,
    base: Option<String>,
) -> GitResult<FileDiff> {
    blocking(move || {
        read::commit_file_diff(
            &repo(&repo_path)?,
            &hash,
            &path,
            previous_path.as_deref(),
            base.as_deref(),
        )
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
) -> GitResult<PullRequestRange> {
    blocking(move || github::fetch_pull_request(&repo(&repo_path)?, number, &base, &head_oid)).await
}

#[tauri::command]
pub async fn submit_review(
    repo_path: String,
    number: u32,
    event: ReviewEvent,
    body: String,
) -> GitResult<()> {
    blocking(move || github::submit_review(&repo(&repo_path)?, number, event, &body)).await
}

#[tauri::command]
pub async fn get_pull_request_details(
    repo_path: String,
    number: u32,
) -> GitResult<serde_json::Value> {
    blocking(move || github::pull_request_details(&repo(&repo_path)?, number)).await
}

#[tauri::command]
pub async fn comment_pull_request(repo_path: String, number: u32, body: String) -> GitResult<()> {
    blocking(move || github::comment_pull_request(&repo(&repo_path)?, number, &body)).await
}

#[tauri::command]
pub async fn compare_with_base(
    repo_path: String,
    base: Option<String>,
) -> GitResult<Option<github::BranchComparison>> {
    blocking(move || github::compare_with_base(&repo(&repo_path)?, base.as_deref())).await
}

#[tauri::command]
pub async fn create_pull_request(
    repo_path: String,
    base: String,
    title: String,
    body: String,
    draft: bool,
) -> GitResult<String> {
    blocking(move || github::create_pull_request(&repo(&repo_path)?, &base, &title, &body, draft))
        .await
}

#[tauri::command]
pub async fn rerun_failed_checks(repo_path: String, run_ids: Vec<u64>) -> GitResult<()> {
    blocking(move || github::rerun_failed_checks(&repo(&repo_path)?, &run_ids)).await
}

#[tauri::command]
pub async fn list_review_threads(repo_path: String, number: u32) -> GitResult<serde_json::Value> {
    blocking(move || github::review_threads(&repo(&repo_path)?, number)).await
}

#[tauri::command]
pub async fn resolve_review_thread(
    repo_path: String,
    thread_id: String,
    resolved: bool,
) -> GitResult<()> {
    blocking(move || github::resolve_thread(&repo(&repo_path)?, &thread_id, resolved)).await
}

#[tauri::command]
pub async fn react_to_comment(
    repo_path: String,
    subject_id: String,
    content: String,
    add: bool,
) -> GitResult<()> {
    blocking(move || github::react(&repo(&repo_path)?, &subject_id, &content, add)).await
}

#[tauri::command]
pub async fn edit_review_comment(
    repo_path: String,
    comment_id: u64,
    body: String,
) -> GitResult<()> {
    blocking(move || github::edit_review_comment(&repo(&repo_path)?, comment_id, &body)).await
}

#[tauri::command]
pub async fn delete_review_comment(repo_path: String, comment_id: u64) -> GitResult<()> {
    blocking(move || github::delete_review_comment(&repo(&repo_path)?, comment_id)).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn comment_line(
    repo_path: String,
    number: u32,
    commit: String,
    path: String,
    line: u32,
    side: String,
    body: String,
) -> GitResult<()> {
    blocking(move || {
        github::comment_line(
            &repo(&repo_path)?,
            number,
            &commit,
            &path,
            line,
            &side,
            &body,
        )
    })
    .await
}

#[tauri::command]
pub async fn reply_review_comment(
    repo_path: String,
    number: u32,
    comment_id: u64,
    body: String,
) -> GitResult<()> {
    blocking(move || github::reply_review_comment(&repo(&repo_path)?, number, comment_id, &body))
        .await
}

#[tauri::command]
pub async fn add_reviewer(repo_path: String, number: u32, login: String) -> GitResult<()> {
    blocking(move || github::add_reviewer(&repo(&repo_path)?, number, &login)).await
}

#[tauri::command]
pub async fn set_pull_request_state(
    repo_path: String,
    number: u32,
    state: github::PrState,
) -> GitResult<()> {
    blocking(move || github::set_pull_request_state(&repo(&repo_path)?, number, state)).await
}

#[tauri::command]
pub async fn get_job_log(repo_path: String, job_id: u64, failed_only: bool) -> GitResult<String> {
    blocking(move || github::job_log(&repo(&repo_path)?, job_id, failed_only)).await
}

#[tauri::command]
pub async fn merge_pull_request(
    repo_path: String,
    number: u32,
    method: github::MergeMethod,
) -> GitResult<()> {
    blocking(move || github::merge_pull_request(&repo(&repo_path)?, number, method)).await
}

#[tauri::command]
pub async fn list_workflow_runs(repo_path: String) -> GitResult<serde_json::Value> {
    blocking(move || github::list_workflow_runs(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn get_workflow_run(repo_path: String, id: u64) -> GitResult<serde_json::Value> {
    blocking(move || github::workflow_run(&repo(&repo_path)?, id)).await
}

#[tauri::command]
pub async fn detect_agents() -> GitResult<Vec<agents::AgentInfo>> {
    blocking(|| Ok(agents::detect())).await
}

#[tauri::command]
pub async fn start_agent_run(
    app: tauri::AppHandle,
    repo_path: String,
    agent: agents::AgentKind,
    task: agents::AgentTask,
    locale: String,
    resume: Option<String>,
    settings: Option<agents::RunSettings>,
) -> GitResult<String> {
    let settings = settings.unwrap_or_default();
    blocking(move || {
        agents::start(
            app,
            &repo(&repo_path)?,
            agent,
            &task,
            &locale,
            resume.as_deref(),
            &settings,
        )
    })
    .await
}

#[tauri::command]
pub fn cancel_agent_run(run_id: String) {
    agents::cancel(&run_id);
}

#[tauri::command]
pub async fn list_agent_sessions(
    repo_path: String,
) -> GitResult<Vec<agents::sessions::SessionSummary>> {
    blocking(move || agents::sessions::list_sessions(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn list_agent_sessions_page(
    repo_path: String,
    offset: usize,
    limit: usize,
) -> GitResult<Vec<agents::sessions::SessionSummary>> {
    blocking(move || agents::sessions::list_sessions_page(&repo(&repo_path)?, offset, limit)).await
}

#[tauri::command]
pub async fn get_agent_session(
    repo_path: String,
    id: String,
) -> GitResult<Vec<agents::steps::AgentStep>> {
    blocking(move || agents::sessions::session_steps(&repo(&repo_path)?, &id)).await
}

#[tauri::command]
pub async fn get_session_usage(
    repo_path: String,
    id: String,
) -> GitResult<agents::usage::SessionUsage> {
    blocking(move || agents::usage::session_usage(&repo(&repo_path)?, &id)).await
}

#[tauri::command]
pub async fn list_agent_definitions(
    repo_path: String,
) -> GitResult<Vec<agents::definitions::AgentDefinition>> {
    blocking(move || agents::definitions::list(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn save_agent_definition(
    repo_path: String,
    definition: agents::definitions::AgentDefinition,
    previous: Option<String>,
) -> GitResult<()> {
    blocking(move || {
        agents::definitions::save(&repo(&repo_path)?, &definition, previous.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn delete_agent_definition(
    repo_path: String,
    scope: agents::definitions::Scope,
    name: String,
) -> GitResult<()> {
    blocking(move || agents::definitions::delete(&repo(&repo_path)?, scope, &name)).await
}

#[tauri::command]
pub async fn code_graph_status(repo_path: String) -> GitResult<code_graph::GraphStatus> {
    blocking(move || code_graph::status(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn code_graph_hotspots(repo_path: String) -> GitResult<Vec<serde_json::Value>> {
    blocking(move || code_graph::hotspots(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn code_graph_map(repo_path: String) -> GitResult<code_graph::FileMap> {
    blocking(move || code_graph::file_map(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn code_graph_impact(repo_path: String, base: String) -> GitResult<serde_json::Value> {
    blocking(move || code_graph::impact(&repo(&repo_path)?, &base)).await
}

#[tauri::command]
pub async fn code_graph_update(repo_path: String) -> GitResult<()> {
    blocking(move || code_graph::update(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn get_usage_stats() -> GitResult<agents::usage::UsageStats> {
    blocking(agents::usage::usage_stats).await
}

#[tauri::command]
pub async fn list_preview_targets(repo_path: String) -> GitResult<Vec<preview::PreviewTarget>> {
    blocking(move || Ok(preview::detect(&repo(&repo_path)?))).await
}

#[tauri::command]
pub async fn start_preview(app: tauri::AppHandle, repo_path: String, id: String) -> GitResult<()> {
    blocking(move || preview::start(app, &repo(&repo_path)?, &id)).await
}

#[tauri::command]
pub fn preview_view_show(
    app: tauri::AppHandle,
    url: String,
    bounds: preview_view::Bounds,
) -> GitResult<()> {
    preview_view::show(&app, &url, bounds)
}

#[tauri::command]
pub fn preview_view_hide(app: tauri::AppHandle) {
    preview_view::hide(&app);
}

#[tauri::command]
pub fn preview_view_reload(app: tauri::AppHandle) {
    preview_view::reload(&app);
}

#[tauri::command]
pub fn browser_show(
    app: tauri::AppHandle,
    tab: String,
    url: String,
    bounds: preview_view::Bounds,
) -> GitResult<()> {
    browser::show(&app, &tab, &url, bounds)
}

#[tauri::command]
pub fn browser_hide(app: tauri::AppHandle) {
    browser::hide_except(&app, None);
}

#[tauri::command]
pub fn browser_close(app: tauri::AppHandle, tab: String) {
    browser::close(&app, &tab);
}

#[tauri::command]
pub fn browser_navigate(app: tauri::AppHandle, tab: String, url: String) -> GitResult<()> {
    browser::navigate(&app, &tab, &url)
}

#[tauri::command]
pub fn browser_command(app: tauri::AppHandle, tab: String, action: String) -> GitResult<()> {
    browser::command(&app, &tab, &action)
}

#[tauri::command]
pub fn browser_url(app: tauri::AppHandle, tab: String) -> Option<String> {
    browser::current_url(&app, &tab)
}

#[tauri::command]
pub fn browser_inspect(app: tauri::AppHandle, tab: String) {
    browser::inspect(&app, &tab);
}

#[tauri::command]
pub fn preview_view_go(app: tauri::AppHandle, forward: bool) {
    preview_view::go(&app, forward);
}

#[tauri::command]
pub fn preview_view_navigate(app: tauri::AppHandle, url: String) -> GitResult<()> {
    preview_view::navigate(&app, &url)
}

#[tauri::command]
pub fn preview_view_inspect(app: tauri::AppHandle) {
    preview_view::inspect(&app);
}

#[tauri::command]
pub async fn linear_add_account(api_key: String) -> GitResult<linear::Account> {
    blocking(move || linear::add_account(&api_key)).await
}

#[tauri::command]
pub fn linear_accounts() -> Vec<linear::Account> {
    linear::accounts()
}

#[tauri::command]
pub async fn linear_remove_account(org_id: String) -> GitResult<()> {
    blocking(move || linear::remove_account(&org_id)).await
}

#[tauri::command]
pub async fn linear_projects(org_id: String) -> GitResult<serde_json::Value> {
    blocking(move || linear::projects(&org_id)).await
}

#[tauri::command]
pub async fn linear_active_cycles(org_id: String) -> GitResult<serde_json::Value> {
    blocking(move || linear::active_cycles(&org_id)).await
}

#[tauri::command]
pub async fn linear_project_issues(
    org_id: String,
    project_id: String,
) -> GitResult<serde_json::Value> {
    blocking(move || linear::project_issues(&org_id, &project_id)).await
}

#[tauri::command]
pub async fn linear_my_issues(org_id: String) -> GitResult<serde_json::Value> {
    blocking(move || linear::my_issues(&org_id)).await
}

#[tauri::command]
pub async fn linear_issue(org_id: String, id: String) -> GitResult<serde_json::Value> {
    blocking(move || linear::issue(&org_id, &id)).await
}

#[tauri::command]
pub async fn linear_organizations(org_id: String) -> GitResult<serde_json::Value> {
    blocking(move || linear::organizations(&org_id)).await
}

#[tauri::command]
pub async fn linear_image(org_id: String, url: String) -> GitResult<String> {
    blocking(move || linear::image(&org_id, &url)).await
}

#[tauri::command]
pub async fn linear_create_issue(
    org_id: String,
    issue: linear::NewIssue,
) -> GitResult<serde_json::Value> {
    blocking(move || linear::create_issue(&org_id, &issue)).await
}

#[tauri::command]
pub async fn linear_team_states(org_id: String) -> GitResult<serde_json::Value> {
    blocking(move || linear::team_states(&org_id)).await
}

#[tauri::command]
pub async fn linear_set_issue_state(
    org_id: String,
    issue_id: String,
    state_id: String,
) -> GitResult<()> {
    blocking(move || linear::set_issue_state(&org_id, &issue_id, &state_id)).await
}

#[tauri::command]
pub fn preview_view_url(app: tauri::AppHandle) -> Option<String> {
    preview_view::current_url(&app)
}

#[tauri::command]
pub fn preview_view_close(app: tauri::AppHandle) {
    preview_view::close(&app);
}

#[tauri::command]
pub fn send_preview_input(id: String, text: String) -> GitResult<()> {
    preview::send_input(&id, &text)
}

#[tauri::command]
pub fn stop_preview(id: String) {
    preview::stop(&id);
}

#[tauri::command]
pub async fn get_github_web_url(repo_path: String) -> GitResult<Option<String>> {
    blocking(move || github::web_url(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn github_status() -> GitResult<crate::github_status::GithubStatus> {
    blocking(crate::github_status::status).await
}

#[tauri::command]
pub async fn open_github_url(url: String) -> GitResult<()> {
    blocking(move || github::open_in_browser(&url)).await
}

#[tauri::command]
pub async fn watch_repository(app: tauri::AppHandle, repo_path: String) -> GitResult<()> {
    blocking(move || watcher::watch(app, &repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn terminal_open(
    app: tauri::AppHandle,
    repo_path: String,
    cols: u16,
    rows: u16,
) -> GitResult<String> {
    blocking(move || terminal::open(app, &repo(&repo_path)?, cols, rows)).await
}

#[tauri::command]
pub fn terminal_write(id: String, data: String) -> GitResult<()> {
    terminal::write(&id, &data)
}

#[tauri::command]
pub fn terminal_resize(id: String, cols: u16, rows: u16) -> GitResult<()> {
    terminal::resize(&id, cols, rows)
}

#[tauri::command]
pub fn terminal_close(id: String) {
    terminal::close(&id);
}

#[tauri::command]
pub async fn get_image(
    repo_path: String,
    hash: String,
    base: Option<String>,
    path: String,
    old_side: bool,
) -> GitResult<Option<String>> {
    blocking(move || {
        read::image_data_url(&repo(&repo_path)?, &hash, base.as_deref(), &path, old_side)
    })
    .await
}

#[tauri::command]
pub async fn save_image(
    repo_path: String,
    hash: String,
    base: Option<String>,
    path: String,
    old_side: bool,
    dest: String,
) -> GitResult<()> {
    blocking(move || {
        read::save_image(
            &repo(&repo_path)?,
            &hash,
            base.as_deref(),
            &path,
            old_side,
            std::path::Path::new(&dest),
        )
    })
    .await
}

#[tauri::command]
pub async fn get_file_contents(repo_path: String, hash: String, path: String) -> GitResult<String> {
    blocking(move || read::file_contents(&repo(&repo_path)?, &hash, &path)).await
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
pub async fn apply_hunks(
    repo_path: String,
    path: String,
    hunks: String,
    mode: crate::git::staging::PatchMode,
) -> GitResult<()> {
    blocking(move || crate::git::staging::apply_hunks(&repo(&repo_path)?, &path, &hunks, mode))
        .await
}

#[tauri::command]
pub async fn commit_groups(
    repo_path: String,
    groups: Vec<crate::git::staging::CommitGroup>,
) -> GitResult<Vec<String>> {
    blocking(move || crate::git::staging::commit_groups(&repo(&repo_path)?, &groups)).await
}

#[tauri::command]
pub async fn create_commit(repo_path: String, message: String) -> GitResult<String> {
    blocking(move || write::commit(&repo(&repo_path)?, &message)).await
}

#[tauri::command]
pub async fn checkout_remote_branch(repo_path: String, remote_ref: String) -> GitResult<String> {
    blocking(move || write::checkout_remote_branch(&repo(&repo_path)?, &remote_ref)).await
}

#[tauri::command]
pub async fn switch_branch(repo_path: String, name: String) -> GitResult<()> {
    blocking(move || write::switch_branch(&repo(&repo_path)?, &name)).await
}

#[tauri::command]
pub async fn delete_branch(
    repo_path: String,
    name: String,
    merged_head: Option<String>,
    force: bool,
) -> GitResult<String> {
    blocking(move || {
        let repo = repo(&repo_path)?;
        let tip = write::delete_branch(&repo, &name, merged_head.as_deref(), force)?;
        // Best effort: failing to remember it for ⌘Z mustn't turn a done deletion into an error.
        let _ = crate::git::undo::record_deleted_branch(&repo, &name, &tip);
        Ok(tip)
    })
    .await
}

#[tauri::command]
pub async fn delete_remote_branch(
    repo_path: String,
    remote: String,
    name: String,
) -> GitResult<String> {
    blocking(move || write::delete_remote_branch(&repo(&repo_path)?, &remote, &name)).await
}

#[tauri::command]
pub async fn restore_remote_branch(
    repo_path: String,
    remote: String,
    name: String,
    tip: String,
) -> GitResult<()> {
    blocking(move || write::restore_remote_branch(&repo(&repo_path)?, &remote, &name, &tip)).await
}

#[tauri::command]
pub async fn restore_branch(repo_path: String, name: String, tip: String) -> GitResult<()> {
    blocking(move || {
        let repo = repo(&repo_path)?;
        write::restore_branch(&repo, &name, &tip)?;
        let _ = crate::git::undo::forget_deleted_branch(&repo, &name);
        Ok(())
    })
    .await
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

/// Saves an image pasted into an agent conversation; returns the path to send with the message.
#[tauri::command]
pub async fn save_attachment(data: String, extension: String) -> GitResult<String> {
    blocking(move || crate::attachments::save(&data, &extension)).await
}

/// Posts the AI review the user kept and confirmed: one COMMENT review with its line comments.
#[tauri::command]
pub async fn submit_ai_review(
    repo_path: String,
    number: u32,
    commit: String,
    body: String,
    comments: Vec<github::DraftComment>,
) -> GitResult<()> {
    blocking(move || {
        github::submit_review_with_comments(&repo(&repo_path)?, number, &commit, &body, &comments)
    })
    .await
}

#[tauri::command]
pub async fn list_submodules(
    repo_path: String,
) -> GitResult<Vec<crate::git::submodules::Submodule>> {
    blocking(move || crate::git::submodules::list(&repo(&repo_path)?)).await
}

/// Explicit click only: may clone from the network.
#[tauri::command]
pub async fn update_submodules(repo_path: String, path: Option<String>) -> GitResult<()> {
    blocking(move || crate::git::submodules::init_update(&repo(&repo_path)?, path.as_deref())).await
}

/// `None` when git-lfs isn't installed.
#[tauri::command]
pub async fn lfs_status(repo_path: String) -> GitResult<Option<crate::git::lfs::LfsStatus>> {
    blocking(move || Ok(crate::git::lfs::status(&repo(&repo_path)?))).await
}

#[tauri::command]
pub async fn lfs_tracked_paths(repo_path: String, paths: Vec<String>) -> GitResult<Vec<String>> {
    blocking(move || crate::git::lfs::tracked_paths(&repo(&repo_path)?, &paths)).await
}

/// Explicit click only: downloads LFS objects.
#[tauri::command]
pub async fn lfs_pull(repo_path: String) -> GitResult<()> {
    blocking(move || crate::git::lfs::pull(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn lfs_track(repo_path: String, pattern: String) -> GitResult<()> {
    blocking(move || crate::git::lfs::track(&repo(&repo_path)?, &pattern)).await
}

#[tauri::command]
pub async fn list_stashes(repo_path: String) -> GitResult<Vec<crate::git::stash::StashEntry>> {
    blocking(move || crate::git::stash::list(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn create_stash(
    repo_path: String,
    message: String,
    include_untracked: bool,
) -> GitResult<()> {
    blocking(move || crate::git::stash::push(&repo(&repo_path)?, &message, include_untracked)).await
}

#[tauri::command]
pub async fn apply_stash(
    repo_path: String,
    index: u32,
    hash: String,
    pop: bool,
) -> GitResult<crate::git::stash::StashOutcome> {
    blocking(move || crate::git::stash::apply(&repo(&repo_path)?, index, &hash, pop)).await
}

#[tauri::command]
pub async fn drop_stash(repo_path: String, index: u32, hash: String) -> GitResult<()> {
    blocking(move || crate::git::stash::drop(&repo(&repo_path)?, index, &hash)).await
}

#[tauri::command]
pub async fn branch_from_stash(
    repo_path: String,
    index: u32,
    hash: String,
    name: String,
) -> GitResult<()> {
    blocking(move || crate::git::stash::branch(&repo(&repo_path)?, index, &hash, &name)).await
}

#[tauri::command]
pub async fn last_undo(repo_path: String) -> GitResult<Option<crate::git::undo::UndoAction>> {
    blocking(move || crate::git::undo::last(&repo(&repo_path)?)).await
}

#[tauri::command]
pub async fn undo_last(repo_path: String, action: crate::git::undo::UndoAction) -> GitResult<()> {
    blocking(move || crate::git::undo::undo(&repo(&repo_path)?, &action)).await
}
