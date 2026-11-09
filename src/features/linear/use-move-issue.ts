import { useQueryClient } from "@tanstack/react-query";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { useNoticesStore } from "@/stores/notices-store";
import type { LinearCycle, LinearIssue } from "@/types/git";
import { columnKey, type ColumnKey } from "./board-columns";
import type { WorkspaceIssue } from "./linear-queries";

/**
 * Moves an issue to a board column: the state of that name in the issue's team, else the team's first state
 * of that type, as Linear does. The card moves at once; it goes back if Linear refuses.
 */
export function useMoveIssue() {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  return async (issue: WorkspaceIssue, column: ColumnKey) => {
    if (columnKey(issue.state) === columnKey(column)) return;
    const teams = await client.fetchQuery({
      queryKey: ["linear", "states", issue.orgId],
      queryFn: () => gitBackend.linearTeamStates(issue.orgId),
      staleTime: 10 * 60_000,
    });
    const states = teams.find((team) => team.id === issue.team.id)?.states.nodes ?? [];
    const target =
      states.find((s) => columnKey(s) === columnKey(column)) ??
      states.filter((s) => s.type === column.type).sort((a, b) => a.position - b.position)[0];
    if (!target) return;
    // Every list that may show the card: the user's issues, the open project's, the current cycles.
    const lists = { predicate: (q: { queryKey: readonly unknown[] }) => isIssueList(q.queryKey, issue.orgId) };
    const cycles = { queryKey: ["linear", "cycles", issue.orgId] };
    const before = [...client.getQueriesData<unknown>(lists), ...client.getQueriesData<unknown>(cycles)];
    const moved = (issues: LinearIssue[]) =>
      issues.map((i) => (i.id === issue.id ? { ...i, state: { ...target } } : i));
    client.setQueriesData<LinearIssue[]>(lists, (issues) => issues && moved(issues));
    client.setQueriesData<LinearCycle[]>(cycles, (list) => list?.map((c) => ({ ...c, issues: moved(c.issues) })));
    try {
      await gitBackend.linearSetIssueState(issue.orgId, issue.id, target.id);
      void client.invalidateQueries({ queryKey: ["linear", "issue", issue.orgId, issue.id] });
    } catch (error) {
      before.forEach(([key, data]) => client.setQueryData(key, data));
      notify({
        tone: "error",
        title: t("linear.moveFailed", { id: issue.identifier }),
        detail: toGitError(error).message,
      });
    }
  };
}

const isIssueList = (key: readonly unknown[], orgId: string) =>
  key[0] === "linear" && (key[1] === "issues" || key[1] === "project-issues") && key[2] === orgId;
