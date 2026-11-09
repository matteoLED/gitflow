// Typed client for the Rust Git commands. The UI never builds command lines: it only calls these.
import { invoke } from "@tauri-apps/api/core";
import type {
  ChangedFile,
  CommitSummary,
  FileDiff,
  RefsSnapshot,
  GitIdentity,
  GithubUser,
  PullRequest,
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
  AgentStep,
  RunSettings,
  LinearAccount,
  LinearIssue,
  LinearIssueDetail,
  LinearOrganization,
  LinearTeamStates,
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
  commentPullRequest: (repoPath: string, number: number, body: string) =>
    invoke<null>("comment_pull_request", { repoPath, number, body }),
  /** `gh pr merge` with the user's login; never deletes or switches branches. */
  mergePullRequest: (repoPath: string, number: number, method: MergeMethod) =>
    invoke<null>("merge_pull_request", { repoPath, number, method }),
  getGithubWebUrl: (repoPath: string) => invoke<string | null>("get_github_web_url", { repoPath }),
  /** Opens a github.com page in the default browser (other URLs are refused by the backend). */
  openGithubUrl: (url: string) => invoke<null>("open_github_url", { url }),
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
  getAgentSession: (repoPath: string, id: string) => invoke<AgentStep[]>("get_agent_session", { repoPath, id }),
  listPreviewTargets: (repoPath: string) => invoke<PreviewTarget[]>("list_preview_targets", { repoPath }),
  /** Runs a detected app's dev server; its URL and logs arrive as `preview` events. */
  startPreview: (repoPath: string, id: string) => invoke<null>("start_preview", { repoPath, id }),
  stopPreview: (id: string) => invoke<null>("stop_preview", { id }),
  /** Native preview webview (first-party cookies, unlike an iframe), placed in window coordinates. */
  previewViewShow: (url: string, bounds: { x: number; y: number; width: number; height: number; zoom: number }) =>
    invoke<null>("preview_view_show", { url, bounds }),
  previewViewHide: () => invoke<null>("preview_view_hide"),
  previewViewReload: () => invoke<null>("preview_view_reload"),
  previewViewClose: () => invoke<null>("preview_view_close"),
  /** Current address inside the preview, route included; null when none is shown. */
  previewViewUrl: () => invoke<string | null>("preview_view_url"),
  /** Answers an interactive script (menu choice, confirmation) on its standard input. */
  sendPreviewInput: (id: string, text: string) => invoke<null>("send_preview_input", { id, text }),
  /** One side of an image diff as a data: URL; null when that side doesn't exist (added/deleted). */
  getImage: (repoPath: string, hash: string, base: string | null, path: string, oldSide: boolean) =>
    invoke<string | null>("get_image", { repoPath, hash, base, path, oldSide }),
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
  linearImage: (orgId: string, url: string) => invoke<string>("linear_image", { orgId, url }),
  getGithubUser: (repoPath: string) => invoke<GithubUser>("get_github_user", { repoPath }),
  getGitIdentity: () => invoke<GitIdentity>("get_git_identity"),
  setGitIdentity: (name: string, email: string) => invoke<GitIdentity>("set_git_identity", { name, email }),
  stageFiles: (repoPath: string, paths: string[]) => invoke<null>("stage_files", { repoPath, paths }),
  unstageFiles: (repoPath: string, paths: string[]) => invoke<null>("unstage_files", { repoPath, paths }),
  createCommit: (repoPath: string, message: string) => invoke<string>("create_commit", { repoPath, message }),
  switchBranch: (repoPath: string, name: string) => invoke<null>("switch_branch", { repoPath, name }),
  createBranch: (repoPath: string, name: string, switchTo: boolean) =>
    invoke<null>("create_branch", { repoPath, name, switch: switchTo }),
  fetch: (repoPath: string) => invoke<null>("fetch", { repoPath }),
  pull: (repoPath: string) => invoke<null>("pull", { repoPath }),
  push: (repoPath: string) => invoke<null>("push", { repoPath }),
};
