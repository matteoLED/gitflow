import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { PanelHeader, PanelLoading } from "@/components/layout/panel";
import { cn } from "@/lib/utils";
import { useMoveIssue } from "./use-move-issue";
import { DataUnavailable, EmptyState } from "@/components/states";
import { useT, type MessageKey } from "@/i18n";
import { formatAge } from "@/lib/format-date";
import { useLinearStore } from "@/stores/linear-store";
import type { LinearState } from "@/types/git";
import { LinearIcon } from "./LinearIcon";
import { PriorityIcon, StateDot } from "./LinearList";
import { useActiveAccount, useAllWorkspaces, useWorkspaceIssues, type WorkspaceIssue } from "./linear-queries";

/** Board columns, in Linear's order; the open states only (the list holds no done/canceled issue). */
const COLUMNS: { type: LinearState["type"]; label: MessageKey }[] = [
  { type: "triage", label: "linear.triage" },
  { type: "backlog", label: "linear.backlog" },
  { type: "unstarted", label: "linear.unstarted" },
  { type: "started", label: "linear.started" },
];

const cardId = (issue: WorkspaceIssue) => `${issue.orgId}:${issue.id}`;

function Card({ issue, showOrg }: { issue: WorkspaceIssue; showOrg: boolean }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: cardId(issue), data: issue });
  return (
    <li ref={setNodeRef} {...listeners} {...attributes} className={cn("touch-none", isDragging && "opacity-30")}>
      <CardBody issue={issue} showOrg={showOrg} />
    </li>
  );
}

function CardBody({ issue, showOrg, lifted = false }: { issue: WorkspaceIssue; showOrg: boolean; lifted?: boolean }) {
  const t = useT();
  const setIssue = useLinearStore((s) => s.setIssue);
  return (
    <>
      <button
        type="button"
        onClick={() => setIssue(issue.id, issue.orgId)}
        className={cn(
          "w-full rounded-lg border border-white/[0.07] bg-card p-3 text-left shadow-[0_1px_2px_rgb(0_0_0/0.3)] outline-none transition-colors hover:border-white/[0.13] hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-ring",
          lifted && "rotate-2 cursor-grabbing border-white/20 bg-[#26272c] shadow-2xl",
        )}
      >
        <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          {issue.identifier}
          {showOrg && <span className="truncate">· {issue.orgName}</span>}
          <span className="ml-auto">{formatAge(issue.updatedAt, undefined, t.locale)}</span>
        </span>
        <span className="mt-1 flex items-start gap-2 text-[13px] leading-snug">
          <StateDot state={issue.state} />
          <span className="line-clamp-2">{issue.title}</span>
        </span>
        <span className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <span className="grid size-5 place-items-center rounded border border-white/[0.08]">
            <PriorityIcon priority={issue.priority} />
          </span>
          {issue.project && (
            <span className="max-w-40 truncate rounded border border-white/[0.08] px-1.5 py-0.5">
              {issue.project.name}
            </span>
          )}
          {issue.labels.nodes.slice(0, 2).map((l) => (
            <span key={l.name} className="flex items-center gap-1 rounded border border-white/[0.08] px-1.5 py-0.5">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: l.color }} />
              {l.name}
            </span>
          ))}
        </span>
      </button>
    </>
  );
}

function Column({
  type,
  label,
  items,
  showOrg,
}: {
  type: LinearState["type"];
  label: string;
  items: WorkspaceIssue[];
  showOrg: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: type });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-[300px] shrink-0 flex-col rounded-xl bg-white/[0.02] transition-colors",
        isOver && "bg-primary/[0.07] ring-1 ring-primary/40",
      )}
    >
      <h3 className="flex h-10 shrink-0 items-center gap-2 px-3 text-[13px] font-medium">
        {items[0] ? (
          <StateDot state={items[0].state} />
        ) : (
          <span className="size-3 rounded-full border-[1.5px] border-muted-foreground/50" />
        )}
        {label}
        <span className="font-normal text-muted-foreground">{items.length}</span>
      </h3>
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {items.map((issue) => (
          <Card key={cardId(issue)} issue={issue} showOrg={showOrg} />
        ))}
      </ul>
    </div>
  );
}

/** Linear's board: the user's open issues as columns by status, across one or all workspaces. */
export function LinearBoard() {
  const t = useT();
  const all = useAllWorkspaces();
  const account = useActiveAccount();
  const issues = useWorkspaceIssues();
  const move = useMoveIssue();
  const [dragged, setDragged] = useState<WorkspaceIssue | null>(null);
  // A small move starts a drag; a plain click still opens the issue.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const header = (
    <PanelHeader className="gap-1.5 text-[13px]">
      <LinearIcon className="size-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{all ? t("linear.allWorkspaces") : account?.name}</span>
      <span className="text-muted-foreground/60">/</span>
      <span className="font-medium">{t("linear.myIssues")}</span>
      {issues.data && <span className="text-muted-foreground">{issues.data.length}</span>}
    </PanelHeader>
  );
  if (!account) return <EmptyState icon={<LinearIcon />} title={t("linear.pick")} description={t("linear.pickHint")} />;
  if (issues.error && !issues.data)
    return <DataUnavailable title={t("linear.loadError")} error={issues.error} onRetry={issues.refetch} />;
  if (!issues.data) return <PanelLoading title={t("linear.loading")} variant="grid-wave" />;
  const columns = COLUMNS.map((c) => ({ ...c, items: issues.data?.filter((i) => i.state.type === c.type) ?? [] }));
  return (
    <section aria-label={t("linear.myIssues")} className="flex h-full flex-col">
      {header}
      <DndContext
        sensors={sensors}
        onDragStart={({ active }) => setDragged(active.data.current as WorkspaceIssue)}
        onDragCancel={() => setDragged(null)}
        onDragEnd={({ active, over }) => {
          setDragged(null);
          if (over) void move(active.data.current as WorkspaceIssue, over.id as LinearState["type"]);
        }}
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
          {columns
            .filter((c) => c.type !== "triage" || c.items.length > 0)
            .map((column) => (
              <Column key={column.type} type={column.type} label={t(column.label)} items={column.items} showOrg={all} />
            ))}
        </div>
        <DragOverlay dropAnimation={null}>{dragged && <CardBody issue={dragged} showOrg={all} lifted />}</DragOverlay>
      </DndContext>
    </section>
  );
}
