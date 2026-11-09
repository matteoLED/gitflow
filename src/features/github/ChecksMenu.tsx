import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CircleDashed, ListChecks, MousePointer2, RefreshCw, X } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useAgentsStore } from "@/stores/agents-store";
import { useNoticesStore } from "@/stores/notices-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { PullRequestCheck, PullRequestDetails } from "@/types/git";
import { startAgentRun } from "@/features/agents/use-agents";
import { CheckDialog } from "./CheckDialog";

export type Outcome = "pass" | "fail" | "pending" | "skip";

/** A CheckRun has status + conclusion; a legacy StatusContext (Railway, Vercel…) has a state. */
export function checkOutcome(check: PullRequestCheck): Outcome {
  const value = (check.conclusion || check.state || "").toUpperCase();
  if (check.status && check.status !== "COMPLETED") return "pending";
  if (value === "SUCCESS") return "pass";
  if (value === "SKIPPED" || value === "NEUTRAL") return "skip";
  if (value === "PENDING" || value === "EXPECTED" || value === "") return "pending";
  return "fail";
}

/** "59s", "1m 2s": how long a check ran. */
export function checkDuration(check: PullRequestCheck): string | null {
  if (!check.startedAt || !check.completedAt) return null;
  const seconds = Math.round((Date.parse(check.completedAt) - Date.parse(check.startedAt)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** The GitHub Actions run behind a check, from its details link (…/actions/runs/<id>/job/…). */
export function runIdOf(check: PullRequestCheck): number | null {
  const match = (check.detailsUrl ?? "").match(/\/actions\/runs\/(\d+)/);
  return match ? Number(match[1]) : null;
}

const nameOf = (c: PullRequestCheck) => c.name ?? c.context ?? "";
export const checkLabel = (c: PullRequestCheck) => (c.workflowName ? `${c.workflowName}/${nameOf(c)}` : nameOf(c));

/** ✓ passed, ✕ failed, dot grid running, dashed circle queued — as in Linear. */
export function CheckIcon({ check, className }: { check: PullRequestCheck; className?: string }) {
  const outcome = checkOutcome(check);
  const base = cn("size-3.5 shrink-0", className);
  if (outcome === "pass") return <Check aria-hidden className={cn(base, "text-added-foreground")} />;
  if (outcome === "fail") return <X aria-hidden className={cn(base, "text-removed-foreground")} />;
  if (check.status === "IN_PROGRESS" || check.state === "PENDING")
    return (
      <span className={cn("grid size-3.5 shrink-0 place-items-center text-primary", className)}>
        <BrailleLoader variant="grid" />
      </span>
    );
  return <CircleDashed aria-hidden className={cn(base, "text-muted-foreground")} />;
}

function CheckRow({ check, onOpen }: { check: PullRequestCheck; onOpen: (check: PullRequestCheck) => void }) {
  const duration = checkDuration(check);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(check)}
        className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] outline-none hover:bg-white/[0.06] focus-visible:bg-white/[0.06]"
      >
        <CheckIcon check={check} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            {check.workflowName && <span className="text-muted-foreground">{check.workflowName} / </span>}
            {nameOf(check)}
          </span>
          {check.description && (
            <span className="block truncate text-[12px] text-muted-foreground">{check.description}</span>
          )}
        </span>
        {duration && <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">{duration}</span>}
      </button>
    </li>
  );
}

function Group({
  title,
  checks,
  onOpen,
}: {
  title: string;
  checks: PullRequestCheck[];
  onOpen: (check: PullRequestCheck) => void;
}) {
  if (checks.length === 0) return null;
  return (
    <section className="border-t border-white/[0.06] px-1.5 py-1.5">
      <h3 className="px-2 pt-1 pb-1 text-[12px] text-muted-foreground">{title}</h3>
      <ul>
        {checks.map((check, i) => (
          <CheckRow key={`${nameOf(check)}:${i}`} check={check} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

/** Asks an agent to fix the failing checks, with how to read their logs. */
export async function resolveWithAgent(repoPath: string, pr: PullRequestDetails, failing: PullRequestCheck[]) {
  const runs = [...new Set(failing.map(runIdOf).filter((id): id is number => id !== null))];
  const prompt = [
    `The CI of pull request #${pr.number} ("${pr.title}", branch ${pr.headRefName}) fails on: ${failing.map(nameOf).join(", ")}.`,
    runs.length
      ? `Read the failing logs with ${runs.map((id) => `\`gh run view ${id} --log-failed\``).join(", ")}.`
      : null,
    "Find the cause, fix it on the current branch with the smallest change, run the relevant tests, then summarize the fix.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const { preferredAgent } = useAgentsStore.getState();
  const id = await startAgentRun(repoPath, preferredAgent, { kind: "custom", prompt }, `Fix CI of #${pr.number}`);
  if (!id) return;
  useAgentsStore.getState().select({ type: "run", id });
  useWorkspaceStore.getState().setView("agents");
}

/** Linear's checks pill: a summary that opens every check, grouped, with fixes one click away. */
export function ChecksMenu({ repoPath, pr }: { repoPath: string; pr: PullRequestDetails }) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewed, setViewed] = useState<PullRequestCheck | null>(null);
  const open = (check: PullRequestCheck) => {
    setMenuOpen(false);
    setViewed(check);
  };
  const checks = pr.statusCheckRollup.filter((c) => checkOutcome(c) !== "skip");
  const failing = checks.filter((c) => checkOutcome(c) === "fail");
  const pending = checks.filter((c) => checkOutcome(c) === "pending");
  const passed = checks.filter((c) => checkOutcome(c) === "pass");
  const failingRuns = [...new Set(failing.map(runIdOf).filter((id): id is number => id !== null))];
  const rerun = useMutation({
    mutationFn: () => gitBackend.rerunFailedChecks(repoPath, failingRuns),
    onSuccess: () => {
      notify({ tone: "success", title: t("checks.rerunStarted") });
      void client.invalidateQueries({ queryKey: ["pull-request", repoPath, pr.number] });
    },
    onError: (error) => notify({ tone: "error", title: t("checks.rerunFailed"), detail: toGitError(error).message }),
  });
  // The dialog follows the live check (the PR is re-polled), not the snapshot taken when it was opened.
  const current = viewed && (checks.find((c) => checkLabel(c) === checkLabel(viewed)) ?? viewed);
  if (checks.length === 0) return <p className="text-muted-foreground">{t("pr.noChecks")}</p>;
  const needle = query.toLowerCase();
  const match = (c: PullRequestCheck) =>
    !needle || `${c.workflowName ?? ""} ${nameOf(c)} ${c.description ?? ""}`.toLowerCase().includes(needle);
  const allGood = failing.length === 0 && pending.length === 0;

  return (
    <div className="space-y-1">
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger className="-mx-1 flex items-center gap-2 rounded-full px-2.5 py-1 text-[13px] outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-white/[0.08]">
          {pending.length > 0 ? (
            <BrailleLoader className="text-primary" />
          ) : (
            <ListChecks
              aria-hidden
              className={cn("size-4", allGood ? "text-added-foreground" : "text-removed-foreground")}
            />
          )}
          {t("pr.checksPassed", { passed: passed.length, total: checks.length })}
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-[380px] overflow-hidden rounded-xl p-0 shadow-2xl">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("checks.filter")}
            aria-label={t("checks.filter")}
            className="h-10 w-full bg-transparent px-3.5 text-[13px] outline-none placeholder:text-muted-foreground"
          />
          {failing.length > 0 && (
            <div className="border-t border-white/[0.06] p-1.5">
              <button
                type="button"
                onClick={() => void resolveWithAgent(repoPath, pr, failing)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-white/[0.06]"
              >
                <MousePointer2 aria-hidden className="size-3.5 text-muted-foreground" />
                {t("checks.resolveWithAgent")}
              </button>
              <button
                type="button"
                disabled={failingRuns.length === 0 || rerun.isPending}
                onClick={() => rerun.mutate()}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] hover:enabled:bg-white/[0.06] disabled:opacity-50"
              >
                {rerun.isPending ? (
                  <BrailleLoader />
                ) : (
                  <RefreshCw aria-hidden className="size-3.5 text-muted-foreground" />
                )}
                {t("checks.rerunFailing")}
                <span className="text-muted-foreground">{t.plural("checks.count", failing.length)}</span>
              </button>
            </div>
          )}
          <div className="max-h-[420px] overflow-y-auto">
            <Group title={t.plural("checks.pending", pending.length)} checks={pending.filter(match)} onOpen={open} />
            <Group title={t.plural("checks.failed", failing.length)} checks={failing.filter(match)} onOpen={open} />
            <Group title={t.plural("checks.passed", passed.length)} checks={passed.filter(match)} onOpen={open} />
          </div>
        </PopoverContent>
      </Popover>
      <CheckDialog repoPath={repoPath} pr={pr} checks={checks} check={current} onChange={setViewed} />
      {failing.map((check, i) => (
        <p key={i} className="flex items-center gap-2.5 px-1.5 text-[13px]">
          <span className="mx-1 size-2 shrink-0 rounded-full bg-removed-foreground" />
          <span className="min-w-0 truncate">{nameOf(check)}</span>
        </p>
      ))}
    </div>
  );
}
