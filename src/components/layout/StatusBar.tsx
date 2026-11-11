import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, CircleDot, CircleX, GitMerge, PencilLine } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BranchSwitcher } from "@/features/branches/BranchSwitcher";
import { useGithubIncident } from "@/features/github/GithubIncident";
import { useT } from "@/i18n";
import { useOperation, useRefs, useWorkflowRuns, useWorkingTree } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useAgentsStore } from "@/stores/agents-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { WorkflowRun } from "@/types/git";

function Item({
  hint,
  onClick,
  className,
  children,
}: {
  hint: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "flex h-5 shrink-0 items-center gap-1 rounded px-1.5 whitespace-nowrap tabular-nums outline-none hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3 [&_svg]:shrink-0",
            className,
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{hint}</TooltipContent>
    </Tooltip>
  );
}

/** Same query as the CI page (shared cache, polled by the inbox). */
function useLatestRun(repoPath: string, branch: string | null): WorkflowRun | undefined {
  const runs = useWorkflowRuns(repoPath).data;
  if (!branch || !runs) return undefined;
  return runs
    .filter((r) => r.headBranch === branch)
    .reduce<WorkflowRun | undefined>(
      (latest, r) => (!latest || r.createdAt > latest.createdAt ? r : latest),
      undefined,
    );
}

function CiItem({ repoPath, branch }: { repoPath: string; branch: string | null }) {
  const t = useT();
  const setView = useWorkspaceStore((s) => s.setView);
  const run = useLatestRun(repoPath, branch);
  if (!run || !branch) return null;
  const running = run.status !== "completed";
  const state = running
    ? "ciRunning"
    : run.conclusion === "success"
      ? "ciSuccess"
      : run.conclusion === "failure" || run.conclusion === "timed_out"
        ? "ciFailure"
        : "ciOther";
  return (
    <Item
      hint={t("statusBar.ci", { branch, workflow: run.workflowName, state: t(`statusBar.${state}`) })}
      onClick={() => setView("ci")}
      className={cn(state === "ciFailure" && "text-check-failed")}
    >
      {running ? (
        <BrailleLoader variant="grid-syncing" />
      ) : state === "ciSuccess" ? (
        <CircleCheck aria-hidden className="text-added-foreground" />
      ) : state === "ciFailure" ? (
        <CircleX aria-hidden />
      ) : (
        <CircleDot aria-hidden />
      )}
      CI
    </Item>
  );
}

function AgentsItem({ repoPath }: { repoPath: string }) {
  const t = useT();
  const setView = useWorkspaceStore((s) => s.setView);
  const running = useAgentsStore((s) => s.runs.filter((r) => r.repoPath === repoPath && r.status === "running").length);
  if (running === 0) return null;
  return (
    <Item hint={t.plural("statusBar.agents", running)} onClick={() => setView("agents")}>
      <BrailleLoader variant="grid-orbit" />
      {t.plural("statusBar.agents", running)}
    </Item>
  );
}

function IncidentItem() {
  const t = useT();
  const incident = useGithubIncident();
  if (!incident) return null;
  return (
    <Item
      hint={`${t("githubStatus.title")}: ${incident.detail}`}
      onClick={() => void gitBackend.openGithubUrl(incident.url)}
      className={incident.severe ? "text-removed-foreground" : "text-renamed"}
    >
      <CircleAlert aria-hidden />
      GitHub
    </Item>
  );
}

/** Window-wide footer: where the repository stands, and what runs in the background — each a shortcut to its page. */
export function StatusBar({ repoPath }: { repoPath: string }) {
  const t = useT();
  const setView = useWorkspaceStore((s) => s.setView);
  const refs = useRefs(repoPath).data;
  const changes = useWorkingTree(repoPath).data?.length ?? 0;
  const operation = useOperation(repoPath).data;
  const branchName = refs?.head.branch ?? null;
  const branch = refs?.branches.find((b) => b.name === branchName);
  const ahead = branch?.ahead ?? 0;
  const behind = branch?.behind ?? 0;
  const syncHint = !branch?.upstream
    ? t("statusBar.unpublished")
    : ahead || behind
      ? [ahead && t.plural("statusBar.ahead", ahead), behind && t.plural("statusBar.behind", behind)]
          .filter(Boolean)
          .join(" · ")
      : t("statusBar.inSync", { upstream: branch.upstream });
  return (
    <footer
      aria-label={t("statusBar.label")}
      className="flex h-6 shrink-0 items-center gap-0.5 px-1.5 text-[11.5px] text-muted-foreground"
    >
      <BranchSwitcher repoPath={repoPath} compact />
      {branch && (
        <Item hint={syncHint} onClick={() => setView("changes")}>
          {!branch.upstream ? (
            <ArrowUp aria-hidden className="text-renamed" />
          ) : (
            <>
              <ArrowUp aria-hidden />
              {ahead}
              <ArrowDown aria-hidden className="ml-0.5" />
              {behind}
            </>
          )}
        </Item>
      )}
      <Item
        hint={changes ? t.plural("statusBar.changes", changes) : t("statusBar.clean")}
        onClick={() => setView("changes")}
        className={cn(changes > 0 && "text-foreground/80")}
      >
        <PencilLine aria-hidden />
        {changes}
      </Item>
      {operation && (
        <Item
          hint={t(`conflicts.${operation.kind}`, { branch: operation.branch ?? operation.theirs })}
          onClick={() => setView("changes")}
          className="bg-amber-400/[0.1] text-amber-300 hover:bg-amber-400/[0.16] hover:text-amber-200"
        >
          <GitMerge aria-hidden />
          {t(`conflicts.${operation.kind}`, { branch: operation.branch ?? operation.theirs })}
          {operation.step && <span className="opacity-70">{operation.step.join("/")}</span>}
        </Item>
      )}
      <div className="flex-1" />
      <AgentsItem repoPath={repoPath} />
      <CiItem repoPath={repoPath} branch={branchName} />
      <IncidentItem />
    </footer>
  );
}
