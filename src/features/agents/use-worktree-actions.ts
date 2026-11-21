import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ask } from "@tauri-apps/plugin-dialog";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { useOpenPullRequest } from "@/features/github/PullRequestList";
import { invalidateRepo, repoKey, useRefs } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { useNoticesStore } from "@/stores/notices-store";
import type { Worktree } from "@/types/git";

/** Git's report of a hook that refused the commit, merge or push (husky, a plain hook script). */
export const isHookFailure = (text: string) => /husky - |hook (?:script )?failed|pre-(?:commit|push)/i.test(text);

/**
 * An agent worktree's live status and the ways out of it: merge into the current branch, open a pull request,
 * or delete it. Shared by the conversation's worktree bar and the Parallel agents board.
 */
export function useWorktreeActions(repoPath: string, worktree: Worktree, title: string, running: boolean) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const current = useRefs(repoPath).data?.head.branch ?? null;
  const openPullRequest = useOpenPullRequest(repoPath).open;
  const status = useQuery({
    queryKey: ["agent-worktree", repoPath, worktree.path],
    queryFn: () => gitBackend.agentWorktreeStatus(repoPath, worktree.path),
    refetchInterval: running ? 5_000 : 30_000,
    retry: false,
  });
  const act = useMutation({
    mutationFn: (action: (skipHooks: boolean) => Promise<unknown>) => action(false),
    onSettled: () => {
      void invalidateRepo(client, repoPath);
      void client.invalidateQueries({ queryKey: ["agent-worktree", repoPath] });
      void client.invalidateQueries({ queryKey: ["agent-worktree-diff", repoPath] });
    },
    onError: (error, action) => {
      const { message, detail } = toGitError(error);
      // A hook that fails on the worktree's environment rather than the change (a build, a type check) can be
      // skipped, once, on the user's word: CI still runs every check on the pull request.
      const hookFailed = isHookFailure(`${message}\n${detail ?? ""}`);
      notify({
        tone: "error",
        title: t("action.failed", { action: t("worktree.failed"), message }),
        detail,
        action: hookFailed ? { label: t("worktree.skipHooks"), run: () => void retrySkippingHooks(action) } : undefined,
      });
    },
  });
  const retrySkippingHooks = async (action: (skipHooks: boolean) => Promise<unknown>) => {
    const sure = await ask(t("worktree.skipHooksConfirm"), { kind: "warning", okLabel: t("worktree.skipHooks") });
    if (!sure) return;
    act.mutate(() => action(true));
  };
  const merge = () =>
    act.mutate(async (skipHooks) => {
      await gitBackend.mergeAgentWorktree(repoPath, worktree.path, title, skipHooks);
      notify({ tone: "success", title: t("worktree.merged", { branch: worktree.branch }) });
    });
  const publish = () =>
    act.mutate(async (skipHooks) => {
      const url = await gitBackend.publishAgentWorktree(
        repoPath,
        worktree.path,
        title,
        t("worktree.prBody"),
        worktree.target,
        skipHooks,
      );
      // The worktree is gone (see worktrees.rs publish): the pull request opens on its page in the app.
      const prs = await client.fetchQuery({
        queryKey: [...repoKey(repoPath), "pull-requests"],
        queryFn: () => gitBackend.listPullRequests(repoPath),
        staleTime: 0,
      });
      const pr = prs.find((p) => p.url === url) ?? prs.find((p) => p.headRefName === worktree.branch);
      notify({
        tone: "success",
        title: t("worktree.published", { branch: worktree.branch }),
        detail: url,
        action: {
          label: t("worktree.openPr"),
          run: () => void (pr ? openPullRequest(pr) : url && gitBackend.openGithubUrl(url)),
        },
      });
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
