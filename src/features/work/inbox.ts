import type { AgentRun } from "@/stores/agents-store";
import type { LinearIssue } from "@/types/git";
import type { WorkItem } from "./work-items";

/** Why something is in the inbox, most pressing first. */
export type InboxReason = "ciFailed" | "changesRequested" | "review" | "ready" | "agentFinished" | "urgentIssue";
const ORDER: InboxReason[] = ["ciFailed", "changesRequested", "review", "ready", "urgentIssue", "agentFinished"];

export type InboxItem = {
  /** Stable per thing and per state: a dismissed item comes back when it changes. */
  key: string;
  version: string;
  reason: InboxReason;
  title: string;
  /** Branch, issue id or agent, under the title. */
  detail: string;
  at: string;
  work?: WorkItem;
  issue?: LinearIssue;
  run?: AgentRun;
};

type Sources = {
  work: WorkItem[];
  /** GitHub login of the user; unknown, every pull request counts as someone else's. */
  me: string | null;
  issues: LinearIssue[];
  runs: AgentRun[];
  now?: number;
};

const DAY = 86_400_000;

/** What needs the user now, across Git, GitHub, Linear and the agents — Linear's Inbox for the whole workflow. */
export function inboxItems({ work, me, issues, runs, now = Date.now() }: Sources): InboxItem[] {
  const items: InboxItem[] = [];
  for (const w of work) {
    const pr = w.pr?.state === "OPEN" ? w.pr : null;
    const mine = !!w.local || (!!me && pr?.author.login === me);
    const base = { title: w.title, detail: w.branch, at: w.updatedAt, work: w };
    if (mine && w.ci === "failure")
      items.push({ ...base, key: `ci:${w.branch}`, version: w.updatedAt, reason: "ciFailed" });
    if (!pr) continue;
    const version = `${pr.updatedAt}:${pr.reviewDecision}`;
    if (mine && pr.reviewDecision === "CHANGES_REQUESTED")
      items.push({ ...base, key: `pr:${pr.number}`, version, reason: "changesRequested" });
    else if (mine && pr.reviewDecision === "APPROVED" && w.ci !== "failure")
      items.push({ ...base, key: `pr:${pr.number}`, version, reason: "ready" });
    // A teammate's pull request waits on the user unless it's approved, a draft, or back with its author.
    else if (!mine && !pr.isDraft && pr.reviewDecision !== "APPROVED" && pr.reviewDecision !== "CHANGES_REQUESTED")
      items.push({ ...base, key: `pr:${pr.number}`, version, reason: "review" });
  }
  for (const issue of issues) {
    const open = issue.state.type !== "completed" && issue.state.type !== "canceled";
    if (open && (issue.priority === 1 || issue.priority === 2))
      items.push({
        key: `issue:${issue.id}`,
        version: issue.updatedAt,
        reason: "urgentIssue",
        title: issue.title,
        detail: issue.identifier,
        at: issue.updatedAt,
        issue,
      });
  }
  // Conversations that finished in the last day: one entry per conversation, its latest run.
  const latest = new Map<string, AgentRun>();
  for (const run of runs) if (!latest.has(run.thread)) latest.set(run.thread, run);
  for (const run of latest.values()) {
    if ((run.status === "done" || run.status === "failed") && now - new Date(run.startedAt).getTime() < DAY)
      items.push({
        key: `run:${run.thread}`,
        version: `${run.id}:${run.status}`,
        reason: "agentFinished",
        title: run.title,
        detail: run.agent === "claude" ? "Claude Code" : "Codex",
        at: run.startedAt,
        run,
      });
  }
  return items.sort((a, b) => ORDER.indexOf(a.reason) - ORDER.indexOf(b.reason) || b.at.localeCompare(a.at));
}

/** Items not dismissed, or changed since they were. */
export const unread = (items: InboxItem[], dismissed: Record<string, string>) =>
  items.filter((i) => dismissed[i.key] !== i.version);
