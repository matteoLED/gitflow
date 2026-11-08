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
};

export type GithubUser = { login: string; name: string | null; avatarUrl: string | null };

export type GitIdentity = { name: string | null; email: string | null };
