import { startAgentRun } from "@/features/agents/use-agents";
import { useAgentsStore } from "@/stores/agents-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { AgentKind } from "@/types/git";

export type AgentIssue = {
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
    `Linear's branch name for it is \`${issue.branchName}\`; work on the current branch.`,
    "Start by reading the relevant code, then make the change with tests, and end with a short summary of what changed.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Starts Claude Code or Codex on the issue and shows the run; false when it couldn't start. */
export async function startIssueAgent(repoPath: string, agent: AgentKind, issue: AgentIssue) {
  const id = await startAgentRun(
    repoPath,
    agent,
    { kind: "custom", prompt: issuePrompt(issue) },
    `${issue.identifier} ${issue.title}`,
  );
  if (!id) return false;
  useAgentsStore.getState().select({ type: "run", id });
  useWorkspaceStore.getState().setView("agents");
  return true;
}
