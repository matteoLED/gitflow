import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { invalidateRepo, useOperation, useWorkingTree } from "@/lib/git-queries";
import { useNoticesStore } from "@/stores/notices-store";

/** The operation in progress and its conflicted files (straight from the working tree status). */
export function useConflicts(repoPath: string) {
  const operation = useOperation(repoPath).data ?? null;
  const tree = useWorkingTree(repoPath).data;
  const conflicted = (tree ?? []).filter((entry) => entry.conflicted).map((entry) => entry.path);
  return { operation, conflicted };
}

/** A git action on the operation; the whole repository refreshes after it, and a failure says why. */
export function useOperationAction(repoPath: string) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  return useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSettled: () => invalidateRepo(client, repoPath),
    onError: (error) => {
      const { message, detail } = toGitError(error);
      notify({ tone: "error", title: t("conflicts.failed"), detail: detail ? `${message}\n${detail}` : message });
    },
  });
}
