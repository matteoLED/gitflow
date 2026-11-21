import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { invalidateRepo } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { useNoticesStore } from "@/stores/notices-store";

/** A local branch name, or a remote one (`origin/x`) which gets a local tracking branch. */
export type CheckoutTarget = { kind: "local" | "remote"; name: string };

/** The worktree that already has `name` checked out, from git's refusal ("…is already used by worktree at '…'"). */
export const worktreeHolding = (text: string) =>
  /already (?:used|checked out) by worktree at '([^']+)'/.exec(text)?.[1] ?? null;

/** Checks out a branch, GitKraken-style; git itself refuses when uncommitted work would be overwritten. */
export function useCheckout(repoPath: string) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const checkout = useMutation({
    mutationFn: async ({ kind, name }: CheckoutTarget) =>
      kind === "remote"
        ? gitBackend.checkoutRemoteBranch(repoPath, name)
        : (await gitBackend.switchBranch(repoPath, name), name),
    onSuccess: (local) => notify({ tone: "success", title: t("branches.switched", { name: local }) }),
    onError: (error, { name }) => {
      const { message, detail } = toGitError(error);
      // A branch an agent works on lives in its worktree: git can't check it out twice, so free it first.
      const worktree = worktreeHolding(`${message}\n${detail ?? ""}`);
      notify({
        tone: "error",
        title: worktree
          ? t("branches.inWorktree", { name })
          : t("action.failed", { action: t("branches.switchFailed", { name }), message }),
        detail,
        action: worktree
          ? {
              label: t("branches.releaseAndSwitch"),
              run: () =>
                void gitBackend
                  .releaseAgentWorktree(repoPath, worktree)
                  .then(() => checkout.mutate({ kind: "local", name }))
                  .catch((e: unknown) => {
                    const { message, detail } = toGitError(e);
                    notify({ tone: "error", title: message, detail });
                  }),
            }
          : undefined,
      });
    },
    onSettled: () => invalidateRepo(client, repoPath),
  });
  return checkout;
}
