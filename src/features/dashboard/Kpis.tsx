import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { summarize } from "@/features/agents/usage-stats";
import { useActiveAccount, useActiveCycles, useWorkspaceIssues } from "@/features/linear/linear-queries";
import { useInbox, useWorkItems } from "@/features/work/use-work-items";
import { useT } from "@/i18n";
import { useGithubUser, useWorkflowRuns } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useAgentsStore } from "@/stores/agents-store";
import { useLinearStore } from "@/stores/linear-store";
import { useWorkStore, type WorkFilter } from "@/stores/work-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { RepositoryInfo } from "@/types/git";

const WEEK = 7 * 86_400_000;

/** One number that matters, what it means, and where it leads. */
function Tile({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "alert" | "good";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="surface flex min-w-0 flex-col items-start gap-1 px-4 py-3.5 text-left outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-[24px] leading-none font-semibold tracking-tight tabular-nums",
          tone === "alert" && "text-removed-foreground",
          tone === "good" && "text-added-foreground",
        )}
      >
        {value ?? "—"}
      </span>
      <span className="min-h-4 truncate text-[12px] text-muted-foreground">{hint}</span>
    </button>
  );
}

const openWork = (filter: WorkFilter) => {
  useWorkStore.getState().setFilter(filter);
  useWorkspaceStore.getState().setView("work");
};

/** The home's key figures: what's waiting, pull requests, CI health, the cycle, and AI spend. */
export function Kpis({ repo }: { repo: RepositoryInfo }) {
  const t = useT();
  const [now] = useState(Date.now);
  const inbox = useInbox(repo.path);
  const work = useWorkItems(repo.path).data;
  const me = useGithubUser(repo.path).data?.login ?? null;
  const runs = useWorkflowRuns(repo.path).data;
  const account = useActiveAccount();
  const cycle = useActiveCycles(account?.id).data?.[0];
  const issues = useWorkspaceIssues().data;
  const usage = useQuery({
    queryKey: ["usage-stats"],
    queryFn: gitBackend.getUsageStats,
    refetchInterval: 60_000,
  }).data;

  const openPrs = work?.filter((w) => w.pr?.state === "OPEN") ?? [];
  const mine = openPrs.filter((w) => w.local || (me && w.pr?.author.login === me));
  const toReview = inbox?.filter((i) => i.reason === "review").length ?? 0;
  const failing = inbox?.filter((i) => i.reason === "ciFailed").length ?? 0;
  // ponytail: CI health over the 100 latest runs `gh` returns; enough for a week on most repositories.
  const week = (runs ?? []).filter((r) => r.status === "completed" && now - new Date(r.createdAt).getTime() < WEEK);
  const passed = week.filter((r) => ["success", "skipped", "neutral"].includes(r.conclusion)).length;
  const rate = week.length ? Math.round((passed / week.length) * 100) : null;
  const ai = usage && summarize(usage, 7, null);
  const openIssues = issues?.filter((i) => i.state.type !== "completed" && i.state.type !== "canceled").length;
  const daysLeft = cycle && Math.max(0, Math.ceil((new Date(cycle.endsAt).getTime() - now) / 86_400_000));

  return (
    <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Tile
        label={t("kpi.inbox")}
        value={inbox?.length}
        tone={failing > 0 ? "alert" : undefined}
        hint={failing > 0 ? t("kpi.inboxFailing", { count: failing }) : inbox && t("kpi.inboxHint")}
        onClick={() => openWork("inbox")}
      />
      <Tile
        label={t("kpi.pulls")}
        value={work && mine.length}
        hint={work && t("kpi.pullsHint", { count: toReview })}
        onClick={() => openWork("pulls")}
      />
      <Tile
        label={t("kpi.ci")}
        value={rate === null ? null : `${rate}%`}
        tone={rate === null ? undefined : rate < 80 ? "alert" : "good"}
        hint={runs && t("kpi.ciHint", { runs: week.length, failed: week.length - passed })}
        onClick={() => useWorkspaceStore.getState().setView("ci")}
      />
      <Tile
        label={cycle ? (cycle.name ?? t("linear.cycleNumber", { number: cycle.number })) : t("kpi.issues")}
        value={cycle ? `${Math.round(cycle.progress * 100)}%` : openIssues}
        hint={cycle ? t("linear.daysLeft", { count: daysLeft ?? 0 }) : openIssues !== undefined && t("kpi.issuesHint")}
        onClick={() => {
          useLinearStore.getState().setPage(cycle ? "cycle" : "mine");
          useWorkspaceStore.getState().setView("linear");
        }}
      />
      <Tile
        label={t("kpi.ai")}
        value={ai && `$${ai.cost.toFixed(ai.cost < 100 ? 2 : 0)}`}
        hint={ai && t("kpi.aiHint", { count: ai.sessions })}
        onClick={() => {
          useAgentsStore.getState().select({ type: "usage" });
          useWorkspaceStore.getState().setView("agents");
        }}
      />
    </div>
  );
}
