import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ExternalLink, MousePointer2, RefreshCw } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { PanelLoading } from "@/components/layout/panel";
import { DataUnavailable, EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { formatAge } from "@/lib/format-date";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useNoticesStore } from "@/stores/notices-store";
import type { PullRequestDetails, WorkflowJob, WorkflowRun } from "@/types/git";
import { StatusIcon, ghStatus } from "@/features/agents/status";
import { parseAnsi, stripAnsi } from "./ansi";
import { checkOutcome, resolveWithAgent } from "./ChecksMenu";
import { JobLogView } from "./JobLog";

export const jobIdOf = (job: WorkflowJob) => Number(job.url.match(/\/job\/(\d+)/)?.[1] ?? 0) || null;

function duration(start: string, end: string): string | null {
  const seconds = Math.round((Date.parse(end) - Date.parse(start)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** `gh run view --log` lines are "job<TAB>step<TAB>timestamp text": grouped by step, timestamps dropped. */
export function logByStep(log: string): { step: string; lines: string[] }[] {
  const groups: { step: string; lines: string[] }[] = [];
  for (const raw of log.split("\n")) {
    if (!raw) continue;
    const [, step = "", rest = raw] = raw.split("\t");
    // Timestamps are noise; ANSI colors stay, they're rendered.
    const line = rest.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "");
    const last = groups[groups.length - 1];
    if (last?.step === step) last.lines.push(line);
    else groups.push({ step, lines: [line] });
  }
  return groups;
}

export const cleanLine = (line: string) => stripAnsi(line).replace(/##\[(error|warning|group|endgroup)\]/, "");

const FG = [
  "text-zinc-500",
  "text-removed-foreground",
  "text-added-foreground",
  "text-amber-300",
  "text-sky-400",
  "text-fuchsia-400",
  "text-cyan-400",
  "text-foreground",
];
const BG = [
  "bg-white/10",
  "bg-red-500/25",
  "bg-emerald-500/20",
  "bg-amber-400/15",
  "bg-sky-500/20",
  "bg-fuchsia-500/20",
  "bg-cyan-500/20",
  "bg-white/15",
];

/** A log line in its terminal colors. */
export function AnsiLine({ line }: { line: string }) {
  return parseAnsi(line.replace(/##\[(error|warning|group|endgroup)\]/, "")).map((span, i) => (
    <span
      key={i}
      className={cn(
        span.fg !== undefined && FG[span.fg],
        span.bg !== undefined && cn(BG[span.bg], "rounded-[2px] px-0.5"),
        span.bold && "font-semibold",
        span.dim && "opacity-60",
      )}
    >
      {span.text}
    </span>
  ));
}

function Job({ repoPath, job }: { repoPath: string; job: WorkflowJob }) {
  const [open, setOpen] = useState(job.conclusion === "failure");
  const time = job.completedAt ? duration(job.startedAt, job.completedAt) : null;
  return (
    <section className="surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13.5px] hover:bg-white/[0.02]"
      >
        <StatusIcon status={ghStatus(job.status, job.conclusion)} />
        <span className="min-w-0 flex-1 truncate font-medium">{job.name}</span>
        {time && <span className="text-[12px] text-muted-foreground tabular-nums">{time}</span>}
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="border-t border-white/[0.06]">
          <JobLogView repoPath={repoPath} job={job} />
        </div>
      )}
    </section>
  );
}

/** One run: its jobs, steps and logs; with a pull request, the agent can be asked to fix it. */
export function RunDetail({ repoPath, pr, id }: { repoPath: string; pr?: PullRequestDetails; id: number }) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const run = useQuery({
    queryKey: ["workflow-run", repoPath, id],
    queryFn: () => gitBackend.getWorkflowRun(repoPath, id),
    refetchInterval: (q) => (q.state.data?.status === "completed" ? false : 5_000),
  });
  const rerun = useMutation({
    mutationFn: () => gitBackend.rerunFailedChecks(repoPath, [id]),
    onSuccess: () => {
      notify({ tone: "success", title: t("checks.rerunStarted") });
      void client.invalidateQueries({ queryKey: ["workflow-run", repoPath, id] });
    },
    onError: (error) => notify({ tone: "error", title: t("checks.rerunFailed"), detail: toGitError(error).message }),
  });
  if (run.isError)
    return <DataUnavailable title={t("agents.actionsError")} error={run.error} onRetry={() => void run.refetch()} />;
  if (!run.data) return <PanelLoading title={t("agents.loadingRun")} variant="grid-syncing" />;
  const data = run.data;
  const failed = data.conclusion === "failure";
  const failingChecks = pr?.statusCheckRollup.filter((c) => checkOutcome(c) === "fail") ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
      <div className="mx-auto max-w-[900px] pt-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-[17px] font-semibold">
              <StatusIcon status={ghStatus(data.status, data.conclusion)} className="size-4" />
              {data.workflowName}
            </h2>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {data.displayTitle} · {data.event} · {formatAge(data.createdAt, undefined, t.locale)}
            </p>
          </div>
          {pr && failed && failingChecks.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void resolveWithAgent(repoPath, pr, failingChecks)}
              className="h-7 gap-1.5 rounded-full text-[12.5px]"
            >
              <MousePointer2 aria-hidden className="size-3.5" />
              {t("checks.resolveWithAgent")}
            </Button>
          )}
          {failed && (
            <Button
              variant="outline"
              size="sm"
              disabled={rerun.isPending}
              onClick={() => rerun.mutate()}
              className="h-7 gap-1.5 rounded-full text-[12.5px]"
            >
              {rerun.isPending ? <BrailleLoader /> : <RefreshCw aria-hidden className="size-3.5" />}
              {t("ci.rerunFailed")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("github.openOnGithub")}
            onClick={() => void gitBackend.openGithubUrl(data.url)}
            className="size-7 rounded-full text-muted-foreground"
          >
            <ExternalLink aria-hidden className="size-3.5" />
          </Button>
        </div>
        <div className="mt-5 space-y-3">
          {(data.jobs ?? []).map((job) => (
            <Job key={job.url || job.name} repoPath={repoPath} job={job} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The latest run of each workflow for the PR's branch. */
function latestPerWorkflow(runs: WorkflowRun[], branch: string): WorkflowRun[] {
  const seen = new Set<string>();
  return runs.filter((run) => {
    if (run.headBranch !== branch || seen.has(run.workflowName)) return false;
    seen.add(run.workflowName);
    return true;
  });
}

/** CI tab of a pull request: its workflows on the left, the chosen run's jobs, steps and logs on the right. */
export function PullRequestCi({ repoPath, pr }: { repoPath: string; pr: PullRequestDetails }) {
  const t = useT();
  const runs = useQuery({
    queryKey: ["workflow-runs", repoPath],
    queryFn: () => gitBackend.listWorkflowRuns(repoPath),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status !== "completed") ? 10_000 : 60_000),
  });
  const list = latestPerWorkflow(runs.data ?? [], pr.headRefName);
  const [picked, setPicked] = useState<number | null>(null);
  const selected = list.find((r) => r.databaseId === picked) ?? list.find((r) => r.conclusion === "failure") ?? list[0];
  if (runs.isError)
    return <DataUnavailable title={t("agents.actionsError")} error={runs.error} onRetry={() => void runs.refetch()} />;
  if (!runs.data) return <PanelLoading title={t("common.loading")} variant="grid-syncing" />;
  if (list.length === 0) return <EmptyState title={t("ci.none")} description={t("ci.noneHint")} />;
  return (
    <div className="flex min-h-0 flex-1">
      <ul className="w-72 shrink-0 space-y-px overflow-y-auto border-r border-white/[0.06] p-2">
        {list.map((run) => (
          <li key={run.databaseId}>
            <button
              type="button"
              aria-current={run.databaseId === selected?.databaseId ? "true" : undefined}
              onClick={() => setPicked(run.databaseId)}
              className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-white/[0.05] aria-[current=true]:bg-white/[0.08]"
            >
              <StatusIcon status={ghStatus(run.status, run.conclusion)} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">{run.workflowName}</span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {run.event} · {formatAge(run.updatedAt, undefined, t.locale)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {selected && <RunDetail key={selected.databaseId} repoPath={repoPath} pr={pr} id={selected.databaseId} />}
    </div>
  );
}
