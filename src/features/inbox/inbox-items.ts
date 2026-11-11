import type { AgentRun } from "@/stores/agents-store";
import type { GithubNotification, LinearNotification, WorkflowRun } from "@/types/git";

/** Where an inbox item comes from, and what opening it needs. */
export type InboxTarget =
  | { kind: "github"; threadId: string; repo: string; subject: string; number: number | null; url: string }
  | { kind: "linear"; orgId: string; notificationId: string; issueId: string; identifier: string; url: string }
  | { kind: "agent"; runId: string }
  | { kind: "ci"; runId: number; url: string };

export type InboxSource = InboxTarget["kind"];

export type InboxItem = {
  /** Stable per thing. */
  key: string;
  /** Changes when the thing does: a done item comes back, a local read/unread mark lapses. */
  version: string;
  /** review_requested, issueNewComment, failed… */
  reason: string;
  title: string;
  /** Repository, issue id, agent or workflow, under the title. */
  context: string;
  at: string;
  unread: boolean;
  target: InboxTarget;
};

/** A choice the user made on an item, kept until the item changes. */
export type InboxMark = { version: string; state: "read" | "unread" | "done" };

const DAY = 86_400_000;
/** Local events (agent runs, CI failures) older than this aren't news anymore. */
const LOCAL_WINDOW = 3 * DAY;

export function fromGithub(list: GithubNotification[]): InboxItem[] {
  return list.map((n) => ({
    key: `github:${n.id}`,
    version: n.updatedAt,
    reason: n.reason,
    title: n.title,
    context: n.number ? `${n.repo}#${n.number}` : n.repo,
    at: n.updatedAt,
    unread: n.unread,
    target: { kind: "github", threadId: n.id, repo: n.repo, subject: n.kind, number: n.number, url: n.url },
  }));
}

export function fromLinear(orgId: string, list: LinearNotification[]): InboxItem[] {
  return list.map((n) => ({
    key: `linear:${n.id}`,
    version: n.updatedAt,
    reason: n.kind,
    title: n.title,
    context: n.actor ? `${n.identifier} · ${n.actor}` : n.identifier,
    at: n.updatedAt,
    unread: !n.read,
    target: {
      kind: "linear",
      orgId,
      notificationId: n.id,
      issueId: n.issueId,
      identifier: n.identifier,
      url: n.url,
    },
  }));
}

/** The latest finished run of each recent conversation of the repository. */
export function fromAgentRuns(runs: AgentRun[], repoPath: string, now: number): InboxItem[] {
  const seen = new Set<string>();
  const items: InboxItem[] = [];
  for (const run of runs) {
    if (run.repoPath !== repoPath || seen.has(run.thread)) continue;
    seen.add(run.thread);
    if ((run.status !== "done" && run.status !== "failed") || now - Date.parse(run.startedAt) > LOCAL_WINDOW) continue;
    items.push({
      key: `agent:${run.thread}`,
      version: `${run.id}:${run.status}`,
      reason: run.status,
      title: run.title,
      context: run.agent === "claude" ? "Claude Code" : "Codex",
      at: run.startedAt,
      unread: true,
      target: { kind: "agent", runId: run.id },
    });
  }
  return items;
}

/** Workflows whose latest finished run on a branch failed recently (a later success clears it). */
export function fromWorkflowRuns(runs: WorkflowRun[], now: number): InboxItem[] {
  const latest = new Map<string, WorkflowRun>();
  for (const run of runs) {
    if (run.status !== "completed") continue;
    const key = `${run.workflowName}\u0000${run.headBranch}`;
    const known = latest.get(key);
    if (!known || Date.parse(run.createdAt) > Date.parse(known.createdAt)) latest.set(key, run);
  }
  return [...latest.values()]
    .filter((run) => run.conclusion === "failure" && now - Date.parse(run.updatedAt) <= LOCAL_WINDOW)
    .map((run) => ({
      key: `ci:${run.databaseId}`,
      version: String(run.databaseId),
      reason: "failed",
      title: run.displayTitle,
      context: `${run.workflowName} · ${run.headBranch}`,
      at: run.updatedAt,
      unread: true,
      target: { kind: "ci", runId: run.databaseId, url: run.url },
    }));
}

/** Applies the user's marks (still current ones), drops done items, newest first. */
export function applyMarks(items: InboxItem[], marks: Record<string, InboxMark>): InboxItem[] {
  return items
    .flatMap((item) => {
      const mark = marks[item.key];
      if (!mark || mark.version !== item.version) return [item];
      if (mark.state === "done") return [];
      return [{ ...item, unread: mark.state === "unread" }];
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export type InboxFilter = { unreadOnly: boolean; source: InboxSource | null; query: string };

export function filterInbox(items: InboxItem[], { unreadOnly, source, query }: InboxFilter): InboxItem[] {
  const q = query.trim().toLowerCase();
  return items.filter(
    (i) =>
      (!unreadOnly || i.unread) &&
      (!source || i.target.kind === source) &&
      (!q || i.title.toLowerCase().includes(q) || i.context.toLowerCase().includes(q)),
  );
}
