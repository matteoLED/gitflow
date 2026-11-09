import { useQueryClient } from "@tanstack/react-query";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { useNoticesStore } from "@/stores/notices-store";
import type { LinearIssue, LinearState } from "@/types/git";
import type { WorkspaceIssue } from "./linear-queries";

/**
 * Moves an issue to a board column (a state type): the team's first state of that type, as Linear does.
 * The card moves at once; it goes back if Linear refuses.
 */
export function useMoveIssue() {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  return async (issue: WorkspaceIssue, type: LinearState["type"]) => {
    if (issue.state.type === type) return;
    const teams = await client.fetchQuery({
      queryKey: ["linear", "states", issue.orgId],
      queryFn: () => gitBackend.linearTeamStates(issue.orgId),
      staleTime: 10 * 60_000,
    });
    const target = teams
      .find((team) => team.id === issue.team.id)
      ?.states.nodes.filter((s) => s.type === type)
      .sort((a, b) => a.position - b.position)[0];
    if (!target) return;
    const key = ["linear", "issues", issue.orgId];
    const before = client.getQueryData<LinearIssue[]>(key);
    client.setQueryData<LinearIssue[]>(key, (issues) =>
      issues?.map((i) =>
        i.id === issue.id ? { ...i, state: { name: target.name, type: target.type, color: target.color } } : i,
      ),
    );
    try {
      await gitBackend.linearSetIssueState(issue.orgId, issue.id, target.id);
      void client.invalidateQueries({ queryKey: ["linear", "issue", issue.orgId, issue.id] });
    } catch (error) {
      client.setQueryData(key, before);
      notify({
        tone: "error",
        title: t("linear.moveFailed", { id: issue.identifier }),
        detail: toGitError(error).message,
      });
    }
  };
}
