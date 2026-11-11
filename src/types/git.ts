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
  /** Date of the branch's last commit (ISO 8601), and its subject. */
  committedAt: string;
  subject: string;
};

/** `committedAt`: date of the branch's last commit (ISO 8601). */
export type RemoteBranch = { remote: string; name: string; committedAt: string };

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
  | "gitNotFound"
  | "notARepository"
  | "invalidInput"
  | "commandFailed"
  | "timeout"
  | "outputTooLarge"
  | "io"
  | "changedOnDisk"
  | "dirtyWorkingTree"
  | "alreadyPushed";

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
  /** Only from `getWorkflowRun`. */
  headSha?: string;
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
/** A just-created issue, enough to open it or hand it to an agent. */
export type CreatedLinearIssue = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  branchName: string;
};
export type NewLinearIssue = {
  teamId: string;
  title: string;
  description: string;
  priority: number;
  stateId: string | null;
  assignToMe: boolean;
  projectId: string | null;
};
export type LinearTeamStates = { id: string; key: string; name: string; states: { nodes: LinearWorkflowState[] } };
/** A workspace the user belongs to, connected here or not. */
export type LinearOrganization = { id: string; name: string; urlKey: string; logoUrl: string | null };
export type LinearState = {
  id?: string;
  position?: number;
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
  project: { id: string; name: string; icon: string | null; color: string } | null;
  cycle: { number: number } | null;
  labels: { nodes: LinearLabel[] };
  assignee?: LinearMember | null;
};
type LinearPerson = { name: string; avatarUrl: string | null };
/** `url` is the profile page (mentions link to it). */
export type LinearMember = LinearPerson & { id: string; url?: string };
export type LinearLabel = { id: string; name: string; color: string };
/** Fields of an issue to change; absent ones stay as they are, `null` clears. */
export type LinearIssuePatch = {
  title?: string;
  description?: string;
  priority?: number;
  stateId?: string;
  assigneeId?: string | null;
  labelIds?: string[];
  projectId?: string | null;
};
export type LinearProject = {
  id: string;
  name: string;
  /** Linear icon name ("Rocket") or an emoji. */
  icon: string | null;
  color: string;
  /** 0 to 1. */
  progress: number;
  targetDate: string | null;
  url: string;
  status: {
    name: string;
    type: "backlog" | "planned" | "started" | "paused" | "completed" | "canceled";
    color: string;
  } | null;
  lead: LinearPerson | null;
  teams: { nodes: { id: string; key: string }[] };
};
/** githubstatus.com: incidents not resolved yet, and services not fully operational. */
export type GithubStatus = {
  incidents: { name: string; impact: "none" | "minor" | "major" | "critical"; url: string }[];
  degraded: string[];
};
/** A team's current cycle (sprint) with all of its issues. */
export type LinearCycle = {
  id: string;
  number: number;
  name: string | null;
  startsAt: string;
  endsAt: string;
  /** 0 to 1. */
  progress: number;
  team: { id: string; key: string; name: string };
  issues: LinearIssue[];
};
export type LinearIssueDetail = LinearIssue & {
  description: string | null;
  createdAt: string;
  assignee: LinearMember | null;
  creator: LinearPerson | null;
  attachments: { nodes: { title: string; subtitle: string | null; url: string; sourceType: string | null }[] };
  comments: { nodes: LinearComment[] };
};
export type LinearComment = {
  id: string;
  body: string;
  createdAt: string;
  /** The thread's first comment, for a reply. */
  parent: { id: string } | null;
  user: (LinearMember & { isMe: boolean }) | null;
  botActor: LinearPerson | null;
};

export type AgentKind = "claude" | "codex";
export type AgentMode = "plan" | "auto" | "accept-edits" | "bypass";
export type RunSettings = {
  mode: AgentMode;
  model: string | null;
  effort: string | null;
  images?: string[];
  /** Start new conversations in their own worktree (the composer's toggle). */
  isolated?: boolean;
  /** The agent worktree a run works in (set per run, not a preference). */
  worktree?: string | null;
};
export type AgentInfo = { kind: AgentKind; installed: boolean; version: string | null };

export type AgentTask =
  | { kind: "review-pull-request"; number: number; base: string; head: string }
  | { kind: "ai-review-pull-request"; number: number; base: string; head: string }
  | { kind: "explain-commit"; hash: string }
  | { kind: "commit-message" }
  | { kind: "split-commits" }
  | { kind: "custom"; prompt: string };

export type StepKind = "info" | "prompt" | "thinking" | "message" | "tool" | "tool-result" | "result" | "error";
export type AgentStep = { kind: StepKind; title: string; detail: string | null; at: string | null };

export type AgentRunEvent =
  | { type: "step"; runId: string; step: AgentStep }
  | { type: "session"; runId: string; sessionId: string }
  | { type: "finished"; runId: string; status: "done" | "failed" | "cancelled" }
  | { type: "usage"; runId: string; usage: AgentUsage };

/** Context fill and cost reported by the agent; null when it didn't say. */
export type AgentUsage = { contextTokens: number | null; contextWindow: number | null; costUsd: number | null };

export type TerminalEvent = { type: "output"; id: string; data: string } | { type: "exited"; id: string };

/** Raw token counts of Claude replies (see `pricing.ts` for what they cost). */
export type Tokens = { input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number };
export type ModelTokens = { model: string; tokens: Tokens };
export type SessionUsage = { contextTokens: number | null; model: string | null; byModel: ModelTokens[] };
export type UsageRow = { day: string; project: string; model: string; messages: number; tokens: Tokens };
export type UsageStats = { rows: UsageRow[]; sessions: { project: string; day: string }[] };

export type AgentSession = {
  id: string;
  title: string;
  startedAt: string | null;
  updatedAt: string | null;
  prompts: number;
  toolCalls: number;
  gitBranch: string | null;
  /** Which CLI resumes it. */
  agent: "claude" | "codex";
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
  commits: { oid: string; messageHeadline?: string; committedDate?: string }[];
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

/** A Claude Code sub-agent (`.claude/agents/<name>.md`). */
export type AgentScope = "user" | "project";
export type AgentDefinition = {
  name: string;
  description: string;
  model: string;
  tools: string;
  prompt: string;
  scope: AgentScope;
};

/** The repository's code-review-graph. */
export type CodeGraphStatus = {
  cli: boolean;
  built: boolean;
  nodes: number;
  edges: number;
  files: number;
  lastUpdated: string | null;
  commit: string | null;
  branch: string | null;
};
export type CodeHotspot = {
  name: string;
  kind: string;
  file: string;
  line: number;
  risk: number;
  callers: number;
  coverage: string;
  security: number;
};
export type CodeFileMap = {
  files: { path: string; symbols: number; test: number }[];
  links: { source: string; target: string; weight: number }[];
};
type GraphSymbol = {
  name: string;
  kind?: string;
  file_path?: string;
  file?: string;
  line_start: number;
  risk_score?: number;
};
export type CodeImpact = {
  summary: string;
  risk_score: number;
  changed_functions: GraphSymbol[];
  test_gaps: GraphSymbol[];
  review_priorities: GraphSymbol[];
  affected_flows: unknown[];
};

export type Reaction = "THUMBS_UP" | "THUMBS_DOWN" | "LAUGH" | "HOORAY" | "CONFUSED" | "HEART" | "ROCKET" | "EYES";

/** One comment of a code thread, as GitHub's GraphQL API returns it. */
export type ThreadComment = {
  id: string;
  databaseId: number;
  url: string;
  body: string;
  createdAt: string;
  viewerCanUpdate: boolean;
  viewerCanDelete: boolean;
  author: { login: string; avatarUrl: string } | null;
  reactionGroups: { content: Reaction; viewerHasReacted: boolean; reactors: { totalCount: number } }[];
};

/** A discussion on one line of a pull request's diff. */
export type ReviewThread = {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  /** The line in the current diff; null once outdated. */
  line: number | null;
  originalLine: number | null;
  diffSide: "LEFT" | "RIGHT";
  comments: { nodes: ThreadComment[] };
};

/** A working-tree file opened in the editor; no content when binary or too large. */
export type EditorFile = { content: string | null; mtime: number; binary: boolean; tooLarge: boolean };

/** Lines differing from HEAD, 1-based, for the editor's gutter. */
export type LineChange = { kind: "added" | "modified" | "deleted"; start: number; end: number };

export type SearchMatch = { path: string; line: number; column: number; text: string };
export type SearchResults = { matches: SearchMatch[]; truncated: boolean };
/** How a project search matches; the replace uses the same semantics. */
export type MatchOptions = { regex: boolean; caseSensitive: boolean; wholeWord: boolean };
export type ReplaceRequest = MatchOptions & {
  query: string;
  replacement: string;
  /** Files to change; every matching file when null. */
  paths: string[] | null;
  /** Only this 1-based line of the single file in `paths`. */
  line: number | null;
  /** Files with unsaved editor changes: left untouched. */
  skip: string[];
};
export type ReplaceOutcome = { files: number; replacements: number };

/** A merge, rebase, cherry-pick or revert stopped midway (on conflicts, usually). */
export type Operation = {
  kind: "merge" | "rebase" | "cherry-pick" | "revert";
  /** Rebase progress: commit n of m. */
  step: [number, number] | null;
  branch: string | null;
  /** What each conflict side is: in a rebase, "ours" is the base being rebased onto. */
  ours: string;
  theirs: string;
};

/** How a cherry-pick, revert or rebase ended: "stopped" leaves it to the operation bar (conflicts). */
export type RewriteOutcome = "done" | "stopped";
export type RebaseAction = "pick" | "reword" | "squash" | "fixup" | "drop";
export type RebaseCommit = { hash: string; subject: string; message: string; author: string; authoredAt: string };
/** One line of the interactive rebase, oldest first; `message` is for reword only. */
export type RebaseStep = { hash: string; action: RebaseAction; message: string | null };

/** An agent's own checkout of the repository, on its own branch. */
/** `target`: the branch its pull request goes into when not the checked-out one (a failing PR's, for a CI fix). */
export type Worktree = { path: string; branch: string; target?: string };
export type WorktreeStatus = { changed: number; ahead: number };
/** A file an agent changed in the user's checkout during a run; null counts for binary files. */
export type EditedFile = {
  path: string;
  status: "added" | "deleted" | "modified";
  additions: number | null;
  deletions: number | null;
};

/** A Claude Code custom command or skill, typed after `/` in a message. */
export type SlashCommand = {
  name: string;
  description: string;
  argumentHint: string;
  skill: boolean;
  scope: "project" | "user";
};

/** Lines last changed by one commit (`git blame`); an all-zero sha means not committed yet. */
export type BlameHunk = {
  startLine: number;
  lines: number;
  sha: string;
  author: string;
  /** Unix seconds. */
  authorTime: number;
  summary: string;
};

/** A commit touching a file, with the file's path in that commit (renames are followed). */
export type FileCommit = {
  hash: string;
  author: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
  path: string;
  previousPath: string | null;
};

export type CommitPullRequest = { number: number; title: string; url: string };

/** How `git apply` uses a partial patch: onto the index, off the index, or off the working tree. */
export type PatchMode = "stage" | "unstage" | "discard";
/** One commit of a split: its message and the files it takes. */
export type CommitGroup = { message: string; files: string[] };

/** History search, run by `git log` (`--grep`, `--author`, `-S`/`-G`, `--since`/`--until`, `-- <path>`). */
export type HistorySearch = {
  message?: string;
  author?: string;
  path?: string;
  content?: string;
  /** Message, author and content are regular expressions instead of plain text. */
  regex?: boolean;
  since?: string;
  until?: string;
};

export type SubmoduleState = "upToDate" | "uninitialized" | "outOfDate" | "modified" | "conflicted";

export type Submodule = {
  path: string;
  recorded: string;
  checkedOut: string | null;
  state: SubmoduleState;
};

export type LfsStatus = { patterns: string[] };

/** A stash with what the stash list shows; `base` is the commit it was taken on (its diff base). */
export type StashEntry = {
  index: number;
  hash: string;
  base: string;
  /** Commit holding the untracked files it saved, if any. */
  untracked: string | null;
  branch: string | null;
  message: string;
  createdAt: string;
  fileCount: number;
};

export type StashOutcome = { conflicts: boolean };

export type UndoKind =
  "commit" | "amend" | "merge" | "rebase" | "fixup" | "pull" | "reset" | "checkout" | "branchDelete";

/** The last undoable operation; sent back as is to undo it (the backend checks nothing moved since). */
export type UndoAction = {
  kind: UndoKind;
  label: string;
  branch: string | null;
  target: string;
  current: string;
  at: number;
};

/** A participating GitHub notification (`github_notifications`). */
export type GithubNotification = {
  id: string;
  unread: boolean;
  /** review_requested, mention, comment, author, ci_activity… */
  reason: string;
  updatedAt: string;
  title: string;
  /** PullRequest, Issue, CheckSuite… */
  kind: string;
  /** owner/name */
  repo: string;
  number: number | null;
  url: string;
};

/** A Linear inbox notification about an issue (`linear_notifications`). */
export type LinearNotification = {
  id: string;
  /** issueAssignedToYou, issueNewComment, issueMention, issueStatusChanged… */
  kind: string;
  updatedAt: string;
  read: boolean;
  actor: string | null;
  issueId: string;
  identifier: string;
  title: string;
  url: string;
  comment: string | null;
};

export type Tag = {
  name: string;
  /** Commit the tag points to (an annotated tag is peeled). */
  target: string;
  date: string;
  /** Only annotated tags have one. */
  message: string | null;
};

/** The fields the Releases page reads from GitHub's REST release object. */
export type Release = {
  id: number;
  tag_name: string;
  target_commitish: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  created_at: string;
  published_at: string | null;
  author: { login: string } | null;
};

export type ReleaseInput = {
  tagName: string;
  /** Branch or commit the tag is created on when it doesn't exist yet. */
  target: string | null;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
};
