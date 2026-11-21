import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateRepo } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";

import type { QueryClient } from "@tanstack/react-query";

/** Pull requests (list, detail, diff, threads) and CI runs of the repository, refetched from GitHub. */
function refreshGithub(client: QueryClient, repoPath: string) {
  void invalidateRepo(client, repoPath, ["pull-requests", "compare-base"]);
  for (const key of ["pull-request", "workflow-runs", "review-threads"])
    void client.invalidateQueries({ queryKey: [key, repoPath] });
}

type RepoChanged = { repoPath: string; worktree: boolean; git: boolean };

/**
 * Refreshes the UI when the repository changes on disk (FSEvents on the Rust side) instead of polling:
 * an edit refreshes the working tree, a commit/checkout/fetch also refreshes refs and history.
 */
export function useRepoWatcher(repoPath: string) {
  const client = useQueryClient();
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let later: ReturnType<typeof setTimeout> | undefined;
    // Without a watcher, refetch on focus still keeps things reasonably fresh.
    Promise.resolve()
      .then(() => gitBackend.watchRepository(repoPath))
      .catch(() => undefined);
    // Agents search the code through its indexes: brought up to date on open, then as commits land.
    const reindex = () => void Promise.resolve(gitBackend.refreshCodeIndexes?.(repoPath)).catch(() => undefined);
    reindex();
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<RepoChanged>("repo-changed", ({ payload }) => {
          if (payload.repoPath !== repoPath) return;
          const kinds = ["working-tree", "working-diff", "blame"];
          // A merge/rebase in progress lives in .git: a file edit can't start or end one.
          if (payload.git) kinds.push("operation", "refs", "commits", "file-history", "pull-requests", "compare-base");
          void invalidateRepo(client, repoPath, kinds);
          // A push (here, in an agent's worktree, or by an agent itself) moves refs: GitHub's side follows once
          // it has caught up. Debounced: an agent's burst of commits costs one round of gh calls, not one each.
          if (payload.git) {
            reindex();
            clearTimeout(later);
            later = setTimeout(() => refreshGithub(client, repoPath), 5_000);
          }
        }),
      )
      .then((stop) => (disposed ? stop() : (unlisten = stop)))
      .catch(() => undefined);
    return () => {
      disposed = true;
      clearTimeout(later);
      unlisten?.();
    };
  }, [client, repoPath]);
}
