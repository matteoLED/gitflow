import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { invalidateRepo } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { useNoticesStore } from "@/stores/notices-store";

/** A local branch name, or a remote one (`origin/x`) which gets a local tracking branch. */
export type CheckoutTarget = { kind: "local" | "remote"; name: string };

/** Checks out a branch, GitKraken-style; git itself refuses when uncommitted work would be overwritten. */
export function useCheckout(repoPath: string) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  return useMutation({
    mutationFn: async ({ kind, name }: CheckoutTarget) =>
      kind === "remote"
        ? gitBackend.checkoutRemoteBranch(repoPath, name)
        : (await gitBackend.switchBranch(repoPath, name), name),
    onSuccess: (local) => notify({ tone: "success", title: t("branches.switched", { name: local }) }),
    onError: (error, { name }) => {
      const { message, detail } = toGitError(error);
      notify({
        tone: "error",
        title: t("action.failed", { action: t("branches.switchFailed", { name }), message }),
        detail,
      });
    },
    onSettled: () => invalidateRepo(client, repoPath),
  });
}
