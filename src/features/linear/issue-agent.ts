import { startAgentRun } from "@/features/agents/use-agents";
import { getT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { useAgentsStore } from "@/stores/agents-store";
import { useNoticesStore } from "@/stores/notices-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { AgentKind } from "@/types/git";

export type AgentIssue = {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  branchName: string;
  labels?: { nodes: { name: string }[] };
};

/** What the agent is asked to do with an issue: implement it, with everything Linear knows. */
export function issuePrompt(issue: AgentIssue): string {
  const labels = issue.labels?.nodes ?? [];
  return [
    `Implement the Linear issue ${issue.identifier}: "${issue.title}".`,
    issue.description ? `Description:\n${issue.description}` : null,
    labels.length ? `Labels: ${labels.map((l) => l.name).join(", ")}.` : null,
    `You are in an isolated worktree, on a branch made for this issue from Linear's name for it (\`${issue.branchName}\`): work and commit there, don't switch branches.`,
    "Start by reading the relevant code, then make the change with tests, and end with a short summary of what changed.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Starts Claude Code or Codex on the issue in its own worktree, on Linear's branch for it, shows the run and
 * moves the issue to In Progress. False when the run couldn't start.
 */
export async function startIssueAgent(repoPath: string, agent: AgentKind, issue: AgentIssue, orgId?: string | null) {
  const title = `${issue.identifier} ${issue.title}`;
  const task = { kind: "custom" as const, prompt: issuePrompt(issue) };
  const id = await startAgentRun(repoPath, agent, task, title, undefined, [], undefined, issue.branchName);
  if (!id) return false;
  useAgentsStore.getState().select({ type: "run", id });
  useWorkspaceStore.getState().setView("agents");
  if (orgId) void markStarted(orgId, issue);
  return true;
}

/** Moves a backlog or to-do issue to its team's first "started" state; a failure is only notified. */
async function markStarted(orgId: string, issue: AgentIssue) {
  try {
    const { state, team } = await gitBackend.linearIssue(orgId, issue.id);
    if (state.type !== "backlog" && state.type !== "unstarted") return;
    const teams = await gitBackend.linearTeamStates(orgId);
    const started = (teams.find((t) => t.id === team.id)?.states.nodes ?? [])
      .filter((s) => s.type === "started")
      .sort((a, b) => a.position - b.position)[0];
    if (started) await gitBackend.linearSetIssueState(orgId, issue.id, started.id);
  } catch (error) {
    useNoticesStore.getState().notify({
      tone: "error",
      title: getT()("linear.moveFailed", { id: issue.identifier }),
      detail: toGitError(error).message,
    });
  }
}
