// Typed client for the Rust Git commands. The UI never builds command lines: it only calls these.
import { invoke } from "@tauri-apps/api/core";
import type {
  GithubNotification,
  LinearReleases,
  LinearNotification,
  EditedFile,
  StashEntry,
  StashOutcome,
  UndoAction,
  CommitGroup,
  PatchMode,
  HistorySearch,
  LfsStatus,
  Submodule,
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
  Tag,
  Release,
  ReleaseInput,
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
  LinearIssuePatch,
  LinearLabel,
  LinearMember,
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
    options: {
      rev: string | null;
      skip: number;
      limit: number;
      filters: HistorySearch & { firstParent: boolean; noMerges: boolean };
    },
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
  fetchPullRequest: (repoPath: string, pr: Pick<PullRequest, "number" | "baseRefName" | "headRefOid">) =>
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
  /** The user's participating GitHub notifications, read ones included. */
  githubNotifications: (repoPath: string) => invoke<GithubNotification[]>("github_notifications", { repoPath }),
  githubMarkNotificationRead: (repoPath: string, id: string) =>
    invoke<null>("github_mark_notification_read", { repoPath, id }),
  linearNotifications: (orgId: string) => invoke<LinearNotification[]>("linear_notifications", { orgId }),
  /** `readAt` null marks the notification unread. */
  linearSetNotificationRead: (orgId: string, id: string, readAt: string | null) =>
    invoke<null>("linear_set_notification_read", { orgId, id, readAt }),
  linearArchiveNotification: (orgId: string, id: string) =>
    invoke<null>("linear_archive_notification", { orgId, id }),
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
  /** One COMMENT review on `commit` with every line comment, through `gh api`. */
  submitAiReview: (
    repoPath: string,
    number: number,
    commit: string,
    body: string,
    comments: { path: string; line: number; side: "LEFT" | "RIGHT"; body: string }[],
  ) => invoke<null>("submit_ai_review", { repoPath, number, commit, body, comments }),
  /** Every file of the working tree, `.gitignore` respected. */
  /** The merge, rebase, cherry-pick or revert in progress, if any. */
  getOperation: (repoPath: string) => invoke<Operation | null>("get_operation", { repoPath }),
  continueOperation: (repoPath: string) => invoke<null>("continue_operation", { repoPath }),
  abortOperation: (repoPath: string) => invoke<null>("abort_operation", { repoPath }),
  cherryPickCommit: (repoPath: string, hash: string) =>
    invoke<RewriteOutcome>("cherry_pick_commit", { repoPath, hash }),
  revertCommit: (repoPath: string, hash: string) => invoke<RewriteOutcome>("revert_commit", { repoPath, hash }),
  /** Commits the staged changes as `fixup!` of `hash` and autosquashes them into it. */
  fixupCommit: (repoPath: string, hash: string) => invoke<RewriteOutcome>("fixup_commit", { repoPath, hash }),
  rebasePlan: (repoPath: string, from: string) => invoke<RebaseCommit[]>("rebase_plan", { repoPath, from }),
  /** Refuses with `alreadyPushed` unless `confirmed` when the rewritten commits are on a remote. */
  interactiveRebase: (repoPath: string, from: string, steps: RebaseStep[], confirmed: boolean) =>
    invoke<RewriteOutcome>("interactive_rebase", { repoPath, from, steps, confirmed }),
  /** Skips the commit a rebase, cherry-pick or revert stopped on (not a merge). */
  skipRebaseCommit: (repoPath: string) => invoke<null>("skip_rebase_commit", { repoPath }),
  /** Resolves whole files with one side, then marks them resolved. */
  resolveWithSide: (repoPath: string, paths: string[], theirs: boolean) =>
    invoke<null>("resolve_with_side", { repoPath, paths, theirs }),
  /** From `base` (else HEAD), on `branch` (reused when free, else suffixed) or a new `agent/<id>` branch. */
  createAgentWorktree: (repoPath: string, base?: string | null, branch?: string | null) =>
    invoke<Worktree>("create_agent_worktree", { repoPath, base: base ?? null, branch: branch ?? null }),
  agentWorktreeStatus: (repoPath: string, path: string) =>
    invoke<WorktreeStatus>("agent_worktree_status", { repoPath, path }),
  /** Commits what the agent left, then merges its branch into the current one. */
  /** Multi-file patch: the agent's commits plus its uncommitted work, against where its branch forked. */
  agentWorktreeDiff: (repoPath: string, path: string) => invoke<string>("agent_worktree_diff", { repoPath, path }),
  /** The working tree on disk as a tree id, nothing staged: taken before and after an agent edits the checkout. */
  snapshotWorkingTree: (repoPath: string) => invoke<string>("snapshot_working_tree", { repoPath }),
  agentEdits: (repoPath: string, before: string, after: string) =>
    invoke<EditedFile[]>("agent_edits", { repoPath, before, after }),
  /** Puts a file back as it was before the run; refused if it changed since. */
  rejectAgentEdit: (repoPath: string, before: string, after: string, path: string) =>
    invoke<null>("reject_agent_edit", { repoPath, before, after, path }),
  /** Multi-file patch of `git diff <branch of a> <branch of b>`. */
  compareAgentWorktrees: (repoPath: string, a: string, b: string) =>
    invoke<string>("compare_agent_worktrees", { repoPath, a, b }),
  mergeAgentWorktree: (repoPath: string, path: string, message: string) =>
    invoke<null>("merge_agent_worktree", { repoPath, path, message }),
  /** Commits what's left, pushes the agent's branch and opens a PR into `target` (else the current branch). */
  publishAgentWorktree: (repoPath: string, path: string, title: string, body: string, target?: string) =>
    invoke<string>("publish_agent_worktree", { repoPath, path, title, body, target: target ?? null }),
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
  /** Every open (or recently closed) issue of the workspace, anyone's. */
  linearAllIssues: (orgId: string) => invoke<LinearIssue[]>("linear_all_issues", { orgId }),
  /** Linear's full-text search across the workspace, closed issues included. */
  linearSearchIssues: (orgId: string, query: string) =>
    invoke<LinearIssue[]>("linear_search_issues", { orgId, query }),
  linearIssue: (orgId: string, id: string) => invoke<LinearIssueDetail>("linear_issue", { orgId, id }),
  /** Every workspace of the user; may fail when Linear refuses it to API keys. */
  linearOrganizations: (orgId: string) => invoke<LinearOrganization[]>("linear_organizations", { orgId }),
  /** A Linear upload (needs the key) as a data: URL. */
  linearTeamStates: (orgId: string) => invoke<LinearTeamStates[]>("linear_team_states", { orgId }),
  linearSetIssueState: (orgId: string, issueId: string, stateId: string) =>
    invoke<null>("linear_set_issue_state", { orgId, issueId, stateId }),
  linearUpdateIssue: (orgId: string, issueId: string, patch: LinearIssuePatch) =>
    invoke<null>("linear_update_issue", { orgId, issueId, patch }),
  linearTeamMembers: (orgId: string, teamId: string) =>
    invoke<LinearMember[]>("linear_team_members", { orgId, teamId }),
  linearLabels: (orgId: string, teamId: string) => invoke<LinearLabel[]>("linear_labels", { orgId, teamId }),
  linearCreateIssue: (orgId: string, issue: NewLinearIssue) =>
    invoke<CreatedLinearIssue>("linear_create_issue", { orgId, issue }),
  linearProjects: (orgId: string) => invoke<LinearProject[]>("linear_projects", { orgId }),
  linearActiveCycles: (orgId: string) => invoke<LinearCycle[]>("linear_active_cycles", { orgId }),
  linearProjectIssues: (orgId: string, projectId: string) =>
    invoke<LinearIssue[]>("linear_project_issues", { orgId, projectId }),
  linearReleases: (orgId: string) => invoke<LinearReleases>("linear_releases", { orgId }),
  linearReleaseIssues: (orgId: string, releaseId: string) =>
    invoke<LinearIssue[]>("linear_release_issues", { orgId, releaseId }),
  linearSetReleaseStage: (orgId: string, releaseId: string, stageId: string) =>
    invoke<null>("linear_set_release_stage", { orgId, releaseId, stageId }),
  linearImage: (orgId: string, url: string) => invoke<string>("linear_image", { orgId, url }),
  linearCreateComment: (orgId: string, issueId: string, body: string, parentId: string | null) =>
    invoke<null>("linear_create_comment", { orgId, issueId, body, parentId }),
  linearUpdateComment: (orgId: string, id: string, body: string) =>
    invoke<null>("linear_update_comment", { orgId, id, body }),
  linearDeleteComment: (orgId: string, id: string) => invoke<null>("linear_delete_comment", { orgId, id }),
  linearUploadImage: (orgId: string, filename: string, contentType: string, bytes: number[]) =>
    invoke<string>("linear_upload_image", { orgId, filename, contentType, bytes }),
  getGithubUser: (repoPath: string) => invoke<GithubUser>("get_github_user", { repoPath }),
  getGitIdentity: () => invoke<GitIdentity>("get_git_identity"),
  setGitIdentity: (name: string, email: string) => invoke<GitIdentity>("set_git_identity", { name, email }),
  stageFiles: (repoPath: string, paths: string[]) => invoke<null>("stage_files", { repoPath, paths }),
  unstageFiles: (repoPath: string, paths: string[]) => invoke<null>("unstage_files", { repoPath, paths }),
  createCommit: (repoPath: string, message: string) => invoke<string>("create_commit", { repoPath, message }),
  /** Replaces HEAD with the index and `message`; refused once HEAD is on a remote. */
  amendCommit: (repoPath: string, message: string) => invoke<string>("amend_commit", { repoPath, message }),
  headMessage: (repoPath: string) => invoke<string>("head_message", { repoPath }),
  /** Applies hunks of one file's diff (from `buildPartialPatch`) to the index or, for discard, the working tree. */
  applyHunks: (repoPath: string, path: string, hunks: string, mode: PatchMode) =>
    invoke<null>("apply_hunks", { repoPath, path, hunks, mode }),
  /** For each group: resets the index, stages its files, commits. Returns the new hashes. */
  commitGroups: (repoPath: string, groups: CommitGroup[]) => invoke<string[]>("commit_groups", { repoPath, groups }),
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
  listTags: (repoPath: string) => invoke<Tag[]>("list_tags", { repoPath }),
  /** Annotated when `message` is set; on HEAD when `target` is null. Never replaces an existing tag. */
  createTag: (repoPath: string, name: string, target: string | null, message: string | null) =>
    invoke<null>("create_tag", { repoPath, name, target, message }),
  deleteTag: (repoPath: string, name: string) => invoke<null>("delete_tag", { repoPath, name }),
  /** `git push origin refs/tags/<name>`, never forced. */
  pushTag: (repoPath: string, name: string) => invoke<null>("push_tag", { repoPath, name }),
  deleteRemoteTag: (repoPath: string, name: string) => invoke<null>("delete_remote_tag", { repoPath, name }),
  listReleases: (repoPath: string) => invoke<Release[]>("list_releases", { repoPath }),
  createRelease: (repoPath: string, input: ReleaseInput) => invoke<Release>("create_release", { repoPath, input }),
  updateRelease: (repoPath: string, id: number, input: ReleaseInput) =>
    invoke<Release>("update_release", { repoPath, id, input }),
  /** Deletes the release only; its tag stays. */
  deleteRelease: (repoPath: string, id: number) => invoke<null>("delete_release", { repoPath, id }),
  /** GitHub's generated notes from `previous` (GitHub picks one when null) to `tag`. */
  generateReleaseNotes: (repoPath: string, tag: string, previous: string | null, target: string | null) =>
    invoke<{ name: string; body: string }>("generate_release_notes", { repoPath, tag, previous, target }),
  /** `git log from..to` (subjects and bodies), capped, for the AI changelog. */
  releaseCommits: (repoPath: string, from: string | null, to: string) =>
    invoke<string>("release_commits", { repoPath, from, to }),
  listSubmodules: (repoPath: string) => invoke<Submodule[]>("list_submodules", { repoPath }),
  /** `git submodule update --init --recursive` (all, or one path). Explicit click only. */
  updateSubmodules: (repoPath: string, path: string | null) => invoke<null>("update_submodules", { repoPath, path }),
  /** null when git-lfs isn't installed. */
  lfsStatus: (repoPath: string) => invoke<LfsStatus | null>("lfs_status", { repoPath }),
  lfsTrackedPaths: (repoPath: string, paths: string[]) => invoke<string[]>("lfs_tracked_paths", { repoPath, paths }),
  lfsPull: (repoPath: string) => invoke<null>("lfs_pull", { repoPath }),
  lfsTrack: (repoPath: string, pattern: string) => invoke<null>("lfs_track", { repoPath, pattern }),
  listStashes: (repoPath: string) => invoke<StashEntry[]>("list_stashes", { repoPath }),
  createStash: (repoPath: string, message: string, includeUntracked: boolean) =>
    invoke<null>("create_stash", { repoPath, message, includeUntracked }),
  /**
   * Apply (or pop: drops it once applied cleanly). With conflicts the stash is kept.
   * Stash operations pass the listed hash too: the backend refuses if `stash@{index}` no longer points to it.
   */
  applyStash: (repoPath: string, index: number, hash: string, pop: boolean) =>
    invoke<StashOutcome>("apply_stash", { repoPath, index, hash, pop }),
  dropStash: (repoPath: string, index: number, hash: string) => invoke<null>("drop_stash", { repoPath, index, hash }),
  branchFromStash: (repoPath: string, index: number, hash: string, name: string) =>
    invoke<null>("branch_from_stash", { repoPath, index, hash, name }),
  lastUndo: (repoPath: string) => invoke<UndoAction | null>("last_undo", { repoPath }),
  undoLast: (repoPath: string, action: UndoAction) => invoke<null>("undo_last", { repoPath, action }),
};
