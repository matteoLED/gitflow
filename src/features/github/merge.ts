import { gitBackend } from "@/lib/tauri-git";
import type { MergeMethod } from "@/types/git";

/**
 * GitHub sometimes merges and still answers an error (a 502 from its proxy, then "Merge already in progress"
 * on a retry): an error only counts once GitHub, asked again for a few seconds, says the PR isn't merged.
 */
export async function mergeConfirmed(repoPath: string, number: number, method: MergeMethod, wait = 2_000) {
  try {
    await gitBackend.mergePullRequest(repoPath, number, method);
  } catch (error) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      const state = await gitBackend
        .getPullRequestDetails(repoPath, number)
        .then((d) => d.state)
        .catch(() => null);
      if (state === "MERGED") return;
    }
    throw error;
  }
}
