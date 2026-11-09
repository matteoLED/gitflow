mod agents;
mod attachments;
mod commands;
mod git;
mod linear;
mod preview;
mod preview_view;
mod terminal;
mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Clean up dev servers a previous session couldn't stop (crash, forced quit, dev rebuild).
            if let Ok(dir) = tauri::Manager::path(app).app_data_dir() {
                preview::init_ledger(dir.join("preview-processes.json"));
                attachments::init(dir.join("attachments"));
                linear::init(dir.join("linear-accounts.json"));
                std::thread::spawn(preview::stop_orphans);
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_repository,
            commands::list_refs,
            commands::list_commits,
            commands::list_commit_files,
            commands::get_commit_diff,
            commands::get_working_tree,
            commands::get_working_diff,
            commands::get_avatar_url,
            commands::list_pull_requests,
            commands::fetch_pull_request,
            commands::submit_review,
            commands::get_github_web_url,
            commands::open_github_url,
            commands::get_file_contents,
            commands::get_image,
            commands::watch_repository,
            commands::terminal_open,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
            commands::list_workflow_runs,
            commands::get_workflow_run,
            commands::detect_agents,
            commands::start_agent_run,
            commands::cancel_agent_run,
            commands::list_agent_sessions,
            commands::get_agent_session,
            commands::list_preview_targets,
            commands::start_preview,
            commands::stop_preview,
            commands::send_preview_input,
            commands::preview_view_show,
            commands::preview_view_hide,
            commands::preview_view_reload,
            commands::preview_view_close,
            commands::preview_view_url,
            commands::linear_add_account,
            commands::linear_accounts,
            commands::linear_remove_account,
            commands::linear_my_issues,
            commands::linear_issue,
            commands::linear_organizations,
            commands::linear_image,
            commands::linear_team_states,
            commands::linear_set_issue_state,
            commands::get_pull_request_details,
            commands::merge_pull_request,
            commands::comment_pull_request,
            commands::rerun_failed_checks,
            commands::add_reviewer,
            commands::set_pull_request_state,
            commands::get_job_log,
            commands::save_attachment,
            commands::get_github_user,
            commands::get_git_identity,
            commands::set_git_identity,
            commands::stage_files,
            commands::unstage_files,
            commands::create_commit,
            commands::switch_branch,
            commands::create_branch,
            commands::fetch,
            commands::pull,
            commands::push,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, event| {
            // Dev servers started for previews never outlive the app.
            if let tauri::RunEvent::Exit = event {
                preview::stop_all();
                terminal::close_all();
            }
        });
}
