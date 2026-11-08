mod commands;
mod git;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
