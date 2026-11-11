import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FolderGit2, Layers, MonitorSmartphone, PlayCircle, Sparkles } from "lucide-react";
import { GithubIcon } from "@/components/github-icon";
import { PanelHeader } from "@/components/layout/panel";
import { BrailleLoader } from "@/components/braille-loader";
import { useT } from "@/i18n";
import { formatAge } from "@/lib/format-date";
import { usePullRequests, useRefs, useWorkflowRuns, useWorkingTree, useGitIdentity } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useAgentsStore } from "@/stores/agents-store";
import { useLinearStore } from "@/stores/linear-store";
import { runOf, usePreviewStore } from "@/stores/preview-store";
import { useWorkspaceStore, type View } from "@/stores/workspace-store";
import { ClaudeIcon } from "@/features/agents/agent-icons";
import { StatusIcon, ghStatus } from "@/features/agents/status";
import {
  BranchStateIcon,
  pullRequestOf,
  ReviewBadge,
  StateIcon,
  useOpenPullRequest,
} from "@/features/github/PullRequestList";
import { LinearIcon } from "@/features/linear/LinearIcon";
import { PriorityIcon, StateDot } from "@/features/linear/LinearList";
import { useActiveAccount, useMyIssues } from "@/features/linear/linear-queries";
import { usePreviewTargets } from "@/features/preview/PreviewList";
import type { RepositoryInfo } from "@/types/git";
import { Kpis } from "./Kpis";

const go = (view: View) => useWorkspaceStore.getState().setView(view);

/** One block of the dashboard: a titled list that leads to its full view. */
function Card({
  icon,
  title,
  view,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  view: View;
  children: ReactNode;
  className?: string;
}) {
  const t = useT();
  return (
    <section className={cn("surface flex min-h-0 flex-col", className)}>
      <header className="flex h-11 shrink-0 items-center gap-2 px-4 text-[13px] font-medium">
        <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
        {title}
        <button
          type="button"
          onClick={() => go(view)}
          className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-normal text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
        >
          {t("dashboard.seeAll")}
          <ArrowRight aria-hidden className="size-3" />
        </button>
      </header>
      <ul className="px-1.5 pb-1.5">{children}</ul>
    </section>
  );
}

function Row({
  lead,
  title,
  meta,
  trail,
  onClick,
}: {
  lead: ReactNode;
  title: string;
  meta?: ReactNode;
  trail?: ReactNode;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="grid w-4 shrink-0 place-items-center">{lead}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px]">{title}</span>
          {meta && <span className="block truncate text-[12px] text-muted-foreground">{meta}</span>}
        </span>
        {trail && <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground">{trail}</span>}
      </button>
    </li>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <li className="px-2.5 py-3 text-[12.5px] text-muted-foreground">{children}</li>;
}

function Loading() {
  return (
    <li className="px-2.5 py-3">
      <BrailleLoader className="text-muted-foreground" />
    </li>
  );
}

function LinearCard() {
  const t = useT();
  const account = useActiveAccount();
  const issues = useMyIssues(account?.id);
  const order = { started: 0, unstarted: 1, triage: 2, backlog: 3, completed: 4, canceled: 5 };
  const top = [...(issues.data ?? [])].sort((a, b) => order[a.state.type] - order[b.state.type]).slice(0, 6);
  return (
    <Card icon={<LinearIcon />} title={t("dashboard.issues")} view="linear">
      {!account ? (
        <Empty>{t("dashboard.linearOff")}</Empty>
      ) : !issues.data ? (
        <Loading />
      ) : top.length === 0 ? (
        <Empty>{t("linear.empty")}</Empty>
      ) : (
        top.map((issue) => (
          <Row
            key={issue.id}
            lead={<StateDot state={issue.state} />}
            title={issue.title}
            meta={`${issue.identifier}${issue.project ? ` · ${issue.project.name}` : ""}`}
            trail={<PriorityIcon priority={issue.priority} />}
            onClick={() => {
              useLinearStore.getState().setIssue(issue.id, account.id);
              go("linear");
            }}
          />
        ))
      )}
    </Card>
  );
}

function PullRequestsCard({ repo }: { repo: RepositoryInfo }) {
  const t = useT();
  const prs = usePullRequests(repo.path);
  const { open } = useOpenPullRequest(repo.path);
  const openOnes = (prs.data ?? []).filter((pr) => pr.state === "OPEN").slice(0, 6);
  return (
    <Card icon={<GithubIcon />} title={t("view.github")} view="github">
      {prs.isError ? (
        <Empty>{t("dashboard.githubOff")}</Empty>
      ) : !prs.data ? (
        <Loading />
      ) : openOnes.length === 0 ? (
        <Empty>{t("dashboard.noPr")}</Empty>
      ) : (
        openOnes.map((pr) => (
          <Row
            key={pr.number}
            lead={<StateIcon pr={pr} />}
            title={pr.title}
            meta={`#${pr.number} · ${pr.author.login}`}
            trail={
              <>
                <ReviewBadge pr={pr} />
                {formatAge(pr.updatedAt, undefined, t.locale)}
              </>
            }
            onClick={() => {
              go("history");
              void open(pr);
            }}
          />
        ))
      )}
    </Card>
  );
}

function RepoCard({ repo }: { repo: RepositoryInfo }) {
  const t = useT();
  const refs = useRefs(repo.path).data;
  const changes = useWorkingTree(repo.path).data?.length ?? 0;
  const head = refs?.branches.find((b) => b.name === refs.head.branch);
  const pr = pullRequestOf(usePullRequests(repo.path).data, refs?.head.branch);
  const upstream = head?.upstream ?? t("dashboard.noUpstream");
  return (
    <Card icon={<FolderGit2 />} title={t("dashboard.repo")} view="history">
      <Row
        lead={<BranchStateIcon pr={pr} />}
        title={refs?.head.branch ?? t("branches.detached")}
        meta={pr ? `#${pr.number} · ${upstream}` : upstream}
        trail={head && (head.ahead || head.behind) ? `↑${head.ahead} ↓${head.behind}` : undefined}
        onClick={() => go("history")}
      />
      <Row
        lead={<Layers aria-hidden className="size-3.5 text-muted-foreground" />}
        title={changes ? t.plural("dashboard.changes", changes) : t("dashboard.clean")}
        onClick={() => go("changes")}
      />
    </Card>
  );
}

function AgentsCard({ repo }: { repo: RepositoryInfo }) {
  const t = useT();
  const select = useAgentsStore((s) => s.select);
  // Id → title of the running runs: their streaming steps don't re-render the card.
  const live = Object.entries(
    useAgentsStore(
      useShallow((s) => Object.fromEntries(s.runs.filter((r) => r.status === "running").map((r) => [r.id, r.title]))),
    ),
  ).map(([id, title]) => ({ id, title }));
  const sessions = useQuery({
    queryKey: ["agent-sessions", repo.path],
    queryFn: () => gitBackend.listAgentSessions(repo.path),
    refetchInterval: 30_000,
  });
  const recent = (sessions.data ?? []).slice(0, Math.max(0, 5 - live.length));
  const show = (selection: Parameters<typeof select>[0]) => {
    select(selection);
    go("agents");
  };
  return (
    <Card icon={<Sparkles />} title={t("view.agents")} view="agents">
      {live.map((run) => (
        <Row
          key={run.id}
          lead={<StatusIcon status="running" />}
          title={run.title}
          meta={t("agents.working")}
          onClick={() => show({ type: "run", id: run.id })}
        />
      ))}
      {!sessions.data && live.length === 0 && <Loading />}
      {sessions.data && recent.length === 0 && live.length === 0 && <Empty>{t("agents.noSessions")}</Empty>}
      {recent.map((s) => (
        <Row
          key={s.id}
          lead={<ClaudeIcon className="size-3.5 text-[#d97757]" />}
          title={s.title}
          meta={s.gitBranch ?? undefined}
          trail={s.updatedAt ? formatAge(s.updatedAt, undefined, t.locale) : undefined}
          onClick={() => show({ type: "session", id: s.id })}
        />
      ))}
    </Card>
  );
}

function ChecksCard({ repo }: { repo: RepositoryInfo }) {
  const t = useT();
  const select = useAgentsStore((s) => s.select);
  const runs = useWorkflowRuns(repo.path);
  return (
    <Card icon={<PlayCircle />} title={t("agents.actions")} view="agents">
      {runs.isError ? (
        <Empty>{t("dashboard.githubOff")}</Empty>
      ) : !runs.data ? (
        <Loading />
      ) : runs.data.length === 0 ? (
        <Empty>{t("dashboard.noChecks")}</Empty>
      ) : (
        runs.data.slice(0, 5).map((run) => (
          <Row
            key={run.databaseId}
            lead={<StatusIcon status={ghStatus(run.status, run.conclusion)} />}
            title={run.displayTitle}
            meta={`${run.workflowName} · ${run.headBranch}`}
            trail={formatAge(run.updatedAt, undefined, t.locale)}
            onClick={() => {
              select({ type: "workflow", id: run.databaseId });
              go("agents");
            }}
          />
        ))
      )}
    </Card>
  );
}

function PreviewCard({ repo }: { repo: RepositoryInfo }) {
  const t = useT();
  const targets = usePreviewTargets(repo.path).data ?? [];
  const { runs, select } = usePreviewStore();
  if (targets.length === 0) return null;
  return (
    <Card icon={<MonitorSmartphone />} title={t("view.preview")} view="preview">
      {targets.slice(0, 5).map((target) => {
        const run = runOf(runs, target.id);
        return (
          <Row
            key={target.id}
            lead={
              <span
                className={cn(
                  "size-2 rounded-full",
                  run.status === "ready"
                    ? "bg-added-foreground"
                    : run.status === "starting"
                      ? "bg-primary"
                      : run.status === "failed"
                        ? "bg-removed-foreground"
                        : "bg-white/20",
                )}
              />
            }
            title={target.name}
            meta={`${target.framework} · ${target.dir || "."}`}
            trail={run.url ?? undefined}
            onClick={() => {
              select(target.id);
              go("preview");
            }}
          />
        );
      })}
    </Card>
  );
}

function greeting(hour: number) {
  return hour < 5
    ? "dashboard.evening"
    : hour < 12
      ? "dashboard.morning"
      : hour < 18
        ? "dashboard.afternoon"
        : "dashboard.evening";
}

/** Control center: what needs attention across Linear, GitHub, agents and running apps. */
export function Dashboard({ repo }: { repo: RepositoryInfo }) {
  const t = useT();
  const account = useActiveAccount();
  const identity = useGitIdentity().data;
  const name = (account?.userName || identity?.name || "").split(" ")[0];
  const now = new Date();
  return (
    <section aria-label={t("view.home")} className="flex h-full flex-col">
      <PanelHeader className="gap-2 text-[13px]">
        <span className="text-muted-foreground">{repo.name}</span>
        <span className="text-muted-foreground/60">/</span>
        <span className="font-medium">{t("view.home")}</span>
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-12">
        <div className="mx-auto max-w-[1080px] pt-10">
          <h1 className="font-display text-[30px] text-foreground">
            {t(greeting(now.getHours()))}
            {name && `, ${name}`}
          </h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            {now.toLocaleDateString(t.locale, { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <Kpis repo={repo} />
          <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
            <LinearCard />
            <PullRequestsCard repo={repo} />
            <RepoCard repo={repo} />
            <AgentsCard repo={repo} />
            <ChecksCard repo={repo} />
            <PreviewCard repo={repo} />
          </div>
        </div>
      </div>
    </section>
  );
}

export default Dashboard;
