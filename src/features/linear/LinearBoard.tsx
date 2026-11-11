import { useShallow } from "zustand/react/shallow";
import { useState } from "react";
import { ChevronDown, CircleDashed, Columns3, Rows3 } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { PanelHeader } from "@/components/layout/panel";
import { RowSkeleton, SkeletonList, skeletonWidth } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useMoveIssue } from "./use-move-issue";
import { DataUnavailable, EmptyState } from "@/components/states";
import { useT } from "@/i18n";
import { formatAge } from "@/lib/format-date";
import { useLinearStore } from "@/stores/linear-store";
import type { LinearCycle, LinearProject } from "@/types/git";
import { AuthorAvatar } from "@/components/author-avatar";
import { boardColumns, type BoardColumn } from "./board-columns";
import { AssistantToggle } from "@/features/agents/AssistantToggle";
import { CreateIssueButton } from "./CreateIssue";
import { ProjectIcon } from "./ProjectIcon";
import { LinearIcon } from "./LinearIcon";
import { PriorityIcon, ProgressRing, StateDot } from "./LinearList";
import { LINEAR_KEY_INPUT } from "./ConnectLinear";
import {
  useActiveAccount,
  useActiveCycles,
  useAllWorkspaces,
  useBoardIssues,
  useLinearAccounts,
  useOpenProject,
  useTeamStates,
  type WorkspaceIssue,
} from "./linear-queries";

const cardId = (issue: WorkspaceIssue) => `${issue.orgId}:${issue.id}`;

type CardProps = { issue: WorkspaceIssue; showOrg: boolean; showAssignee: boolean };

function Card({ issue, showOrg, showAssignee }: CardProps) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: cardId(issue), data: issue });
  return (
    <li ref={setNodeRef} {...listeners} {...attributes} className={cn("touch-none", isDragging && "opacity-30")}>
      <CardBody issue={issue} showOrg={showOrg} showAssignee={showAssignee} />
    </li>
  );
}

const CHIP = "flex h-6 max-w-44 items-center gap-1.5 rounded-full border border-white/[0.08] px-2";

function CardBody({ issue, showOrg, showAssignee, lifted = false }: CardProps & { lifted?: boolean }) {
  const t = useT();
  const setIssue = useLinearStore((s) => s.setIssue);
  return (
    <button
      type="button"
      onClick={() => setIssue(issue.id, issue.orgId)}
      className={cn(
        "w-full rounded-lg border border-white/[0.06] bg-white/[0.035] px-3 pt-2.5 pb-2.5 text-left shadow-[0_1px_2px_rgb(0_0_0/0.25)] outline-none transition-colors hover:border-white/[0.1] hover:bg-white/[0.055] focus-visible:ring-2 focus-visible:ring-ring",
        lifted && "rotate-2 cursor-grabbing border-white/20 bg-popover shadow-2xl",
      )}
    >
      {/* Id left, assignee right — the same place on every card, as in Linear. */}
      <span className="flex h-5 items-center gap-1.5 text-[12px] text-muted-foreground">
        <span className="tabular-nums">{issue.identifier}</span>
        {showOrg && <span className="truncate">· {issue.orgName}</span>}
        {showAssignee && issue.assignee && (
          <AuthorAvatar
            name={issue.assignee.name}
            src={issue.assignee.avatarUrl}
            className="ml-auto size-5 text-[9px]"
          />
        )}
      </span>
      <span className="mt-1 flex items-start gap-2 text-[13px] leading-[1.35] font-medium">
        <span className="mt-px">
          <StateDot state={issue.state} />
        </span>
        <span className="line-clamp-2">{issue.title}</span>
      </span>
      {(issue.priority > 0 || issue.project || issue.labels.nodes.length > 0) && (
        <span className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
          {/* "No priority" says nothing: the chip shows only when there is one. */}
          {issue.priority > 0 && (
            <span className={cn(CHIP, "w-6 justify-center px-0")} title={issue.priorityLabel}>
              <PriorityIcon priority={issue.priority} />
            </span>
          )}
          {issue.project && (
            <span className={CHIP}>
              <ProjectIcon project={issue.project} className="size-3" />
              <span className="truncate">{issue.project.name}</span>
            </span>
          )}
          {issue.labels.nodes.slice(0, 2).map((l) => (
            <span key={l.name} className={CHIP}>
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
              <span className="truncate">{l.name}</span>
            </span>
          ))}
          {issue.labels.nodes.length > 2 && <span className={CHIP}>+{issue.labels.nodes.length - 2}</span>}
        </span>
      )}
      <span className="mt-2 block text-[11.5px] text-muted-foreground/80">
        {t("linear.updated")} {formatAge(issue.updatedAt, undefined, t.locale)}
      </span>
    </button>
  );
}

function Column({
  column,
  showOrg,
  showAssignee,
}: {
  column: BoardColumn<WorkspaceIssue>;
  showOrg: boolean;
  showAssignee: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key, data: column });
  const closed = column.type === "completed" || column.type === "canceled";
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-[320px] shrink-0 flex-col rounded-xl bg-white/[0.012] transition-colors",
        isOver && "bg-primary/[0.07] ring-1 ring-primary/40",
      )}
    >
      <h3 className="flex h-11 shrink-0 items-center gap-2 px-3.5 text-[13px] font-medium">
        <StateDot state={column} />
        {column.name}
        <span className="font-normal text-muted-foreground">{column.items.length}</span>
      </h3>
      <ul className={cn("min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5 pb-2", closed && "opacity-75")}>
        {column.items.map((issue) => (
          <Card key={cardId(issue)} issue={issue} showOrg={showOrg} showAssignee={showAssignee} />
        ))}
      </ul>
    </div>
  );
}

/** Board columns of cards, or the list's 40px rows, to the layout the issues will land in. */
function IssuesSkeleton({ layout }: { layout: "board" | "list" }) {
  if (layout === "list")
    return (
      <SkeletonList
        rows={12}
        className="min-h-0 flex-1"
        row={(i) => <RowSkeleton i={i} height={40} lines={1} className="gap-3 border-b border-white/[0.04] px-5" />}
      />
    );
  return (
    <SkeletonList
      rows={3}
      className="flex min-h-0 flex-1 gap-3 p-3 [&>div]:shrink-0"
      row={(col) => (
        <div className="flex w-[320px] flex-col rounded-xl bg-white/[0.012]">
          <div className="flex h-11 items-center gap-2 px-3.5">
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton className="h-2.5 w-20" />
          </div>
          <div className="space-y-1.5 px-1.5">
            {Array.from({ length: 4 - col }, (_, i) => (
              <div key={i} className="h-[92px] space-y-2.5 rounded-lg border border-white/[0.06] bg-white/[0.035] p-3">
                <Skeleton className="h-2 w-12 bg-white/[0.05]" />
                <Skeleton className="h-2.5" style={{ width: skeletonWidth(col * 4 + i) }} />
                <Skeleton className="h-2 w-16 bg-white/[0.04]" />
              </div>
            ))}
          </div>
        </div>
      )}
    />
  );
}

/** Linear's board: the user's issues (or a project's) in every workflow column, across one or all workspaces. */
export function LinearBoard() {
  const t = useT();
  const all = useAllWorkspaces();
  const accounts = useLinearAccounts();
  const account = useActiveAccount();
  const open = useOpenProject();
  const cycleView = useLinearStore((s) => s.page === "cycle");
  // Everyone's issues of the workspace in view: like the cycle, one workspace and every assignee.
  const allView = useLinearStore((s) => s.page === "all");
  const cycles = useActiveCycles(cycleView ? account?.id : undefined).data;
  const issues = useBoardIssues();
  const teams = useTeamStates(open?.orgId ?? account?.id).data;
  const setPage = useLinearStore((s) => s.setPage);
  const layout = useLinearStore((s) => s.layout);
  const move = useMoveIssue();
  const [dragged, setDragged] = useState<WorkspaceIssue | null>(null);
  // A small move starts a drag; a plain click still opens the issue.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const showOrg = all && !open && !cycleView && !allView;
  const showAssignee = !!open || cycleView || allView;
  const header = (
    <PanelHeader className="gap-1.5 text-[13px]">
      <LinearIcon className="size-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{showOrg ? t("linear.allWorkspaces") : account?.name}</span>
      <span className="text-muted-foreground/60">/</span>
      {open && (
        <>
          <button
            type="button"
            onClick={() => setPage("projects")}
            className="text-muted-foreground hover:text-foreground"
          >
            {t("linear.projects")}
          </button>
          <span className="text-muted-foreground/60">/</span>
        </>
      )}
      {cycleView ? (
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          <CircleDashed aria-hidden className="size-3.5 text-primary" />
          <span className="truncate">{cycles?.length === 1 ? cycleName(cycles[0], t) : t("linear.currentCycle")}</span>
        </span>
      ) : open ? (
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          {open.project && <ProjectIcon project={open.project} />}
          <span className="truncate">{open.project?.name ?? t("linear.project")}</span>
        </span>
      ) : (
        <span className="font-medium">{t(allView ? "linear.allIssues" : "linear.myIssues")}</span>
      )}
      {issues.data && <span className="text-muted-foreground">{issues.data.length}</span>}
      {open?.project && <ProjectMeta project={open.project} />}
      {cycleView && cycles?.map((c) => <CycleMeta key={c.id} cycle={c} showTeam={cycles.length > 1} />)}
      <span className="ml-auto" />
      <LayoutSwitch />
      <AssistantToggle />
      <CreateIssueButton variant="header" />
    </PanelHeader>
  );
  if (accounts.data?.length === 0)
    return (
      <EmptyState
        icon={<LinearIcon />}
        title={t("linear.notConnected")}
        hint={t("linear.notConnectedHint")}
        action={{
          label: t("linear.connect"),
          onClick: () => document.getElementById(LINEAR_KEY_INPUT)?.focus(),
        }}
      />
    );
  const loading = (
    <section aria-label={t("linear.myIssues")} className="flex h-full flex-col">
      <PanelHeader />
      <IssuesSkeleton layout={layout} />
    </section>
  );
  if (!account) return loading;
  if (issues.error && !issues.data)
    return <DataUnavailable title={t("linear.loadError")} error={issues.error} onRetry={issues.refetch} />;
  if (!issues.data) return loading;
  if (cycleView && cycles?.length === 0)
    return (
      <section aria-label={t("linear.currentCycle")} className="flex h-full flex-col">
        {header}
        <EmptyState icon={<CircleDashed />} title={t("linear.noCycle")} hint={t("linear.noCycleHint")} />
      </section>
    );
  const columns = boardColumns(
    issues.data,
    showOrg ? undefined : teams,
    (cycleView ? cycles?.map((c) => c.team.id) : open?.project?.teams.nodes.map((x) => x.id)) ?? [],
  );
  if (layout === "list")
    return (
      <section aria-label={t("linear.myIssues")} className="flex h-full flex-col">
        {header}
        <IssueList columns={columns} showOrg={showOrg} showAssignee={showAssignee} />
      </section>
    );
  return (
    <section aria-label={t("linear.myIssues")} className="flex h-full flex-col">
      {header}
      <DndContext
        sensors={sensors}
        onDragStart={({ active }) => setDragged(active.data.current as WorkspaceIssue)}
        onDragCancel={() => setDragged(null)}
        onDragEnd={({ active, over }) => {
          setDragged(null);
          const column = over?.data.current as BoardColumn<WorkspaceIssue> | undefined;
          if (column) void move(active.data.current as WorkspaceIssue, column);
        }}
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
          {columns.map((column) => (
            <Column key={column.key} column={column} showOrg={showOrg} showAssignee={showAssignee} />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragged && <CardBody issue={dragged} showOrg={showOrg} showAssignee={showAssignee} lifted />}
        </DragOverlay>
      </DndContext>
    </section>
  );
}

function LayoutSwitch() {
  const t = useT();
  const { layout, setLayout } = useLinearStore(useShallow((s) => ({ layout: s.layout, setLayout: s.setLayout })));
  return (
    <div role="radiogroup" aria-label={t("linear.layout")} className="mr-1 flex rounded-md bg-white/[0.05] p-0.5">
      {(
        [
          ["board", Columns3, "linear.board"],
          ["list", Rows3, "linear.list"],
        ] as const
      ).map(([value, Icon, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={layout === value}
          aria-label={t(label)}
          title={t(label)}
          onClick={() => setLayout(value)}
          className={cn(
            "grid h-6 w-7 place-items-center rounded-[5px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
            layout === value
              ? "bg-white/[0.12] text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon aria-hidden className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

/** Linear's list: one section per status, one dense row per issue, across the page's width. */
function IssueList({
  columns,
  showOrg,
  showAssignee,
}: {
  columns: BoardColumn<WorkspaceIssue>[];
  showOrg: boolean;
  showAssignee: boolean;
}) {
  const t = useT();
  const setIssue = useLinearStore((s) => s.setIssue);
  const [folded, setFolded] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.type === "completed" || c.type === "canceled").map((c) => c.key)),
  );
  const toggle = (key: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {columns
        .filter((c) => c.items.length > 0)
        .map((column) => (
          <section key={column.key}>
            <h3>
              <button
                type="button"
                aria-expanded={!folded.has(column.key)}
                onClick={() => toggle(column.key)}
                className="sticky top-0 flex h-9 w-full items-center gap-2 border-b border-white/[0.05] bg-white/[0.025] px-5 text-left text-[13px] font-medium"
              >
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "size-3.5 text-muted-foreground transition-transform",
                    folded.has(column.key) && "-rotate-90",
                  )}
                />
                <StateDot state={column} />
                {column.name}
                <span className="font-normal text-muted-foreground">{column.items.length}</span>
              </button>
            </h3>
            {!folded.has(column.key) && (
              <ul>
                {column.items.map((issue) => (
                  <li key={cardId(issue)}>
                    <button
                      type="button"
                      onClick={() => setIssue(issue.id, issue.orgId)}
                      className="flex h-10 w-full items-center gap-3 border-b border-white/[0.04] px-5 text-left text-[13px] outline-none hover:bg-white/[0.035] focus-visible:bg-white/[0.05]"
                    >
                      <span className="grid w-4 shrink-0 place-items-center">
                        <PriorityIcon priority={issue.priority} />
                      </span>
                      <span className="w-[72px] shrink-0 text-[12px] text-muted-foreground tabular-nums">
                        {issue.identifier}
                      </span>
                      <StateDot state={issue.state} />
                      <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                      {issue.labels.nodes.slice(0, 2).map((l) => (
                        <span
                          key={l.name}
                          className="hidden shrink-0 items-center gap-1 rounded-full border border-white/[0.08] px-2 py-0.5 text-[11.5px] text-muted-foreground lg:flex"
                        >
                          <span className="size-1.5 rounded-full" style={{ backgroundColor: l.color }} />
                          {l.name}
                        </span>
                      ))}
                      {issue.project && (
                        <span className="hidden max-w-44 shrink-0 items-center gap-1 rounded-full border border-white/[0.08] px-2 py-0.5 text-[11.5px] text-muted-foreground md:flex">
                          <ProjectIcon project={issue.project} className="size-3" />
                          <span className="truncate">{issue.project.name}</span>
                        </span>
                      )}
                      {showOrg && <span className="shrink-0 text-[11.5px] text-muted-foreground">{issue.orgName}</span>}
                      {showAssignee && issue.assignee && (
                        <AuthorAvatar
                          name={issue.assignee.name}
                          src={issue.assignee.avatarUrl}
                          className="size-5 text-[9px]"
                        />
                      )}
                      <span className="w-12 shrink-0 text-right text-[12px] text-muted-foreground">
                        {formatAge(issue.updatedAt, undefined, t.locale)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
    </div>
  );
}

/** Status, progress and target date of the project in view. */
function ProjectMeta({ project }: { project: LinearProject }) {
  const t = useT();
  return (
    <span className="ml-2 flex items-center gap-2 text-[12px] text-muted-foreground">
      {project.status && (
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ background: project.status.color }} />
          {project.status.name}
        </span>
      )}
      <span className="tabular-nums">{Math.round(project.progress * 100)}%</span>
      {project.targetDate && (
        <span>
          {t("linear.target")}{" "}
          {new Date(project.targetDate).toLocaleDateString(t.locale, { day: "numeric", month: "short" })}
        </span>
      )}
    </span>
  );
}

const cycleName = (cycle: LinearCycle, t: ReturnType<typeof useT>) =>
  cycle.name || t("linear.cycleNumber", { number: cycle.number });

/** Dates, progress and days left of a current cycle, as in Linear's cycle header. */
function CycleMeta({ cycle, showTeam }: { cycle: LinearCycle; showTeam: boolean }) {
  const t = useT();
  const [now] = useState(Date.now);
  const day = (iso: string) => new Date(iso).toLocaleDateString(t.locale, { day: "numeric", month: "short" });
  const left = Math.max(0, Math.ceil((new Date(cycle.endsAt).getTime() - now) / 86_400_000));
  return (
    <span className="ml-2 flex items-center gap-2 text-[12px] text-muted-foreground">
      {showTeam && (
        <span className="font-medium text-foreground">
          {cycleName(cycle, t)} · {cycle.team.key}
        </span>
      )}
      <span className="flex items-center gap-1 tabular-nums">
        <ProgressRing value={cycle.progress} color="var(--primary)" />
        {Math.round(cycle.progress * 100)}%
      </span>
      <span className="tabular-nums">
        {day(cycle.startsAt)} → {day(cycle.endsAt)}
      </span>
      <span className="tabular-nums">{t("linear.daysLeft", { count: left })}</span>
    </span>
  );
}
