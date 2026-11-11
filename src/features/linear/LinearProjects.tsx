import { Box } from "lucide-react";
import { AuthorAvatar } from "@/components/author-avatar";
import { PanelHeader, PanelLoading } from "@/components/layout/panel";
import { DataUnavailable, EmptyState } from "@/components/states";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useLinearStore } from "@/stores/linear-store";
import type { LinearProject } from "@/types/git";
import { AssistantToggle } from "@/features/agents/AssistantToggle";
import { CreateIssueButton } from "./CreateIssue";
import { LinearIcon } from "./LinearIcon";
import { ProgressRing } from "./LinearList";
import { useActiveAccount, useProjects } from "./linear-queries";
import { ProjectIcon } from "./ProjectIcon";

const STATUS_ORDER: NonNullable<LinearProject["status"]>["type"][] = [
  "started",
  "planned",
  "paused",
  "backlog",
  "completed",
  "canceled",
];

function ProjectRow({ project }: { project: LinearProject }) {
  const t = useT();
  const setProject = useLinearStore((s) => s.setProject);
  const closed = project.status?.type === "completed" || project.status?.type === "canceled";
  return (
    <li>
      <button
        type="button"
        onClick={() => setProject(project.id)}
        className={cn(
          "grid h-11 w-full grid-cols-[minmax(0,1fr)_150px_110px_120px_90px] items-center gap-4 border-b border-white/[0.05] px-5 text-left text-[13px] outline-none hover:bg-white/[0.035] focus-visible:bg-white/[0.05]",
          closed && "text-muted-foreground",
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid size-6 shrink-0 place-items-center rounded-md"
            style={{ background: `color-mix(in oklab, ${project.color} 16%, transparent)` }}
          >
            <ProjectIcon project={project} />
          </span>
          <span className="truncate font-medium">{project.name}</span>
          <span className="truncate text-[11.5px] text-muted-foreground">
            {project.teams.nodes.map((team) => team.key).join(", ")}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          {project.status && (
            <>
              <span className="size-2 rounded-full" style={{ background: project.status.color }} />
              <span className="truncate">{project.status.name}</span>
            </>
          )}
        </span>
        <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground tabular-nums">
          <ProgressRing value={project.progress} color={project.status?.color ?? project.color} />
          {Math.round(project.progress * 100)}%
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
          {project.lead && (
            <>
              <AuthorAvatar name={project.lead.name} src={project.lead.avatarUrl} className="size-5 text-[9px]" />
              <span className="truncate">{project.lead.name}</span>
            </>
          )}
        </span>
        <span className="text-right text-[12.5px] text-muted-foreground tabular-nums">
          {project.targetDate &&
            new Date(project.targetDate).toLocaleDateString(t.locale, { day: "numeric", month: "short" })}
        </span>
      </button>
    </li>
  );
}

/** Linear's Projects page: every project of the workspace, active ones first. */
export function LinearProjects() {
  const t = useT();
  const account = useActiveAccount();
  const projects = useProjects(account?.id);
  const header = (
    <PanelHeader className="gap-1.5 text-[13px]">
      <LinearIcon className="size-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{account?.name}</span>
      <span className="text-muted-foreground/60">/</span>
      <span className="font-medium">{t("linear.projects")}</span>
      {projects.data && <span className="text-muted-foreground">{projects.data.length}</span>}
      <span className="ml-auto" />
      <AssistantToggle />
      <CreateIssueButton variant="header" />
    </PanelHeader>
  );
  if (projects.isError)
    return (
      <DataUnavailable
        title={t("linear.projectsError")}
        error={projects.error}
        onRetry={() => void projects.refetch()}
      />
    );
  if (!projects.data) return <PanelLoading title={t("common.loading")} variant="grid-wave" />;
  const sorted = [...projects.data].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status?.type ?? "backlog") - STATUS_ORDER.indexOf(b.status?.type ?? "backlog") ||
      b.progress - a.progress,
  );
  return (
    <section aria-label={t("linear.projects")} className="flex h-full flex-col">
      {header}
      {sorted.length === 0 ? (
        <EmptyState icon={<Box />} title={t("linear.noProjects")} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="sticky top-0 z-10 grid h-9 grid-cols-[minmax(0,1fr)_150px_110px_120px_90px] items-center gap-4 border-b border-white/[0.06] bg-background px-5 text-[12px] text-muted-foreground">
            <span>{t("linear.name")}</span>
            <span>{t("linear.status")}</span>
            <span>{t("linear.progress")}</span>
            <span>{t("linear.lead")}</span>
            <span className="text-right">{t("linear.target")}</span>
          </div>
          <ul>
            {sorted.map((p) => (
              <ProjectRow key={p.id} project={p} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
