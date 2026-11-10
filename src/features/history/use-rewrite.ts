import { ask } from "@tauri-apps/plugin-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { invalidateRepo } from "@/lib/git-queries";
import { useNoticesStore } from "@/stores/notices-store";
import type { RewriteOutcome } from "@/types/git";

type RewriteJob = {
  /** `confirmed` is true only after the user agreed to rewrite commits that are already pushed. */
  run: (confirmed: boolean) => Promise<RewriteOutcome>;
  success: string;
};

/**
 * Cherry-pick, revert or rebase: asks before rewriting pushed commits, reports how it went, and hands a stop on
 * conflicts over to the operation bar. Resolves to null when the user declined.
 */
export function useRewrite(repoPath: string) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  return useMutation({
    mutationFn: async ({ run }: RewriteJob): Promise<RewriteOutcome | null> => {
      try {
        return await run(false);
      } catch (error) {
        if (toGitError(error).kind !== "alreadyPushed") throw error;
        const sure = await ask(t("rewrite.pushedConfirm"), { kind: "warning", okLabel: t("rewrite.rewriteAnyway") });
        return sure ? run(true) : null;
      }
    },
    onSuccess: (outcome, { success }) => {
      if (outcome === "done") notify({ tone: "success", title: success });
      if (outcome === "stopped")
        notify({ tone: "error", title: t("rewrite.stopped"), detail: t("rewrite.stoppedHint") });
    },
    onError: (error) => {
      const { message, detail } = toGitError(error);
      notify({ tone: "error", title: t("rewrite.failed"), detail: detail ? `${message}\n${detail}` : message });
    },
    onSettled: () => invalidateRepo(client, repoPath),
  });
}
