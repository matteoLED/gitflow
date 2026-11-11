import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateRepo } from "@/lib/git-queries";
import { toGitError } from "@/lib/errors";
import { useNoticesStore } from "@/stores/notices-store";
import { getT } from "@/i18n";

type GitAction<TArgs> = {
  run: (args: TArgs) => Promise<unknown>;
  /** Shown on success; omit for frequent actions like staging. */
  success?: string;
  failure: string;
  /** Shown with a spinner while it runs (long network operations), then turned into the outcome. */
  pending?: string;
};

/** Runs a write operation, then refreshes everything about the repository and reports the outcome. */
export function useGitAction<TArgs = void>(repoPath: string, action: GitAction<TArgs>) {
  const queryClient = useQueryClient();
  const { notify, update, dismiss } = useNoticesStore.getState();
  return useMutation({
    mutationFn: action.run,
    onMutate: () => (action.pending ? notify({ tone: "loading", title: action.pending }) : undefined),
    onSuccess: (_data, _args, loading) => {
      if (!action.success) return loading !== undefined && dismiss(loading);
      const notice = { tone: "success", title: action.success } as const;
      if (loading === undefined) notify(notice);
      else update(loading, notice);
    },
    onError: (error, _args, loading) => {
      const { message, detail } = toGitError(error);
      const notice = {
        tone: "error",
        title: getT()("action.failed", { action: action.failure, message }),
        detail,
      } as const;
      if (loading === undefined) notify(notice);
      else update(loading, notice);
    },
    onSettled: () => invalidateRepo(queryClient, repoPath),
  });
}
