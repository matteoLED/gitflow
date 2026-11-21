import { useRef, useState } from "react";
import { Delta, MiniStat, useChartTip } from "@/components/charts";
import { useT } from "@/i18n";
import { formatAge } from "@/lib/format-date";
import { useWorkflowRuns } from "@/lib/git-queries";
import { cn } from "@/lib/utils";
import type { WorkflowJob, WorkflowRun } from "@/types/git";
import { durationOf, formatDuration, median, outcomeOf } from "./ci-stats";

const HISTORY = 30;
const TICKS = [0, 0.25, 0.5, 0.75, 1];

type Span = { job: WorkflowJob; start: number; end: number; running: boolean };

/** Each job on the run's time axis (ms from the run's start); a running job ends now. */
function spansOf(run: WorkflowRun, now: number): { origin: number; spans: Span[] } {
  const origin = Date.parse(run.startedAt ?? run.createdAt);
  const spans = (run.jobs ?? []).flatMap((job) => {
    const start = Date.parse(job.startedAt) - origin;
    if (!Number.isFinite(start) || start < 0) return [];
    const done = Date.parse(job.completedAt) - origin;
    const running = job.status !== "completed" || !(done >= start);
    return [{ job, start, end: running ? now - origin : done, running }];
  });
  return { origin, spans };
}

/**
 * A run at a glance, above its jobs: key figures against the workflow's usual, the jobs on one timeline (where the
 * time went, what failed), and the workflow's recent runs to see whether this one is an outlier.
 */
export function RunOverview({
  repoPath,
  run,
  onJob,
  onOpenRun,
}: {
  repoPath: string;
  run: WorkflowRun;
  /** Scrolls to a job's logs. */
  onJob: (job: WorkflowJob) => void;
  /** Opens another run of the workflow (the CI page); absent where runs can't be switched. */
  onOpenRun?: (id: number) => void;
}) {
  const t = useT();
  const [now] = useState(Date.now);
  const all = useWorkflowRuns(repoPath).data ?? [];
  const history = all
    .filter((r) => r.workflowName === run.workflowName)
    .slice(0, HISTORY)
    .reverse();
  const usual = median(history.map(durationOf).filter((d): d is number => d !== null));
  const { origin, spans } = spansOf(run, now);
  const total = Math.max(1, ...spans.map((s) => s.end));
  const seconds = total / 1000;
  const failed = spans.filter((s) => s.job.conclusion === "failure" || s.job.conclusion === "timed_out").length;
  const passed = spans.filter((s) => s.job.conclusion === "success").length;
  const slowest = spans.reduce<Span | null>((a, b) => (!a || b.end - b.start > a.end - a.start ? b : a), null);
  const firstStart = spans.length ? Math.min(...spans.map((s) => s.start)) : null;
  const queued = firstStart === null ? null : (origin + firstStart - Date.parse(run.createdAt)) / 1000;
  if (spans.length === 0) return null;
  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MiniStat
          label={t("run.duration")}
          value={
            <span className="flex items-center gap-1.5">
              {formatDuration(seconds)}
              {usual !== null && run.status === "completed" && (
                <Delta value={Math.round(((seconds - usual) / usual) * 100)} invert />
              )}
            </span>
          }
        />
        <MiniStat
          label={t("run.jobs")}
          value={
            <span className={cn(failed > 0 && "text-removed-foreground")}>
              {failed > 0
                ? t("run.jobsFailed", { failed, count: spans.length })
                : t("run.jobsPassed", { passed, count: spans.length })}
            </span>
          }
        />
        <MiniStat
          label={t("run.slowest")}
          value={slowest && `${slowest.job.name} · ${formatDuration((slowest.end - slowest.start) / 1000)}`}
        />
        <MiniStat label={t("run.queued")} value={queued === null || queued < 0 ? "—" : formatDuration(queued)} />
      </div>
      <JobTimeline spans={spans} total={total} slowest={slowest} onJob={onJob} />
      {history.length > 1 && (
        <DurationHistory runs={history} current={run.databaseId} usual={usual} onOpenRun={onOpenRun} />
      )}
    </div>
  );
}

/** The jobs as bars on the run's clock: failed in red, the slowest in amber, running ones pulsing. */
function JobTimeline({
  spans,
  total,
  slowest,
  onJob,
}: {
  spans: Span[];
  total: number;
  slowest: Span | null;
  onJob: (job: WorkflowJob) => void;
}) {
  const t = useT();
  const frame = useRef<HTMLDivElement>(null);
  const tip = useChartTip(frame);
  const pct = (ms: number) => `${(ms / total) * 100}%`;
  return (
    <section className="surface p-4">
      <h3 className="text-[12.5px] font-medium text-muted-foreground">{t("run.timeline")}</h3>
      <div ref={frame} className="relative mt-3" onPointerLeave={tip.hide}>
        <div className="grid grid-cols-[minmax(0,9rem)_1fr_3.5rem] gap-x-3 pb-1.5 text-[11px] text-muted-foreground">
          <span />
          <span className="relative h-3">
            {TICKS.map((f) => (
              <span
                key={f}
                className={cn("absolute tabular-nums", f === 1 ? "-translate-x-full" : f > 0 && "-translate-x-1/2")}
                style={{ left: `${f * 100}%` }}
              >
                {formatDuration((total * f) / 1000)}
              </span>
            ))}
          </span>
          <span />
        </div>
        <ol>
          {spans.map((s) => {
            const failed = s.job.conclusion === "failure" || s.job.conclusion === "timed_out";
            const hot = !failed && s === slowest;
            const time = formatDuration((s.end - s.start) / 1000);
            return (
              <li key={s.job.url || s.job.name}>
                <button
                  type="button"
                  onClick={() => onJob(s.job)}
                  onPointerEnter={(e) =>
                    tip.over(e.currentTarget.querySelector("[data-bar]") ?? e.currentTarget, {
                      label: s.job.name,
                      value: s.running ? t("run.runningFor", { time }) : time,
                      detail: t("run.startedAt", { time: formatDuration(s.start / 1000) }),
                    })
                  }
                  className={cn(
                    "grid w-full grid-cols-[minmax(0,9rem)_1fr_3.5rem] items-center gap-x-3 rounded-md py-1 text-left text-[12.5px] outline-none hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring",
                    failed && "bg-removed/[0.08]",
                    hot && "bg-amber-400/[0.07]",
                  )}
                >
                  <span className={cn("truncate pl-2", failed ? "text-removed-foreground" : hot && "text-amber-300")}>
                    {s.job.name}
                  </span>
                  <span className="relative h-2">
                    {TICKS.slice(1, -1).map((f) => (
                      <span
                        key={f}
                        aria-hidden
                        className="absolute -inset-y-1.5 border-l border-dashed border-white/[0.07]"
                        style={{ left: `${f * 100}%` }}
                      />
                    ))}
                    <span
                      data-bar
                      className={cn(
                        "absolute inset-y-0 rounded-full",
                        failed
                          ? "bg-removed"
                          : hot
                            ? "bg-amber-400"
                            : s.running
                              ? "animate-pulse bg-primary"
                              : "bg-white/30",
                      )}
                      style={{ left: pct(s.start), width: `max(4px, ${pct(s.end - s.start)})` }}
                    />
                  </span>
                  <span
                    className={cn(
                      "pr-2 text-right tabular-nums",
                      failed ? "text-removed-foreground" : hot ? "text-amber-300" : "text-muted-foreground",
                    )}
                  >
                    {time}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {tip.node}
      </div>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
        <Key className="bg-amber-400">{t("run.keySlowest")}</Key>
        <Key className="bg-removed">{t("run.keyFailed")}</Key>
        <Key className="bg-white/30">{t("run.keyOther")}</Key>
      </p>
    </section>
  );
}

function Key({ className, children }: { className: string; children: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-1 w-3 rounded-full", className)} />
      {children}
    </span>
  );
}

/** The workflow's latest runs by duration, oldest first: this one highlighted, the median dashed across. */
function DurationHistory({
  runs,
  current,
  usual,
  onOpenRun,
}: {
  runs: WorkflowRun[];
  current: number;
  usual: number | null;
  onOpenRun?: (id: number) => void;
}) {
  const t = useT();
  const frame = useRef<HTMLDivElement>(null);
  const tip = useChartTip(frame);
  const durations = runs.map(durationOf);
  const max = Math.max(1, ...durations.map((d) => d ?? 0));
  const decided = runs.filter((r) => ["success", "failure"].includes(outcomeOf(r)));
  const rate = decided.length
    ? Math.round((decided.filter((r) => outcomeOf(r) === "success").length / decided.length) * 100)
    : null;
  return (
    <section className="surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[12.5px] font-medium text-muted-foreground">{t("run.history", { count: runs.length })}</h3>
        <span className="text-[11.5px] text-muted-foreground">
          {t("run.historyHint", { median: formatDuration(usual), rate: rate ?? "—" })}
        </span>
      </div>
      <div ref={frame} className="relative mt-3 flex h-20 items-end gap-[3px]" onPointerLeave={tip.hide}>
        {usual !== null && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/25"
            style={{ bottom: `${(usual / max) * 100}%` }}
          />
        )}
        {runs.map((r, i) => {
          const d = durations[i];
          const outcome = outcomeOf(r);
          const isCurrent = r.databaseId === current;
          return (
            <button
              key={r.databaseId}
              type="button"
              disabled={!onOpenRun || isCurrent}
              onClick={() => onOpenRun?.(r.databaseId)}
              onPointerEnter={(e) =>
                tip.over(e.currentTarget.firstElementChild ?? e.currentTarget, {
                  label: r.displayTitle.length > 48 ? `${r.displayTitle.slice(0, 47)}…` : r.displayTitle,
                  value: d === null ? t("run.inProgress") : formatDuration(d),
                  detail: `${r.headBranch} · ${formatAge(r.createdAt, undefined, t.locale)}`,
                })
              }
              className="group/bar flex h-full min-w-0 flex-1 flex-col justify-end outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn(
                  "block rounded-[3px] transition-opacity",
                  outcome === "failure"
                    ? "bg-removed"
                    : outcome === "running"
                      ? "animate-pulse bg-primary"
                      : outcome === "success"
                        ? "bg-primary"
                        : "bg-white/25",
                  isCurrent
                    ? "opacity-100 ring-2 ring-foreground/70 ring-offset-1 ring-offset-card"
                    : "opacity-50 group-hover/bar:opacity-90",
                )}
                style={{ height: `${Math.max(4, ((d ?? max * 0.1) / max) * 100)}%` }}
              />
            </button>
          );
        })}
        {tip.node}
      </div>
    </section>
  );
}
