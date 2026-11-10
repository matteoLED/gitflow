mod agents;
mod attachments;
mod browser;
mod code_graph;
mod commands;
mod git;
mod github_status;
mod linear;
mod lsp;
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
            commands::list_files,
            commands::read_file,
            commands::write_file,
            commands::line_changes,
            commands::search_files,
            commands::lsp_start,
            commands::lsp_send,
            commands::lsp_stop,
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
            commands::save_image,
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
            commands::list_agent_sessions_page,
            commands::get_agent_session,
            commands::get_session_usage,
            commands::get_usage_stats,
            commands::list_agent_definitions,
            commands::save_agent_definition,
            commands::delete_agent_definition,
            commands::code_graph_status,
            commands::code_graph_hotspots,
            commands::code_graph_map,
            commands::code_graph_impact,
            commands::code_graph_update,
            commands::list_preview_targets,
            commands::start_preview,
            commands::stop_preview,
            commands::send_preview_input,
            commands::preview_view_show,
            commands::preview_view_hide,
            commands::preview_view_reload,
            commands::preview_view_go,
            commands::browser_show,
            commands::browser_hide,
            commands::browser_close,
            commands::browser_navigate,
            commands::browser_command,
            commands::browser_inspect,
            commands::browser_url,
            commands::preview_view_navigate,
            commands::preview_view_inspect,
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
            commands::linear_create_issue,
            commands::linear_projects,
            commands::linear_project_issues,
            commands::linear_active_cycles,
            commands::github_status,
            commands::delete_branch,
            commands::restore_branch,
            commands::delete_remote_branch,
            commands::restore_remote_branch,
            commands::linear_set_issue_state,
            commands::get_pull_request_details,
            commands::merge_pull_request,
            commands::comment_pull_request,
            commands::compare_with_base,
            commands::create_pull_request,
            commands::rerun_failed_checks,
            commands::add_reviewer,
            commands::list_review_threads,
            commands::resolve_review_thread,
            commands::react_to_comment,
            commands::edit_review_comment,
            commands::delete_review_comment,
            commands::comment_line,
            commands::reply_review_comment,
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
            commands::checkout_remote_branch,
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
