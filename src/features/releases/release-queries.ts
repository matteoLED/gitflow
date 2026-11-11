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
