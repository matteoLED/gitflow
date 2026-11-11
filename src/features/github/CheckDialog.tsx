import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, ExternalLink, MoreHorizontal, MousePointer2, RefreshCw, X } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { GithubIcon } from "@/components/github-icon";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n";
import { formatAge } from "@/lib/format-date";
import { useNoticesStore } from "@/stores/notices-store";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import type { PullRequestCheck, PullRequestDetails } from "@/types/git";
import { CheckIcon, checkDuration, checkLabel, checkOutcome, resolveWithAgent, runIdOf } from "./ChecksMenu";
import { JobLogView } from "./JobLog";
import { cleanLine, jobIdOf, logByStep } from "./PullRequestCi";

/** The Actions job behind a check, from its details link (…/actions/runs/<run>/job/<job>). */
export function jobIdOfCheck(check: PullRequestCheck): number | null {
  const match = (check.detailsUrl ?? "").match(/\/job\/(\d+)/);
  return match ? Number(match[1]) : null;
}

const OUTCOME_LABEL = {
  pass: "checks.outcome.pass",
  fail: "checks.outcome.fail",
  pending: "checks.inProgress",
  skip: "checks.outcome.skip",
} as const;

const urlOf = (check: PullRequestCheck) => check.detailsUrl ?? check.targetUrl ?? null;

function Centered({ check, children }: { check: PullRequestCheck; children: React.ReactNode }) {
  const t = useT();
  const url = urlOf(check);
  return (
    <div className="grid flex-1 place-content-center justify-items-center gap-2.5 text-[13px]">
      <p className="flex items-center gap-2">{children}</p>
      {check.description && <p className="max-w-md text-center text-muted-foreground">{check.description}</p>}
      {url && (
        <button
          type="button"
          onClick={() => void gitBackend.openGithubUrl(url)}
          className="flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2.5 py-1 text-[12.5px] hover:bg-white/[0.1]"
        >
          <GithubIcon aria-hidden className="size-3.5" />
          {t("github.openOnGithub")}
        </button>
      )}
    </div>
  );
}

/** Job steps and logs when the check is a GitHub Actions job; otherwise its state and link. */
function CheckBody({ repoPath, check }: { repoPath: string; check: PullRequestCheck }) {
  const t = useT();
  const runId = runIdOf(check);
  const jobId = jobIdOfCheck(check);
  const outcome = checkOutcome(check);
  const run = useQuery({
    queryKey: ["workflow-run", repoPath, runId],
    queryFn: () => gitBackend.getWorkflowRun(repoPath, runId ?? 0),
    enabled: runId !== null,
    refetchInterval: (q) => (q.state.data?.status === "completed" ? false : 5_000),
  });
  const job = run.data?.jobs?.find((j) => jobIdOf(j) === jobId);
  // A running Actions job shows its steps ticking along (the run is polled every 5 s); queued or external
  // checks have nothing to show yet.
  if (outcome === "pending" && job && job.steps.length > 0)
    return (
      <div className="mx-3 mb-3 min-h-0 flex-1 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/20">
        <JobLogView repoPath={repoPath} job={job} />
      </div>
    );
  if (outcome === "pending")
    return (
      <Centered check={check}>
        <CheckIcon check={check} />
        {t("checks.inProgress")}
      </Centered>
    );
  if (runId === null || run.isError || (run.data && !job))
    return (
      <Centered check={check}>
        <CheckIcon check={check} />
        {run.isError ? toGitError(run.error).message : t(OUTCOME_LABEL[outcome])}
      </Centered>
    );
  if (!job)
    return (
      <div className="grid flex-1 place-items-center">
        <BrailleLoader className="text-primary" />
      </div>
    );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <JobLogView repoPath={repoPath} job={job} />
    </div>
  );
}

/** The commit the check ran on, when it ended, and what to do next: copy the errors, re-run it. */
function CheckFooter({ repoPath, pr, check }: { repoPath: string; pr: PullRequestDetails; check: PullRequestCheck }) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const [copied, setCopied] = useState(false);
  const [fixing, setFixing] = useState(false);
  const sha = pr.commits[pr.commits.length - 1]?.oid ?? "";
  const outcome = checkOutcome(check);
  const runId = runIdOf(check);
  const jobId = jobIdOfCheck(check);
  const time = checkDuration(check);
  const copy = async (text: () => Promise<string>) => {
    try {
      await navigator.clipboard.writeText(await text());
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (error) {
      notify({ tone: "error", title: t("checks.copyFailed"), detail: toGitError(error).message });
    }
  };
  // Same query as the log view: copying reuses what's already loaded.
  const log = (failedOnly: boolean) => async () =>
    logByStep(
      await client.fetchQuery({
        queryKey: ["job-log", repoPath, jobId, failedOnly],
        queryFn: () => gitBackend.getJobLog(repoPath, jobId ?? 0, failedOnly),
        staleTime: Infinity,
      }),
    )
      .flatMap((g) => g.lines.map(cleanLine))
      .join("\n");
  const rerun = useMutation({
    mutationFn: () => gitBackend.rerunFailedChecks(repoPath, [runId ?? 0]),
    onSuccess: () => {
      notify({ tone: "success", title: t("checks.rerunStarted") });
      void client.invalidateQueries({ queryKey: ["pull-request", repoPath, pr.number] });
    },
    onError: (error) => notify({ tone: "error", title: t("checks.rerunFailed"), detail: toGitError(error).message }),
  });
  const ended = outcome !== "pending" ? check.completedAt : null;
  return (
    <footer className="flex items-center gap-2 border-t border-white/[0.06] px-3.5 py-2 text-[12.5px]">
      <span className="font-mono">{sha.slice(0, 7)}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{pr.title}</span>
      {ended && (
        <span className="shrink-0 text-muted-foreground">
          {t(outcome === "fail" ? "checks.failedAgo" : "checks.endedAgo", {
            age: formatAge(ended, undefined, t.locale),
          })}
          {time && ` · ${time}`}
        </span>
      )}
      <div className="flex shrink-0 items-center rounded-md border border-white/10">
        <button
          type="button"
          disabled={jobId === null}
          onClick={() => void copy(log(outcome === "fail"))}
          className="flex items-center gap-1.5 rounded-l-md px-2 py-1 hover:enabled:bg-white/[0.06] disabled:opacity-50"
        >
          {copied ? (
            <Check aria-hidden className="size-3.5 text-added-foreground" />
          ) : (
            <Copy aria-hidden className="size-3.5" />
          )}
          {t(outcome === "fail" ? "checks.copyErrors" : "checks.copyLog")}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("common.more")}
            className="grid h-full place-items-center rounded-r-md border-l border-white/10 px-1.5 py-1 outline-none hover:bg-white/[0.06]"
          >
            <ChevronDown aria-hidden className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {jobId !== null && (
              <DropdownMenuItem onSelect={() => void copy(log(false))}>{t("ci.copyAllLogs")}</DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => void copy(async () => sha)}>{t("checks.copyFullSha")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {outcome === "fail" && (
        <button
          type="button"
          title={t("checks.fixWithAgent")}
          disabled={fixing}
          onClick={() => {
            setFixing(true);
            void resolveWithAgent(repoPath, pr, [check]).finally(() => setFixing(false));
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 hover:enabled:bg-white/[0.06] disabled:opacity-50"
        >
          {fixing ? <BrailleLoader /> : <MousePointer2 aria-hidden className="size-3.5" />}
          {t("checks.fix")}
        </button>
      )}
      <button
        type="button"
        disabled={runId === null || outcome === "pending" || rerun.isPending}
        onClick={() => rerun.mutate()}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 hover:enabled:bg-white/[0.06] disabled:opacity-50"
      >
        {rerun.isPending ? <BrailleLoader /> : <RefreshCw aria-hidden className="size-3.5" />}
        {t("checks.rerun")}
      </button>
    </footer>
  );
}

/** Linear's check viewer: pick any check of the PR, read its logs, without leaving the app. */
export function CheckDialog({
  repoPath,
  pr,
  checks,
  check,
  onChange,
}: {
  repoPath: string;
  pr: PullRequestDetails;
  checks: PullRequestCheck[];
  check: PullRequestCheck | null;
  onChange: (check: PullRequestCheck | null) => void;
}) {
  const t = useT();
  const url = check ? urlOf(check) : null;
  return (
    <Dialog open={!!check} onOpenChange={(open) => !open && onChange(null)}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(780px,85vh)] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[min(1000px,calc(100%-4rem))]"
      >
        {check && (
          <>
            <header className="flex items-center gap-1.5 px-3 py-2.5">
              <DropdownMenu>
                <DropdownMenuTrigger className="flex max-w-[60%] items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-[13px] outline-none hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-ring">
                  <CheckIcon check={check} />
                  <DialogTitle className="truncate text-[13px] font-normal">{checkLabel(check)}</DialogTitle>
                  <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-[60vh] w-80 overflow-y-auto">
                  {checks.map((c, i) => (
                    <DropdownMenuItem key={`${checkLabel(c)}:${i}`} onSelect={() => onChange(c)} className="gap-2">
                      <CheckIcon check={c} />
                      <span className="truncate">{checkLabel(c)}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {url && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={t("common.more")}
                    className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-white/[0.06] hover:text-foreground"
                  >
                    <MoreHorizontal aria-hidden className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    <DropdownMenuItem onSelect={() => void gitBackend.openGithubUrl(url)} className="gap-2">
                      <ExternalLink aria-hidden className="size-3.5" />
                      {t("github.openOnGithub")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(url)} className="gap-2">
                      <Copy aria-hidden className="size-3.5" />
                      {t("checks.copyLink")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <DialogClose
                aria-label={t("common.close")}
                className="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-white/[0.06] hover:text-foreground"
              >
                <X aria-hidden className="size-4" />
              </DialogClose>
            </header>
            <CheckBody key={checkLabel(check)} repoPath={repoPath} check={check} />
            <CheckFooter repoPath={repoPath} pr={pr} check={check} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
