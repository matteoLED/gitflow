import { useQuery } from "@tanstack/react-query";
import { repoKey } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";

/** Under the repository's key: refreshed with refs after any Git operation. */
export const useTags = (repoPath: string) =>
  useQuery({ queryKey: [...repoKey(repoPath), "tags"], queryFn: () => gitBackend.listTags(repoPath) });

/** Outside the repository's key: a file save mustn't call GitHub again. */
export const releasesKey = (repoPath: string) => ["releases", repoPath] as const;

export const useReleases = (repoPath: string) =>
  useQuery({ queryKey: releasesKey(repoPath), queryFn: () => gitBackend.listReleases(repoPath), staleTime: 60_000 });

export const linearReleasesKey = (orgId: string | undefined) => ["linear", "releases", orgId] as const;

/** Linear's release pipelines and their latest releases. */
export const useLinearReleases = (orgId: string | undefined) =>
  useQuery({
    queryKey: linearReleasesKey(orgId),
    queryFn: () => gitBackend.linearReleases(orgId ?? ""),
    enabled: !!orgId,
    staleTime: 60_000,
  });

export const useLinearReleaseIssues = (orgId: string | undefined, releaseId: string) =>
  useQuery({
    queryKey: ["linear", "release-issues", orgId, releaseId],
    queryFn: () => gitBackend.linearReleaseIssues(orgId ?? "", releaseId),
    enabled: !!orgId,
    staleTime: 60_000,
  });
