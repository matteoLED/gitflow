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
import { checkOutcome, resolveWithAgent } from "./ChecksMenu";

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
    const line = rest.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "");
    const last = groups[groups.length - 1];
    if (last?.step === step) last.lines.push(line);
    else groups.push({ step, lines: [line] });
  }
  return groups;
}

function JobLog({ repoPath, job }: { repoPath: string; job: WorkflowJob }) {
  const t = useT();
  const failed = job.conclusion === "failure";
  const [failedOnly, setFailedOnly] = useState(failed);
  const id = jobIdOf(job);
  const log = useQuery({
    queryKey: ["job-log", repoPath, id, failedOnly],
    queryFn: () => gitBackend.getJobLog(repoPath, id ?? 0, failedOnly),
    enabled: !!id && job.status === "completed",
    staleTime: Infinity,
  });
  if (job.status !== "completed")
    return <p className="px-4 py-3 text-[12.5px] text-muted-foreground">{t("ci.running")}</p>;
  return (
    <div className="border-t border-white/[0.06]">
      <div className="flex items-center gap-2 px-4 py-2 text-[12.5px] text-muted-foreground">
        {t("ci.logs")}
        <div className="ml-auto flex rounded-full border border-white/[0.08] p-0.5">
          {[true, false].map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={failedOnly === value}
              onClick={() => setFailedOnly(value)}
              className="rounded-full px-2.5 py-0.5 text-[12px] aria-pressed:bg-white/[0.08] aria-pressed:text-foreground"
            >
              {value ? t("ci.failedOnly") : t("ci.fullLog")}
            </button>
          ))}
        </div>
      </div>
      {log.isError ? (
        <p className="px-4 pb-3 text-[12.5px] text-removed-foreground">{toGitError(log.error).message}</p>
      ) : !log.data ? (
        <div className="px-4 pb-3">
          <BrailleLoader className="text-primary" />
        </div>
      ) : log.data.trim() === "" ? (
        <p className="px-4 pb-3 text-[12.5px] text-muted-foreground">{t("ci.emptyLog")}</p>
      ) : (
        <div className="space-y-1 px-2 pb-2">
          {logByStep(log.data).map((group, i) => (
            <StepLog key={i} step={group.step} lines={group.lines} open={failedOnly} />
          ))}
        </div>
      )}
    </div>
  );
}

function StepLog({ step, lines, open: initiallyOpen }: { step: string; lines: string[]; open: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const errorLine = (line: string) => /##\[error\]|\berror\b|✗|FAIL/i.test(line);
  return (
    <div className="rounded-lg bg-black/25">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        <span className="min-w-0 flex-1 truncate">{step || "—"}</span>
        <span className="text-[11.5px]">{lines.length}</span>
      </button>
      {open && (
        <pre className="max-h-[480px] overflow-auto px-3 pb-2.5 font-mono text-[11.5px] leading-relaxed select-text">
          {lines.map((line, i) => (
            <div key={i} className={cn("whitespace-pre-wrap", errorLine(line) && "text-removed-foreground")}>
              {line.replace(/##\[(error|warning|group|endgroup)\]/, "")}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

/** A job's steps, then its log grouped by step. */
export function JobSteps({ repoPath, job }: { repoPath: string; job: WorkflowJob }) {
  return (
    <>
      <ol className="border-t border-white/[0.06] px-2 py-1.5">
        {job.steps.map((step) => (
          <li key={step.number} className="flex items-center gap-2.5 rounded-md px-2 py-1 text-[13px]">
            <StatusIcon status={ghStatus(step.status, step.conclusion)} />
            <span className={cn("truncate", step.conclusion === "skipped" && "text-muted-foreground")}>
              {step.name}
            </span>
          </li>
        ))}
      </ol>
      <JobLog repoPath={repoPath} job={job} />
    </>
  );
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
      {open && <JobSteps repoPath={repoPath} job={job} />}
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
