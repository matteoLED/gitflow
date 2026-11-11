import { useState } from "react";
import { Activity, ChevronLeft, CircleCheck, CircleMinus, CircleX } from "lucide-react";
import { PanelHeader, PanelLoading } from "@/components/layout/panel";
import { DataUnavailable, EmptyState } from "@/components/states";
import { useT } from "@/i18n";
import { formatAge } from "@/lib/format-date";
import { useWorkflowRuns } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useCiStore } from "@/stores/ci-store";
import type { WorkflowRun } from "@/types/git";
import { StatusIcon, ghStatus } from "@/features/agents/status";
import { RunDetail } from "@/features/github/PullRequestCi";
import { byDay, byWorkflow, durationOf, formatDuration, summarize, type Day } from "./ci-stats";

const ACTIONS_QUICKSTART = "https://docs.github.com/actions/writing-workflows/quickstart";

/**
 * Outcome colors, validated with the dataviz checker on the dark surface: blue/orange stay apart under
 * every color-vision deficiency (red/green doesn't); gray is the neutral "cancelled / skipped".
 */
const OUTCOME = { success: "#3e8fd9", failure: "#e0703c", other: "#6b6d75" } as const;

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="surface px-4 py-3">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-[24px] font-semibold tracking-tight tabular-nums", tone)}>{value}</p>
      {hint && <p className="text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Legend() {
  const t = useT();
  const items = [
    { key: "success", Icon: CircleCheck, label: t("ci.success") },
    { key: "failure", Icon: CircleX, label: t("ci.failure") },
    { key: "other", Icon: CircleMinus, label: t("ci.other") },
  ] as const;
  return (
    <ul className="flex gap-4 text-[12px] text-muted-foreground">
      {items.map(({ key, Icon, label }) => (
        <li key={key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: OUTCOME[key] }} />
          <Icon aria-hidden className="size-3" />
          {label}
        </li>
      ))}
    </ul>
  );
}

/** Runs per day, stacked by outcome; each day's column carries its own tooltip. */
function DailyChart({ days }: { days: Day[] }) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.success + d.failure + d.other));
  const H = 120;
  return (
    <figure className="surface px-4 pt-3 pb-3">
      <figcaption className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-medium">{t("ci.perDay")}</span>
        <Legend />
      </figcaption>
      <div className="relative">
        <div className="flex items-end gap-1.5 border-b border-white/[0.1]" style={{ height: H }}>
          {days.map((d, i) => {
            const total = d.success + d.failure + d.other;
            const parts = (["success", "failure", "other"] as const).filter((k) => d[k] > 0);
            return (
              <div
                key={d.day}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                aria-label={`${d.day}: ${d.success} ${t("ci.success")}, ${d.failure} ${t("ci.failure")}, ${d.other} ${t("ci.other")}`}
                className={cn(
                  "flex h-full flex-1 flex-col-reverse justify-start gap-[2px] rounded-t-[4px]",
                  hover === i && "bg-white/[0.04]",
                )}
              >
                {parts.map((k, j) => (
                  <span
                    key={k}
                    className={cn(j === parts.length - 1 && "rounded-t-[4px]")}
                    style={{ height: (d[k] / max) * (H - 4), background: OUTCOME[k] }}
                  />
                ))}
                {total === 0 && <span className="h-px bg-white/10" />}
              </div>
            );
          })}
        </div>
        {hover !== null && (
          <div
            role="tooltip"
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-white/10 bg-popover px-2.5 py-1.5 text-[12px] whitespace-nowrap shadow-xl"
            style={{ left: `${((hover + 0.5) / days.length) * 100}%` }}
          >
            <p className="mb-0.5 font-medium">
              {new Date(days[hover].day).toLocaleDateString(t.locale, {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </p>
            <p className="text-muted-foreground">
              {days[hover].success} {t("ci.success")} · {days[hover].failure} {t("ci.failure")} · {days[hover].other}{" "}
              {t("ci.other")}
            </p>
          </div>
        )}
        <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
          <span>{new Date(days[0].day).toLocaleDateString(t.locale, { day: "numeric", month: "short" })}</span>
          <span>{t("common.today")}</span>
        </div>
      </div>
    </figure>
  );
}

function WorkflowTable({ runs }: { runs: WorkflowRun[] }) {
  const t = useT();
  const setWorkflow = useCiStore((s) => s.setWorkflow);
  const rows = byWorkflow(runs);
  return (
    <div className="surface overflow-hidden">
      <table className="w-full text-[13px]">
        <thead className="text-[12px] text-muted-foreground">
          <tr className="border-b border-white/[0.06]">
            <th className="px-4 py-2 text-left font-normal">{t("ci.workflow")}</th>
            <th className="px-3 py-2 text-right font-normal">{t("ci.runs")}</th>
            <th className="px-3 py-2 text-right font-normal">{t("ci.successRate")}</th>
            <th className="px-3 py-2 text-right font-normal">{t("ci.median")}</th>
            <th className="px-4 py-2 text-right font-normal">{t("ci.last")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.name}
              onClick={() => setWorkflow(row.name)}
              className="cursor-pointer border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03]"
            >
              <td className="px-4 py-2">
                <span className="flex items-center gap-2">
                  <StatusIcon status={ghStatus(row.last.status, row.last.conclusion)} />
                  {row.name}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{row.runs}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-14 overflow-hidden rounded-full bg-white/[0.08]">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${(row.rate ?? 0) * 100}%`, background: OUTCOME.success }}
                    />
                  </span>
                  {row.rate === null ? "—" : `${Math.round(row.rate * 100)}%`}
                </span>
              </td>
              <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{formatDuration(row.median)}</td>
              <td className="px-4 py-2 text-right text-muted-foreground">
                {formatAge(row.last.createdAt, undefined, t.locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentRuns({ runs }: { runs: WorkflowRun[] }) {
  const t = useT();
  const openRun = useCiStore((s) => s.openRun);
  return (
    <ul className="surface divide-y divide-white/[0.04] overflow-hidden">
      {runs.slice(0, 15).map((run) => (
        <li key={run.databaseId}>
          <button
            type="button"
            onClick={() => openRun(run.databaseId)}
            className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-white/[0.03]"
          >
            <StatusIcon status={ghStatus(run.status, run.conclusion)} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{run.displayTitle}</span>
              <span className="block truncate text-[12px] text-muted-foreground">
                {run.workflowName} · {run.headBranch} · {run.event}
              </span>
            </span>
            <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
              {formatDuration(durationOf(run))}
            </span>
            <span className="w-16 shrink-0 text-right text-[12px] text-muted-foreground">
              {formatAge(run.createdAt, undefined, t.locale)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** CI page: health of the repository's GitHub Actions, then any run in detail. */
export function CiPage({ repoPath }: { repoPath: string }) {
  const t = useT();
  const { workflow, run: openRun, openRun: setRun } = useCiStore();
  const runs = useWorkflowRuns(repoPath);
  // Fixed when the page opens: the 7-day window doesn't drift between renders.
  const [now] = useState(() => Date.now());
  if (openRun !== null) {
    return (
      <section className="flex h-full flex-col">
        <PanelHeader className="gap-1.5 text-[13px]">
          <button
            type="button"
            onClick={() => setRun(null)}
            className="-ml-1.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
          >
            <ChevronLeft aria-hidden className="size-3.5" />
            CI
          </button>
        </PanelHeader>
        <RunDetail key={openRun} repoPath={repoPath} id={openRun} />
      </section>
    );
  }
  if (runs.isError)
    return <DataUnavailable title={t("agents.actionsError")} error={runs.error} onRetry={() => void runs.refetch()} />;
  if (!runs.data) return <PanelLoading title={t("common.loading")} variant="grid-syncing" />;
  const shown = workflow ? runs.data.filter((r) => r.workflowName === workflow) : runs.data;
  if (runs.data.length === 0)
    return (
      <EmptyState
        icon={<Activity />}
        title={t("ci.noRuns")}
        hint={t("ci.noRunsHint")}
        action={{ label: t("ci.setUp"), onClick: () => void gitBackend.openGithubUrl(ACTIONS_QUICKSTART) }}
      />
    );
  const weekAgo = now - 7 * 86_400_000;
  const week = summarize(shown.filter((r) => Date.parse(r.createdAt) >= weekAgo));
  const failingNow = byWorkflow(runs.data).filter((w) => w.last.conclusion === "failure");
  return (
    <section aria-label="CI" className="flex h-full flex-col">
      <PanelHeader className="gap-1.5 text-[13px]">
        <Activity aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">CI</span>
        <span className="text-muted-foreground/60">/</span>
        <span className="font-medium">{workflow ?? t("ci.allWorkflows")}</span>
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-12">
        <div className="mx-auto max-w-[1040px] pt-8">
          <h1 className="font-display text-[28px]">{workflow ?? t("ci.title")}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{t("ci.subtitle", { count: shown.length })}</p>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label={t("ci.successRate7d")}
              value={week.rate === null ? "—" : `${Math.round(week.rate * 100)}%`}
              hint={t("ci.decided", { success: week.success, failure: week.failure })}
            />
            <Kpi label={t("ci.runs7d")} value={String(week.runs)} />
            <Kpi label={t("ci.median")} value={formatDuration(week.median)} hint={t("ci.medianHint")} />
            <Kpi
              label={t("ci.failingNow")}
              value={String(failingNow.length)}
              hint={failingNow.map((w) => w.name).join(", ") || t("ci.allGreen")}
              tone={failingNow.length ? "text-[#e0703c]" : undefined}
            />
          </div>
          <div className="mt-4">
            <DailyChart days={byDay(shown, 14)} />
          </div>
          {!workflow && (
            <section className="mt-8">
              <h2 className="mb-2 text-[13px] font-medium">{t("ci.workflows")}</h2>
              <WorkflowTable runs={runs.data} />
            </section>
          )}
          <section className="mt-8">
            <h2 className="mb-2 text-[13px] font-medium">{t("ci.recent")}</h2>
            <RecentRuns runs={shown} />
          </section>
        </div>
      </div>
    </section>
  );
}

/** List column of the CI page: every workflow with its success rate. */
export function CiList({ repoPath, query }: { repoPath: string; query: string }) {
  const t = useT();
  const { workflow, setWorkflow } = useCiStore();
  const runs = useWorkflowRuns(repoPath).data ?? [];
  const rows = byWorkflow(runs).filter((w) => !query || w.name.toLowerCase().includes(query.toLowerCase()));
  const row = (name: string | null, label: string, rate: number | null, status?: WorkflowRun) => (
    <li key={name ?? "all"}>
      <button
        type="button"
        aria-current={workflow === name ? "true" : undefined}
        onClick={() => setWorkflow(name)}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-white/[0.06] aria-[current=true]:bg-white/[0.08]"
      >
        {status ? (
          <StatusIcon status={ghStatus(status.status, status.conclusion)} />
        ) : (
          <Activity aria-hidden className="size-3.5 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {rate !== null && (
          <span className="text-[12px] text-muted-foreground tabular-nums">{Math.round(rate * 100)}%</span>
        )}
      </button>
    </li>
  );
  return (
    <ul className="min-h-0 flex-1 space-y-px overflow-y-auto px-2 pt-1 pb-2">
      {row(null, t("ci.allWorkflows"), summarize(runs).rate)}
      {rows.map((w) => row(w.name, w.name, w.rate, w.last))}
    </ul>
  );
}
