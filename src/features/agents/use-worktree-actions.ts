import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ask } from "@tauri-apps/plugin-dialog";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { invalidateRepo, useRefs } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { useNoticesStore } from "@/stores/notices-store";
import type { Worktree } from "@/types/git";

/**
 * An agent worktree's live status and the ways out of it: merge into the current branch, open a pull request,
 * or delete it. Shared by the conversation's worktree bar and the Parallel agents board.
 */
export function useWorktreeActions(repoPath: string, worktree: Worktree, title: string, running: boolean) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const current = useRefs(repoPath).data?.head.branch ?? null;
  const status = useQuery({
    queryKey: ["agent-worktree", repoPath, worktree.path],
    queryFn: () => gitBackend.agentWorktreeStatus(repoPath, worktree.path),
    refetchInterval: running ? 5_000 : 30_000,
    retry: false,
  });
  const act = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSettled: () => {
      void invalidateRepo(client, repoPath);
      void client.invalidateQueries({ queryKey: ["agent-worktree", repoPath] });
      void client.invalidateQueries({ queryKey: ["agent-worktree-diff", repoPath] });
    },
    onError: (error) => {
      const { message, detail } = toGitError(error);
      notify({ tone: "error", title: t("worktree.failed"), detail: detail ? `${message}\n${detail}` : message });
    },
  });
  const merge = () =>
    act.mutate(async () => {
      await gitBackend.mergeAgentWorktree(repoPath, worktree.path, title);
      notify({ tone: "success", title: t("worktree.merged", { branch: worktree.branch }) });
    });
  const publish = () =>
    act.mutate(async () => {
      const url = await gitBackend.publishAgentWorktree(repoPath, worktree.path, title, t("worktree.prBody"));
      notify({ tone: "success", title: t("worktree.published", { branch: worktree.branch }), detail: url });
      if (url) await gitBackend.openGithubUrl(url);
    });
  const remove = async () => {
    const sure = await ask(t("worktree.removeConfirm", { branch: worktree.branch }), {
      kind: "warning",
      okLabel: t("worktree.remove"),
    });
    if (sure) act.mutate(() => gitBackend.removeAgentWorktree(repoPath, worktree.path, true));
  };
  const changes = status.data ? status.data.changed + status.data.ahead : 0;
  return { status, current, changes, busy: act.isPending, merge, publish, remove };
}
