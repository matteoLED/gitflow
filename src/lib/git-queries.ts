import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { gitBackend } from "@/lib/tauri-git";
import { useViewSettings } from "@/stores/view-settings-store";
import type { WorkingSide } from "@/types/git";

export const COMMITS_PAGE_SIZE = 200;

/** Every query key starts with the repo path so one invalidation refreshes a whole repository. */
export const repoKey = (repoPath: string) => ["repo", repoPath] as const;

export function useRefs(repoPath: string) {
  return useQuery({ queryKey: [...repoKey(repoPath), "refs"], queryFn: () => gitBackend.listRefs(repoPath) });
}

export function useCommits(repoPath: string, rev: string | null) {
  const firstParent = useViewSettings((s) => s.firstParentOnly);
  const noMerges = useViewSettings((s) => s.hideMerges);
  const filters = { firstParent, noMerges };
  return useInfiniteQuery({
    queryKey: [...repoKey(repoPath), "commits", rev, filters],
    queryFn: ({ pageParam }) =>
      gitBackend.listCommits(repoPath, { rev, skip: pageParam, limit: COMMITS_PAGE_SIZE, filters }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length < COMMITS_PAGE_SIZE ? undefined : pages.length * COMMITS_PAGE_SIZE),
  });
}

export function useCommitFiles(repoPath: string, hash: string) {
  return useQuery({
    queryKey: [...repoKey(repoPath), "commit-files", hash],
    queryFn: () => gitBackend.listCommitFiles(repoPath, hash),
    staleTime: Infinity, // a commit never changes
  });
}

export function useCommitDiff(
  repoPath: string,
  hash: string,
  path: string,
  previousPath: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...repoKey(repoPath), "commit-diff", hash, path, previousPath],
    queryFn: () => gitBackend.getCommitDiff(repoPath, hash, path, previousPath),
    staleTime: Infinity,
    enabled,
  });
}

/** Keyed by email: one lookup per author, reused across their commits. */
export function useAvatar(repoPath: string, hash: string, email: string) {
  return useQuery({
    queryKey: ["avatar", repoPath, email],
    queryFn: () => gitBackend.getAvatarUrl(repoPath, hash, email),
    staleTime: Infinity,
    retry: false,
  });
}

export function usePullRequests(repoPath: string) {
  return useQuery({
    queryKey: [...repoKey(repoPath), "pull-requests"],
    queryFn: () => gitBackend.listPullRequests(repoPath),
    staleTime: 60_000,
  });
}

export function useGithubUser(repoPath: string) {
  return useQuery({
    queryKey: ["github-user"],
    queryFn: () => gitBackend.getGithubUser(repoPath),
    staleTime: Infinity,
  });
}

export function useGitIdentity() {
  return useQuery({ queryKey: ["git-identity"], queryFn: gitBackend.getGitIdentity });
}

export function useWorkingTree(repoPath: string) {
  return useQuery({
    queryKey: [...repoKey(repoPath), "working-tree"],
    queryFn: () => gitBackend.getWorkingTree(repoPath),
    // ponytail: polling; replace with a file watcher (notify crate) if it shows up in profiles
    refetchInterval: 4000,
  });
}

export function useWorkingDiff(repoPath: string, path: string, previousPath: string | null, side: WorkingSide) {
  return useQuery({
    queryKey: [...repoKey(repoPath), "working-diff", side, path, previousPath],
    queryFn: () => gitBackend.getWorkingDiff(repoPath, path, previousPath, side),
  });
}
