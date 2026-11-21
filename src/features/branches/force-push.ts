import { ask } from "@tauri-apps/plugin-dialog";
import { getT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { useNoticesStore } from "@/stores/notices-store";

/** Git's refusal of a push whose branch was rewritten (rebase, amend) or moved on the remote. */
export const isRejectedPush = (text: string) => /\[rejected\]|non-fast-forward|fetch first|stale info/i.test(text);

/** Asks first, then replaces the remote branch with the local one, only over the state last fetched. */
export async function forcePushWithLease(repoPath: string, branch: string, onDone?: () => void) {
  const t = getT();
  const { notify } = useNoticesStore.getState();
  const sure = await ask(t("sync.forceConfirm", { branch }), { kind: "warning", okLabel: t("sync.force") });
  if (!sure) return;
  try {
    await gitBackend.pushForceWithLease(repoPath);
    notify({ tone: "success", title: t("sync.forced", { branch }) });
  } catch (error) {
    const { message, detail } = toGitError(error);
    notify({ tone: "error", title: t("action.failed", { action: t("sync.forceFailed"), message }), detail });
  } finally {
    onDone?.();
  }
}
