import type { WorkflowRun } from "@/types/git";

export type Outcome = "success" | "failure" | "other" | "running";

export function outcomeOf(run: WorkflowRun): Outcome {
  if (run.status !== "completed") return "running";
  if (run.conclusion === "success") return "success";
  if (run.conclusion === "failure" || run.conclusion === "timed_out") return "failure";
  return "other";
}

/** Seconds from start to last update, for completed runs only. */
export function durationOf(run: WorkflowRun): number | null {
  if (run.status !== "completed") return null;
  const seconds = (Date.parse(run.updatedAt) - Date.parse(run.startedAt ?? run.createdAt)) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type Summary = { runs: number; success: number; failure: number; rate: number | null; median: number | null };

/** Success rate over decided runs (success + failure); cancelled and skipped ones don't count against it. */
export function summarize(runs: WorkflowRun[]): Summary {
  const success = runs.filter((r) => outcomeOf(r) === "success").length;
  const failure = runs.filter((r) => outcomeOf(r) === "failure").length;
  const decided = success + failure;
  return {
    runs: runs.length,
    success,
    failure,
    rate: decided ? success / decided : null,
    median: median(runs.map(durationOf).filter((d): d is number => d !== null)),
  };
}

export type Day = { day: string; success: number; failure: number; other: number };

/** Runs per day over the last `days` days (oldest first), by outcome. */
export function byDay(runs: WorkflowRun[], days: number, now = new Date()): Day[] {
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const buckets: Day[] = Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - (days - 1 - i));
    return { day: key(d), success: 0, failure: 0, other: 0 };
  });
  const index = new Map(buckets.map((b, i) => [b.day, i]));
  for (const run of runs) {
    const i = index.get(run.createdAt.slice(0, 10));
    const outcome = outcomeOf(run);
    if (i === undefined || outcome === "running") continue;
    buckets[i][outcome]++;
  }
  return buckets;
}

export type WorkflowStats = Summary & { name: string; last: WorkflowRun };

/** One row per workflow, most recently run first. */
export function byWorkflow(runs: WorkflowRun[]): WorkflowStats[] {
  const groups = new Map<string, WorkflowRun[]>();
  for (const run of runs) groups.set(run.workflowName, [...(groups.get(run.workflowName) ?? []), run]);
  return [...groups].map(([name, list]) => ({ name, last: list[0], ...summarize(list) }));
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
