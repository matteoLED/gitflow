import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateRepo } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";

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
    // Without a watcher, refetch on focus still keeps things reasonably fresh.
    Promise.resolve()
      .then(() => gitBackend.watchRepository(repoPath))
      .catch(() => undefined);
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<RepoChanged>("repo-changed", ({ payload }) => {
          if (payload.repoPath !== repoPath) return;
          const kinds = ["working-tree", "working-diff", "operation", "blame"];
          if (payload.git) kinds.push("refs", "commits", "file-history");
          void invalidateRepo(client, repoPath, kinds);
        }),
      )
      .then((stop) => (disposed ? stop() : (unlisten = stop)))
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [client, repoPath]);
}
