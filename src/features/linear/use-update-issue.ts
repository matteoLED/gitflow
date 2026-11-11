import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { useNoticesStore } from "@/stores/notices-store";
import type { LinearIssueDetail, LinearIssuePatch } from "@/types/git";
import { isIssueList } from "./use-move-issue";

/** What to send to Linear, and how the issue looks once it's done (shown at once). */
export type IssueUpdate = { patch: LinearIssuePatch; shown: Partial<LinearIssueDetail> };

/** Edits the open issue: the change shows at once, goes back if Linear refuses, then lists catch up. */
export function useUpdateIssue(orgId: string | undefined, issue: Pick<LinearIssueDetail, "id" | "identifier">) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const key = ["linear", "issue", orgId, issue.id];
  return useMutation({
    mutationFn: ({ patch }: IssueUpdate) => gitBackend.linearUpdateIssue(orgId ?? "", issue.id, patch),
    onMutate: async ({ shown }) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<LinearIssueDetail>(key);
      client.setQueryData<LinearIssueDetail>(key, (data) => data && { ...data, ...shown });
      return { before };
    },
    onError: (error, _, context) => {
      if (context?.before) client.setQueryData(key, context.before);
      notify({
        tone: "error",
        title: t("linear.updateFailed", { id: issue.identifier }),
        detail: toGitError(error).message,
      });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: ["linear", "cycles", orgId] });
      void client.invalidateQueries({ predicate: (q) => isIssueList(q.queryKey, orgId ?? "") });
    },
  });
}

/**
 * Saves a text after `delay` ms without typing, or at once on `flush` (blur, leaving the issue);
 * only when it differs from what was last saved (`baseline` sets that, e.g. the editor's own rendering).
 */
export function useAutosave(initial: string, save: (value: string) => void, delay = 800) {
  const saved = useRef(initial);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latestSave = useRef(save);
  useEffect(() => {
    latestSave.current = save;
  });
  const flush = () => {
    clearTimeout(timer.current);
    const value = pending.current;
    pending.current = null;
    if (value === null || value === saved.current) return;
    saved.current = value;
    latestSave.current(value);
  };
  const schedule = (value: string) => {
    pending.current = value;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };
  const baseline = (value: string) => {
    saved.current = value;
  };
  // Leaving the issue mid-sentence still saves it.
  useEffect(() => flush, []);
  return { schedule, flush, baseline };
}
