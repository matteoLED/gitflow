// Typed client for the Rust Git commands. The UI never builds command lines: it only calls these.
import { invoke } from "@tauri-apps/api/core";
import type {
  BlameHunk,
  FileCommit,
  CommitPullRequest,
  ChangedFile,
  CommitSummary,
  FileDiff,
  RefsSnapshot,
  GitIdentity,
  GithubUser,
  PullRequest,
  EditorFile,
  LineChange,
  Operation,
  RebaseCommit,
  RebaseStep,
  RewriteOutcome,
  Worktree,
  WorktreeStatus,
  Reaction,
  SearchResults,
  MatchOptions,
  ReplaceRequest,
  ReplaceOutcome,
  SlashCommand,
  ReviewThread,
  RepositoryInfo,
  WorkingSide,
  WorkingTreeEntry,
  PullRequestRange,
  ReviewEvent,
  WorkflowRun,
  AgentInfo,
  AgentKind,
  AgentTask,
  AgentSession,
  SessionUsage,
  AgentDefinition,
  AgentScope,
  CodeGraphStatus,
  CodeHotspot,
  CodeFileMap,
  CodeImpact,
  UsageStats,
  AgentStep,
  RunSettings,
  LinearAccount,
  LinearIssue,
  LinearIssueDetail,
  LinearOrganization,
  LinearTeamStates,
  LinearProject,
  LinearCycle,
  GithubStatus,
  CreatedLinearIssue,
  NewLinearIssue,
  MergeMethod,
  PullRequestDetails,
  PreviewTarget,
} from "@/types/git";

export const gitBackend = {
  openRepository: (path: string) => invoke<RepositoryInfo>("open_repository", { path }),
  listRefs: (repoPath: string) => invoke<RefsSnapshot>("list_refs", { repoPath }),
  listCommits: (
    repoPath: string,
    options: { rev: string | null; skip: number; limit: number; filters: { firstParent: boolean; noMerges: boolean } },
  ) => invoke<CommitSummary[]>("list_commits", { repoPath, ...options }),
  /** Files of a commit against its first parent, or against `base` (a pull request's merge-base). */
  listCommitFiles: (repoPath: string, hash: string, base: string | null = null) =>
    invoke<ChangedFile[]>("list_commit_files", { repoPath, hash, base }),
  getCommitDiff: (
    repoPath: string,
    hash: string,
    path: string,
    previousPath: string | null,
    base: string | null = null,
  ) => invoke<FileDiff>("get_commit_diff", { repoPath, hash, path, previousPath, base }),
  getWorkingTree: (repoPath: string) => invoke<WorkingTreeEntry[]>("get_working_tree", { repoPath }),
  getWorkingDiff: (repoPath: string, path: string, previousPath: string | null, side: WorkingSide) =>
    invoke<FileDiff>("get_working_diff", { repoPath, path, previousPath, side }),
  /** GitHub avatar of a commit's author via the user's `gh` login; null when unavailable. */
  getAvatarUrl: (repoPath: string, hash: string, email: string) =>
    invoke<string | null>("get_avatar_url", { repoPath, hash, email }),
  listPullRequests: (repoPath: string) => invoke<PullRequest[]>("list_pull_requests", { repoPath }),
  /** Fetches the PR head into FETCH_HEAD (no branch created); returns its commit range and merge-base. */
  fetchPullRequest: (repoPath: string, pr: PullRequest) =>
    invoke<PullRequestRange>("fetch_pull_request", {
      repoPath,
      number: pr.number,
      base: pr.baseRefName,
      headOid: pr.headRefOid,
    }),
  /** Through `gh pr review`, with the user's own GitHub login. */
  submitReview: (repoPath: string, number: number, event: ReviewEvent, body: string) =>
    invoke<null>("submit_review", { repoPath, number, event, body }),
  getPullRequestDetails: (repoPath: string, number: number) =>
    invoke<PullRequestDetails>("get_pull_request_details", { repoPath, number }),
  setPullRequestState: (repoPath: string, number: number, state: "draft" | "open" | "closed") =>
    invoke<null>("set_pull_request_state", { repoPath, number, state }),
  /** A job's log through `gh run view --job`; only the failed steps when `failedOnly`. */
  getJobLog: (repoPath: string, jobId: number, failedOnly: boolean) =>
    invoke<string>("get_job_log", { repoPath, jobId, failedOnly }),
  rerunFailedChecks: (repoPath: string, runIds: number[]) => invoke<null>("rerun_failed_checks", { repoPath, runIds }),
  addReviewer: (repoPath: string, number: number, login: string) =>
    invoke<null>("add_reviewer", { repoPath, number, login }),
  /** Commits on HEAD past `base` (default: the remote's default branch); null without a base. */
  compareWithBase: (repoPath: string, base: string | null) =>
    invoke<{ base: string; ahead: number } | null>("compare_with_base", { repoPath, base }),
  /** `gh pr create` from the checked-out branch; returns the new PR's URL. */
  createPullRequest: (repoPath: string, base: string, title: string, body: string, draft: boolean) =>
    invoke<string>("create_pull_request", { repoPath, base, title, body, draft }),
  commentPullRequest: (repoPath: string, number: number, body: string) =>
    invoke<null>("comment_pull_request", { repoPath, number, body }),
  /** `gh pr merge` with the user's login; never deletes or switches branches. */
  mergePullRequest: (repoPath: string, number: number, method: MergeMethod) =>
    invoke<null>("merge_pull_request", { repoPath, number, method }),
  getGithubWebUrl: (repoPath: string) => invoke<string | null>("get_github_web_url", { repoPath }),
  /** Opens a github.com page in the default browser (other URLs are refused by the backend). */
  openGithubUrl: (url: string) => invoke<null>("open_github_url", { url }),
  githubStatus: () => invoke<GithubStatus>("github_status"),
  getFileContents: (repoPath: string, hash: string, path: string) =>
    invoke<string>("get_file_contents", { repoPath, hash, path }),
  listWorkflowRuns: (repoPath: string) => invoke<WorkflowRun[]>("list_workflow_runs", { repoPath }),
  getWorkflowRun: (repoPath: string, id: number) => invoke<WorkflowRun>("get_workflow_run", { repoPath, id }),
  detectAgents: () => invoke<AgentInfo[]>("detect_agents"),
  /** Starts a read-only agent run; its steps arrive as `agent-run` events. Returns the run id. */
  /** `resume` continues an earlier conversation (the agent's own session id). */
  startAgentRun: (
    repoPath: string,
    agent: AgentKind,
    task: AgentTask,
    locale: string,
    resume: string | null = null,
    settings: RunSettings | null = null,
  ) => invoke<string>("start_agent_run", { repoPath, agent, task, locale, resume, settings }),
  /** Saves a pasted image (base64) for an agent; returns its path. */
  saveAttachment: (data: string, extension: string) => invoke<string>("save_attachment", { data, extension }),
  cancelAgentRun: (runId: string) => invoke<null>("cancel_agent_run", { runId }),
  listAgentSessions: (repoPath: string) => invoke<AgentSession[]>("list_agent_sessions", { repoPath }),
  /** One page of past Claude Code sessions, latest first; a short page is the last one. */
  listAgentSessionsPage: (repoPath: string, offset: number, limit: number) =>
    invoke<AgentSession[]>("list_agent_sessions_page", { repoPath, offset, limit }),
  getAgentSession: (repoPath: string, id: string) => invoke<AgentStep[]>("get_agent_session", { repoPath, id }),
  getSessionUsage: (repoPath: string, id: string) => invoke<SessionUsage>("get_session_usage", { repoPath, id }),
  listAgentDefinitions: (repoPath: string) => invoke<AgentDefinition[]>("list_agent_definitions", { repoPath }),
  /** Writes the agent's file; `previous` is its old name when renamed. */
  saveAgentDefinition: (repoPath: string, definition: AgentDefinition, previous: string | null) =>
    invoke<null>("save_agent_definition", { repoPath, definition, previous }),
  deleteAgentDefinition: (repoPath: string, scope: AgentScope, name: string) =>
    invoke<null>("delete_agent_definition", { repoPath, scope, name }),
  codeGraphStatus: (repoPath: string) => invoke<CodeGraphStatus>("code_graph_status", { repoPath }),
  codeGraphHotspots: (repoPath: string) => invoke<CodeHotspot[]>("code_graph_hotspots", { repoPath }),
  codeGraphMap: (repoPath: string) => invoke<CodeFileMap>("code_graph_map", { repoPath }),
  codeGraphImpact: (repoPath: string, base: string) => invoke<CodeImpact>("code_graph_impact", { repoPath, base }),
  codeGraphUpdate: (repoPath: string) => invoke<null>("code_graph_update", { repoPath }),
  /** Every Claude Code session on this machine, by day, project and model. */
  getUsageStats: () => invoke<UsageStats>("get_usage_stats"),
  listPreviewTargets: (repoPath: string) => invoke<PreviewTarget[]>("list_preview_targets", { repoPath }),
  /** Runs a detected app's dev server; its URL and logs arrive as `preview` events. */
  startPreview: (repoPath: string, id: string) => invoke<null>("start_preview", { repoPath, id }),
  stopPreview: (id: string) => invoke<null>("stop_preview", { id }),
  /** Native preview webview (first-party cookies, unlike an iframe), placed in window coordinates. */
  previewViewShow: (
    url: string,
    bounds: { x: number; y: number; width: number; height: number; zoom: number; radius: number },
  ) => invoke<null>("preview_view_show", { url, bounds }),
  previewViewHide: () => invoke<null>("preview_view_hide"),
  previewViewReload: () => invoke<null>("preview_view_reload"),
  /** Shows browser tab `tab` (created on `url` the first time) at `bounds`; other tabs are hidden. */
  browserShow: (
    tab: string,
    url: string,
    bounds: { x: number; y: number; width: number; height: number; zoom: number; radius: number },
  ) => invoke<null>("browser_show", { tab, url, bounds }),
  browserHide: () => invoke<null>("browser_hide"),
  browserClose: (tab: string) => invoke<null>("browser_close", { tab }),
  browserNavigate: (tab: string, url: string) => invoke<null>("browser_navigate", { tab, url }),
  browserCommand: (tab: string, action: "back" | "forward" | "reload") =>
    invoke<null>("browser_command", { tab, action }),
  /** The tab's address right now, route included. */
  browserUrl: (tab: string) => invoke<string | null>("browser_url", { tab }),
  browserInspect: (tab: string) => invoke<null>("browser_inspect", { tab }),
  previewViewGo: (forward: boolean) => invoke<null>("preview_view_go", { forward }),
  /** Another page of the local app; anything not on localhost is refused. */
  previewViewNavigate: (url: string) => invoke<null>("preview_view_navigate", { url }),
  previewViewInspect: () => invoke<null>("preview_view_inspect"),
  previewViewClose: () => invoke<null>("preview_view_close"),
  /** Current address inside the preview, route included; null when none is shown. */
  previewViewUrl: () => invoke<string | null>("preview_view_url"),
  /** Answers an interactive script (menu choice, confirmation) on its standard input. */
  sendPreviewInput: (id: string, text: string) => invoke<null>("send_preview_input", { id, text }),
  /** One side of an image diff as a data: URL; null when that side doesn't exist (added/deleted). */
  getImage: (repoPath: string, hash: string, base: string | null, path: string, oldSide: boolean) =>
    invoke<string | null>("get_image", { repoPath, hash, base, path, oldSide }),
  listReviewThreads: (repoPath: string, number: number) =>
    invoke<ReviewThread[]>("list_review_threads", { repoPath, number }),
  resolveReviewThread: (repoPath: string, threadId: string, resolved: boolean) =>
    invoke<null>("resolve_review_thread", { repoPath, threadId, resolved }),
  reactToComment: (repoPath: string, subjectId: string, content: Reaction, add: boolean) =>
    invoke<null>("react_to_comment", { repoPath, subjectId, content, add }),
  editReviewComment: (repoPath: string, commentId: number, body: string) =>
    invoke<null>("edit_review_comment", { repoPath, commentId, body }),
  deleteReviewComment: (repoPath: string, commentId: number) =>
    invoke<null>("delete_review_comment", { repoPath, commentId }),
  commentLine: (
    repoPath: string,
    number: number,
    commit: string,
    path: string,
    line: number,
    side: "LEFT" | "RIGHT",
    body: string,
  ) => invoke<null>("comment_line", { repoPath, number, commit, path, line, side, body }),
  replyReviewComment: (repoPath: string, number: number, commentId: number, body: string) =>
    invoke<null>("reply_review_comment", { repoPath, number, commentId, body }),
  /** Every file of the working tree, `.gitignore` respected. */
  /** The merge, rebase, cherry-pick or revert in progress, if any. */
  getOperation: (repoPath: string) => invoke<Operation | null>("get_operation", { repoPath }),
  continueOperation: (repoPath: string) => invoke<null>("continue_operation", { repoPath }),
  abortOperation: (repoPath: string) => invoke<null>("abort_operation", { repoPath }),
  cherryPickCommit: (repoPath: string, hash: string) =>
    invoke<RewriteOutcome>("cherry_pick_commit", { repoPath, hash }),
  revertCommit: (repoPath: string, hash: string) => invoke<RewriteOutcome>("revert_commit", { repoPath, hash }),
  rebasePlan: (repoPath: string, from: string) => invoke<RebaseCommit[]>("rebase_plan", { repoPath, from }),
  /** Refuses with `alreadyPushed` unless `confirmed` when the rewritten commits are on a remote. */
  interactiveRebase: (repoPath: string, from: string, steps: RebaseStep[], confirmed: boolean) =>
    invoke<RewriteOutcome>("interactive_rebase", { repoPath, from, steps, confirmed }),
  skipRebaseCommit: (repoPath: string) => invoke<null>("skip_rebase_commit", { repoPath }),
  /** Resolves whole files with one side, then marks them resolved. */
  resolveWithSide: (repoPath: string, paths: string[], theirs: boolean) =>
    invoke<null>("resolve_with_side", { repoPath, paths, theirs }),
  createAgentWorktree: (repoPath: string) => invoke<Worktree>("create_agent_worktree", { repoPath }),
  agentWorktreeStatus: (repoPath: string, path: string) =>
    invoke<WorktreeStatus>("agent_worktree_status", { repoPath, path }),
  /** Commits what the agent left, then merges its branch into the current one. */
  mergeAgentWorktree: (repoPath: string, path: string, message: string) =>
    invoke<null>("merge_agent_worktree", { repoPath, path, message }),
  /** Commits what's left, pushes the agent's branch and opens a PR into the current branch; resolves with its URL. */
  publishAgentWorktree: (repoPath: string, path: string, title: string, body: string) =>
    invoke<string>("publish_agent_worktree", { repoPath, path, title, body }),
  removeAgentWorktree: (repoPath: string, path: string, deleteBranch: boolean) =>
    invoke<null>("remove_agent_worktree", { repoPath, path, deleteBranch }),
  /** Claude Code's custom commands and skills, project then user. */
  listSlashCommands: (repoPath: string) => invoke<SlashCommand[]>("list_slash_commands", { repoPath }),
  listFiles: (repoPath: string) => invoke<string[]>("list_files", { repoPath }),
  readFile: (repoPath: string, path: string) => invoke<EditorFile>("read_file", { repoPath, path }),
  /** Saves atomically; refuses (changedOnDisk) when the file changed since `expectedMtime`. Returns the new mtime. */
  writeFile: (repoPath: string, path: string, content: string, expectedMtime: number | null) =>
    invoke<number>("write_file", { repoPath, path, content, expectedMtime }),
  /** Lines matching `query` across the working tree (git grep). */
  searchFiles: (repoPath: string, query: string, options: MatchOptions) =>
    invoke<SearchResults>("search_files", { repoPath, query, options }),
  /** Replaces with the search's semantics; files in `skip` (unsaved in the editor) are left alone. */
  replaceInFiles: (repoPath: string, request: ReplaceRequest) =>
    invoke<ReplaceOutcome>("replace_in_files", { repoPath, request }),
  createFile: (repoPath: string, path: string) => invoke<null>("create_file", { repoPath, path }),
  createDir: (repoPath: string, path: string) => invoke<null>("create_dir", { repoPath, path }),
  renamePath: (repoPath: string, from: string, to: string) => invoke<null>("rename_path", { repoPath, from, to }),
  /** Returns the copy's path ("name copy.ext"). */
  duplicateFile: (repoPath: string, path: string) => invoke<string>("duplicate_file", { repoPath, path }),
  /** Moves to the macOS Trash. */
  deletePath: (repoPath: string, path: string) => invoke<null>("delete_path", { repoPath, path }),
  revealPath: (repoPath: string, path: string) => invoke<null>("reveal_path", { repoPath, path }),
  lineChanges: (repoPath: string, path: string) => invoke<LineChange[]>("line_changes", { repoPath, path }),
  blameFile: (repoPath: string, path: string) => invoke<BlameHunk[]>("blame_file", { repoPath, path }),
  /** Commits touching the file, newest first, following renames. */
  fileHistory: (repoPath: string, path: string) => invoke<FileCommit[]>("file_history", { repoPath, path }),
  /** The pull request that introduced a commit, via gh; null when there's none. */
  commitPullRequest: (repoPath: string, sha: string) =>
    invoke<CommitPullRequest | null>("commit_pull_request", { repoPath, sha }),
  /** Writes that image to `dest`, a path picked in the save dialog. */
  saveImage: (repoPath: string, hash: string, base: string | null, path: string, oldSide: boolean, dest: string) =>
    invoke<null>("save_image", { repoPath, hash, base, path, oldSide, dest }),
  /** Watches the repository; changes arrive as `repo-changed` events. */
  watchRepository: (repoPath: string) => invoke<null>("watch_repository", { repoPath }),
  terminalOpen: (repoPath: string, cols: number, rows: number) =>
    invoke<string>("terminal_open", { repoPath, cols, rows }),
  terminalWrite: (id: string, data: string) => invoke<null>("terminal_write", { id, data }),
  terminalResize: (id: string, cols: number, rows: number) => invoke<null>("terminal_resize", { id, cols, rows }),
  terminalClose: (id: string) => invoke<null>("terminal_close", { id }),
  /** Checks a personal API key with Linear and keeps it in the macOS Keychain. */
  linearAddAccount: (apiKey: string) => invoke<LinearAccount>("linear_add_account", { apiKey }),
  linearAccounts: () => invoke<LinearAccount[]>("linear_accounts"),
  linearRemoveAccount: (orgId: string) => invoke<null>("linear_remove_account", { orgId }),
  linearMyIssues: (orgId: string) => invoke<LinearIssue[]>("linear_my_issues", { orgId }),
  linearIssue: (orgId: string, id: string) => invoke<LinearIssueDetail>("linear_issue", { orgId, id }),
  /** Every workspace of the user; may fail when Linear refuses it to API keys. */
  linearOrganizations: (orgId: string) => invoke<LinearOrganization[]>("linear_organizations", { orgId }),
  /** A Linear upload (needs the key) as a data: URL. */
  linearTeamStates: (orgId: string) => invoke<LinearTeamStates[]>("linear_team_states", { orgId }),
  linearSetIssueState: (orgId: string, issueId: string, stateId: string) =>
    invoke<null>("linear_set_issue_state", { orgId, issueId, stateId }),
  linearCreateIssue: (orgId: string, issue: NewLinearIssue) =>
    invoke<CreatedLinearIssue>("linear_create_issue", { orgId, issue }),
  linearProjects: (orgId: string) => invoke<LinearProject[]>("linear_projects", { orgId }),
  linearActiveCycles: (orgId: string) => invoke<LinearCycle[]>("linear_active_cycles", { orgId }),
  linearProjectIssues: (orgId: string, projectId: string) =>
    invoke<LinearIssue[]>("linear_project_issues", { orgId, projectId }),
  linearImage: (orgId: string, url: string) => invoke<string>("linear_image", { orgId, url }),
  getGithubUser: (repoPath: string) => invoke<GithubUser>("get_github_user", { repoPath }),
  getGitIdentity: () => invoke<GitIdentity>("get_git_identity"),
  setGitIdentity: (name: string, email: string) => invoke<GitIdentity>("set_git_identity", { name, email }),
  stageFiles: (repoPath: string, paths: string[]) => invoke<null>("stage_files", { repoPath, paths }),
  unstageFiles: (repoPath: string, paths: string[]) => invoke<null>("unstage_files", { repoPath, paths }),
  createCommit: (repoPath: string, message: string) => invoke<string>("create_commit", { repoPath, message }),
  switchBranch: (repoPath: string, name: string) => invoke<null>("switch_branch", { repoPath, name }),
  /** Checks out `origin/x` as a local tracking branch (or switches to it if it exists); returns its name. */
  checkoutRemoteBranch: (repoPath: string, remoteRef: string) =>
    invoke<string>("checkout_remote_branch", { repoPath, remoteRef }),
  /** Deletes a local branch, returning its tip; only merged work unless `force` (the user's "delete anyway"). */
  deleteBranch: (repoPath: string, name: string, mergedHead: string | null, force = false) =>
    invoke<string>("delete_branch", { repoPath, name, mergedHead, force }),
  restoreBranch: (repoPath: string, name: string, tip: string) =>
    invoke<null>("restore_branch", { repoPath, name, tip }),
  /** Deletes a branch on GitHub (never the default one), returning its tip for undo. */
  deleteRemoteBranch: (repoPath: string, remote: string, name: string) =>
    invoke<string>("delete_remote_branch", { repoPath, remote, name }),
  restoreRemoteBranch: (repoPath: string, remote: string, name: string, tip: string) =>
    invoke<null>("restore_remote_branch", { repoPath, remote, name, tip }),
  createBranch: (repoPath: string, name: string, switchTo: boolean) =>
    invoke<null>("create_branch", { repoPath, name, switch: switchTo }),
  fetch: (repoPath: string) => invoke<null>("fetch", { repoPath }),
  pull: (repoPath: string) => invoke<null>("pull", { repoPath }),
  push: (repoPath: string) => invoke<null>("push", { repoPath }),
};
