// Mirror of src-tauri/src/git/model.rs — keep both in sync.

export type RepositoryInfo = { path: string; name: string };

export type HeadInfo = {
  /** Checked-out branch; null when HEAD is detached. */
  branch: string | null;
  /** True for a repository without any commit yet. */
  unborn: boolean;
};

export type LocalBranch = {
  name: string;
  upstream: string | null;
  upstreamGone: boolean;
  ahead: number;
  behind: number;
};

export type RemoteBranch = { remote: string; name: string };

export type Stash = { index: number; message: string };

export type RefsSnapshot = {
  head: HeadInfo;
  branches: LocalBranch[];
  remotes: RemoteBranch[];
  tags: string[];
  stashes: Stash[];
};

export type RefKind = "head" | "branch" | "remote" | "tag";

export type CommitRef = { kind: RefKind; name: string };

export type CommitSummary = {
  hash: string;
  parents: string[];
  subject: string;
  author: string;
  authorEmail: string;
  /** Names from `Co-authored-by:` trailers. */
  coAuthors: string[];
  authoredAt: string; // ISO 8601
  refs: CommitRef[];
};

export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "unmerged" | "untracked";

export type ChangedFile = {
  path: string;
  previousPath: string | null;
  status: FileStatus;
  binary: boolean;
  additions: number | null;
  deletions: number | null;
};

export type WorkingTreeEntry = {
  path: string;
  previousPath: string | null;
  staged: FileStatus | null;
  unstaged: FileStatus | null;
  conflicted: boolean;
};

export type WorkingSide = "staged" | "unstaged" | "untracked";

export type FileDiff = { patch: string; binary: boolean };

export type GitErrorKind =
  "gitNotFound" | "notARepository" | "invalidInput" | "commandFailed" | "timeout" | "outputTooLarge" | "io";

export type GitErrorPayload = { kind: GitErrorKind; message: string; detail: string | null };

export type DiffLineKind = "context" | "added" | "removed";

export type DiffLine = {
  kind: DiffLineKind;
  oldLine: number | null;
  newLine: number | null;
  content: string;
};

export type DiffHunk = {
  /** Unchanged lines between the previous hunk (or file start) and this one. */
  hiddenBefore: number;
  lines: DiffLine[];
};

export type PullRequest = {
  number: number;
  title: string;
  author: { login: string };
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  isDraft: boolean;
  updatedAt: string;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "" | null;
  state: "OPEN" | "MERGED" | "CLOSED";
  url: string;
};

/** As `gh run list` / `gh run view --json` return them. */
export type RunConclusion =
  "success" | "failure" | "cancelled" | "skipped" | "neutral" | "timed_out" | "action_required" | "";
export type RunStatus = "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending";

export type WorkflowStep = { name: string; number: number; status: RunStatus; conclusion: RunConclusion };

export type WorkflowJob = {
  name: string;
  status: RunStatus;
  conclusion: RunConclusion;
  startedAt: string;
  completedAt: string;
  url: string;
  steps: WorkflowStep[];
};

export type WorkflowRun = {
  databaseId: number;
  displayTitle: string;
  workflowName: string;
  status: RunStatus;
  conclusion: RunConclusion;
  headBranch: string;
  event: string;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  url: string;
  jobs?: WorkflowJob[];
};

export type PreviewKind = "web" | "expo" | "flutter" | "server" | "workspace";
export type PreviewTarget = {
  id: string;
  name: string;
  dir: string;
  kind: PreviewKind;
  framework: string;
  command: string;
};
export type PreviewEvent =
  | { type: "log"; targetId: string; task: string | null; line: string }
  | { type: "ready"; targetId: string; url: string }
  | { type: "exited"; targetId: string; code: number | null };

export type LinearAccount = { id: string; name: string; urlKey: string; userName: string };
export type LinearWorkflowState = {
  id: string;
  name: string;
  type: LinearState["type"];
  color: string;
  position: number;
};
export type LinearTeamStates = { id: string; states: { nodes: LinearWorkflowState[] } };
/** A workspace the user belongs to, connected here or not. */
export type LinearOrganization = { id: string; name: string; urlKey: string; logoUrl: string | null };
export type LinearState = {
  name: string;
  type: "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled";
  color: string;
};
export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  priorityLabel: string;
  url: string;
  branchName: string;
  updatedAt: string;
  state: LinearState;
  team: { id: string; key: string; name: string };
  project: { name: string } | null;
  cycle: { number: number } | null;
  labels: { nodes: { name: string; color: string }[] };
};
type LinearPerson = { name: string; avatarUrl: string | null };
export type LinearIssueDetail = LinearIssue & {
  description: string | null;
  createdAt: string;
  assignee: LinearPerson | null;
  creator: LinearPerson | null;
  attachments: { nodes: { title: string; subtitle: string | null; url: string; sourceType: string | null }[] };
  comments: { nodes: { body: string; createdAt: string; user: LinearPerson | null; botActor: LinearPerson | null }[] };
};

export type AgentKind = "claude" | "codex";
export type AgentMode = "plan" | "auto" | "accept-edits" | "bypass";
export type RunSettings = { mode: AgentMode; model: string | null; effort: string | null; images?: string[] };
export type AgentInfo = { kind: AgentKind; installed: boolean; version: string | null };

export type AgentTask =
  | { kind: "review-pull-request"; number: number; base: string; head: string }
  | { kind: "explain-commit"; hash: string }
  | { kind: "commit-message" }
  | { kind: "custom"; prompt: string };

export type StepKind = "info" | "prompt" | "thinking" | "message" | "tool" | "tool-result" | "result" | "error";
export type AgentStep = { kind: StepKind; title: string; detail: string | null; at: string | null };

export type AgentRunEvent =
  | { type: "step"; runId: string; step: AgentStep }
  | { type: "session"; runId: string; sessionId: string }
  | { type: "finished"; runId: string; status: "done" | "failed" | "cancelled" };

export type TerminalEvent = { type: "output"; id: string; data: string } | { type: "exited"; id: string };

export type AgentSession = {
  id: string;
  title: string;
  startedAt: string | null;
  updatedAt: string | null;
  prompts: number;
  toolCalls: number;
  gitBranch: string | null;
};

type GhActor = { login: string; name?: string };
export type PullRequestCheck = {
  __typename: "CheckRun" | "StatusContext";
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string;
  state?: string;
  detailsUrl?: string;
  targetUrl?: string;
  workflowName?: string;
  description?: string;
  startedAt?: string;
  completedAt?: string;
};
/** `gh pr view --json` for the pull request page. */
export type PullRequestDetails = {
  number: number;
  title: string;
  body: string;
  author: GhActor;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  url: string;
  createdAt: string;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: { oid: string }[];
  comments: { author: GhActor; body: string; createdAt: string; url: string }[];
  reviews: { author: GhActor; body: string; state: string; submittedAt: string }[];
  reviewRequests: { login?: string; name?: string; slug?: string }[];
  statusCheckRollup: PullRequestCheck[];
  mergeStateStatus: "BEHIND" | "BLOCKED" | "CLEAN" | "DIRTY" | "DRAFT" | "HAS_HOOKS" | "UNKNOWN" | "UNSTABLE";
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  files: { path: string; additions: number; deletions: number }[];
};
export type MergeMethod = "squash" | "merge" | "rebase";

export type PullRequestRange = { range: string; mergeBase: string | null; head: string };

export type ReviewEvent = "approve" | "request-changes" | "comment";

export type GithubUser = { login: string; name: string | null; avatarUrl: string | null };

export type GitIdentity = { name: string | null; email: string | null };
