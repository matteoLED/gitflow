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
} from "@/types/git";

export const gitBackend = {
  openRepository: (path: string) => invoke<RepositoryInfo>("open_repository", { path }),
  listRefs: (repoPath: string) => invoke<RefsSnapshot>("list_refs", { repoPath }),
  listCommits: (
    repoPath: string,
    options: { rev: string | null; skip: number; limit: number; filters: { firstParent: boolean; noMerges: boolean } },
  ) => invoke<CommitSummary[]>("list_commits", { repoPath, ...options }),
  listCommitFiles: (repoPath: string, hash: string) => invoke<ChangedFile[]>("list_commit_files", { repoPath, hash }),
  getCommitDiff: (repoPath: string, hash: string, path: string, previousPath: string | null) =>
    invoke<FileDiff>("get_commit_diff", { repoPath, hash, path, previousPath }),
  getWorkingTree: (repoPath: string) => invoke<WorkingTreeEntry[]>("get_working_tree", { repoPath }),
  getWorkingDiff: (repoPath: string, path: string, previousPath: string | null, side: WorkingSide) =>
    invoke<FileDiff>("get_working_diff", { repoPath, path, previousPath, side }),
  /** GitHub avatar of a commit's author via the user's `gh` login; null when unavailable. */
  getAvatarUrl: (repoPath: string, hash: string, email: string) =>
    invoke<string | null>("get_avatar_url", { repoPath, hash, email }),
  listPullRequests: (repoPath: string) => invoke<PullRequest[]>("list_pull_requests", { repoPath }),
  /** Fetches the PR head into FETCH_HEAD (no branch created) and returns the revision range of its commits. */
  fetchPullRequest: (repoPath: string, pr: PullRequest) =>
    invoke<string>("fetch_pull_request", {
      repoPath,
      number: pr.number,
      base: pr.baseRefName,
      headOid: pr.headRefOid,
    }),
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
