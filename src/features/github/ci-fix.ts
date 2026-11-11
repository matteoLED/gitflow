import { startAgentRun } from "@/features/agents/use-agents";
import { gitBackend } from "@/lib/tauri-git";
import { useAgentsStore } from "@/stores/agents-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cleanLine, logByStep } from "./PullRequestCi";

/** Enough of a log for the agent to see the error, small enough to keep the prompt cheap. */
export const MAX_LOG = 12_000;

/** A failing check or job, and where its log is. */
export type CiFailure = { name: string; workflow: string | null; jobId: number | null; runId: number | null };

export type CiFixTarget = {
  branch: string;
  pr: { number: number; title: string } | null;
  failures: CiFailure[];
};

/** The end of a log (where the error is), cut at a line start, at most `max` characters. */
export function logTail(log: string, max = MAX_LOG): string {
  const text = log.trim();
  if (text.length <= max) return text;
  const tail = text.slice(-max);
  const start = tail.indexOf("\n");
  return `…\n${start >= 0 ? tail.slice(start + 1) : tail}`;
}

/** The fix request: what fails, where, its log excerpts (null when unavailable), and how to work. */
export function ciFixPrompt(target: CiFixTarget, logs: (string | null)[]): string {
  const where = target.pr
    ? `pull request #${target.pr.number} ("${target.pr.title}", branch \`${target.branch}\`)`
    : `branch \`${target.branch}\``;
  const budget = Math.floor(MAX_LOG / Math.max(1, target.failures.length));
  const sections = target.failures.map((f, i) => {
    const title = f.workflow ? `${f.workflow} / ${f.name}` : f.name;
    const log = logs[i];
    if (log?.trim()) return `## ${title}\nEnd of the failing log:\n\`\`\`\`\n${logTail(log, budget)}\n\`\`\`\``;
    const how = f.runId !== null ? ` Read it with \`gh run view ${f.runId} --log-failed\`.` : "";
    return `## ${title}\nNo log could be loaded.${how}`;
  });
  return [
    `CI fails on ${where}. You're in a worktree checked out at the commit that failed.`,
    ...sections,
    "Reproduce the failure locally, fix its root cause (not the symptom, and don't weaken or skip the test), " +
      "run the relevant tests until they pass, then summarize the cause and the fix.",
  ].join("\n\n");
}

/** The failed steps' output as plain text; null when the log can't be read. */
async function failedLog(repoPath: string, jobId: number | null): Promise<string | null> {
  if (jobId === null) return null;
  try {
    const log = await gitBackend.getJobLog(repoPath, jobId, true);
    return logByStep(log)
      .flatMap((g) => g.lines.map(cleanLine))
      .join("\n");
  } catch {
    return null; // the prompt then tells the agent how to read it itself
  }
}

/**
 * Starts the preferred agent on the failures, in a new worktree from `base` (the failing commit) in a mode that
 * can edit, then shows the run. False when it couldn't start (the reason was notified).
 */
export async function fixCiWithAgent(repoPath: string, target: CiFixTarget, base: string) {
  const logs = await Promise.all(target.failures.map((f) => failedLog(repoPath, f.jobId)));
  const names = target.failures.map((f) => f.name).join(", ");
  const title = target.pr ? `Fix CI of #${target.pr.number}: ${names}` : `Fix CI on ${target.branch}: ${names}`;
  const { preferredAgent } = useAgentsStore.getState();
  const task = { kind: "custom", prompt: ciFixPrompt(target, logs) } as const;
  const id = await startAgentRun(repoPath, preferredAgent, task, title, undefined, [], undefined, undefined, {
    commit: base,
    target: target.branch,
  });
  if (!id) return false;
  useAgentsStore.getState().select({ type: "run", id });
  useWorkspaceStore.getState().setView("agents");
  return true;
}
