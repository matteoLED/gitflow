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
};

/** Runs a write operation, then refreshes everything about the repository and reports the outcome. */
export function useGitAction<TArgs = void>(repoPath: string, action: GitAction<TArgs>) {
  const queryClient = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  return useMutation({
    mutationFn: action.run,
    onSuccess: () => action.success && notify({ tone: "success", title: action.success }),
    onError: (error) => {
      const { message, detail } = toGitError(error);
      notify({ tone: "error", title: getT()("action.failed", { action: action.failure, message }), detail });
    },
    onSettled: () => invalidateRepo(queryClient, repoPath),
  });
}
