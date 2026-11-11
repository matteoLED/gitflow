import { useShallow } from "zustand/react/shallow";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, ChevronRight, Columns2, Plus, Sparkles, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/states";
import { RowSkeleton, SkeletonList } from "@/components/skeletons";
import { ClaudeIcon } from "./agent-icons";
import { AgentDefinitionsSection } from "./AgentDefinitions";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { formatAge } from "@/lib/format-date";
import { useWorkflowRuns } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAgentsStore, type AgentSelection, type AgentsListTab } from "@/stores/agents-store";
import { StatusIcon, ghStatus } from "./status";

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <li className="mb-1.5">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
        className="mt-1 flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium text-muted-foreground outline-none hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="font-medium">{title}</span>
        {count !== undefined && <span>{count}</span>}
        <ChevronRight aria-hidden className={cn("size-3 transition-transform", !collapsed && "rotate-90")} />
      </button>
      {!collapsed && <ul className="mt-0.5">{children}</ul>}
    </li>
  );
}

type ItemProps = { selection: AgentSelection; icon: ReactNode; title: string; meta: string; age: string | null };

function Item({ selection, icon, title, meta, age }: ItemProps) {
  const t = useT();
  const { selection: current, select } = useAgentsStore(
    useShallow((s) => ({ selection: s.selection, select: s.select })),
  );
  const selected = JSON.stringify(current) === JSON.stringify(selection);
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => select(selection)}
        className={cn(
          "grid w-full grid-cols-[14px_1fr_auto] items-center gap-x-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring",
          selected && "bg-white/[0.08]",
        )}
      >
        {icon}
        <span className="truncate text-[12.5px]">{title}</span>
        <span className="text-[11.5px] text-muted-foreground">{age && formatAge(age, undefined, t.locale)}</span>
        <span className="col-start-2 col-end-4 truncate text-[11.5px] text-muted-foreground">{meta}</span>
      </button>
    </li>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <li className="px-2.5 py-1.5 text-[12px] text-muted-foreground">{children}</li>;
}

/** Item rows while a list loads: 48px, an icon and two lines, as `Item`. */
function ItemsSkeleton() {
  return (
    <li>
      <SkeletonList rows={4} row={(i) => <RowSkeleton i={i} height={48} />} />
    </li>
  );
}

const matches = (query: string, ...texts: (string | null)[]) =>
  !query || texts.some((text) => text?.toLowerCase().includes(query.toLowerCase()));

function AppRuns({ repoPath, query }: { repoPath: string; query: string }) {
  const t = useT();
  // One entry per conversation: its first run.
  const runs = useAgentsStore((s) => s.runs).filter(
    (r) => r.repoPath === repoPath && r.thread === r.id && matches(query, r.title),
  );
  const select = useAgentsStore((s) => s.select);
  return (
    <Section title={t("agents.runs")} count={runs.length}>
      {runs.length === 0 &&
        (query ? (
          <Empty>{t("agents.noRuns")}</Empty>
        ) : (
          <li>
            <EmptyState
              size="sm"
              className="h-auto py-4"
              icon={<Sparkles />}
              title={t("agents.noRuns")}
              hint={t("agents.noRunsHint")}
              action={{ label: t("agents.startTask"), onClick: () => select({ type: "new" }) }}
            />
          </li>
        ))}
      {runs.map((run) => (
        <Item
          key={run.id}
          selection={{ type: "run", id: run.id }}
          icon={<StatusIcon status={run.status} />}
          title={run.title}
          meta={`${run.agent === "claude" ? "Claude Code" : "Codex"} · ${t.plural("agents.steps", run.steps.length)}`}
          age={run.startedAt}
        />
      ))}
    </Section>
  );
}

function ClaudeSessions({ repoPath, query }: { repoPath: string; query: string }) {
  const t = useT();
  const sessions = useQuery({
    queryKey: ["agent-sessions", repoPath],
    queryFn: () => gitBackend.listAgentSessions(repoPath),
    refetchInterval: 30_000,
  });
  // Conversations started from the app are already under Runs: listed once, there.
  const fromApp = useAgentsStore(
    useShallow((s) => s.runs.filter((r) => r.repoPath === repoPath && r.sessionId).map((r) => r.sessionId)),
  );
  const visible = (sessions.data ?? []).filter((s) => !fromApp.includes(s.id) && matches(query, s.title, s.gitBranch));
  return (
    <Section title={t("agents.sessions")} count={sessions.data ? visible.length : undefined}>
      {sessions.isPending && <ItemsSkeleton />}
      {sessions.isError && <Empty>{toGitError(sessions.error).message}</Empty>}
      {sessions.data && visible.length === 0 && <Empty>{t("agents.noSessions")}</Empty>}
      {visible.map((s) => (
        <Item
          key={s.id}
          selection={{ type: "session", id: s.id }}
          icon={<ClaudeIcon className="size-3.5 text-[#d97757]" />}
          title={s.title}
          meta={[s.gitBranch, t.plural("agents.prompts", s.prompts), t.plural("agents.tools", s.toolCalls)]
            .filter(Boolean)
            .join(" · ")}
          age={s.updatedAt}
        />
      ))}
    </Section>
  );
}

function WorkflowRuns({ repoPath, query }: { repoPath: string; query: string }) {
  const t = useT();
  const runs = useWorkflowRuns(repoPath);
  const visible = (runs.data ?? []).filter((r) => matches(query, r.displayTitle, r.workflowName, r.headBranch));
  return (
    <Section title={t("agents.actions")} count={runs.data ? visible.length : undefined}>
      {runs.isPending && <ItemsSkeleton />}
      {runs.isError && (
        <Empty>
          <TriangleAlert aria-hidden className="mr-1 inline size-3" />
          {toGitError(runs.error).message}
        </Empty>
      )}
      {runs.data && visible.length === 0 && <Empty>{t("agents.noActions")}</Empty>}
      {visible.map((run) => (
        <Item
          key={run.databaseId}
          selection={{ type: "workflow", id: run.databaseId }}
          icon={<StatusIcon status={ghStatus(run.status, run.conclusion)} />}
          title={run.displayTitle}
          meta={`${run.workflowName} · ${run.headBranch}`}
          age={run.createdAt}
        />
      ))}
    </Section>
  );
}

/** Sidebar of the Agents view: runs started here, Claude Code sessions, GitHub Actions. */
export function AgentsList({ repoPath, query }: { repoPath: string; query: string }) {
  const t = useT();
  const { selection, select, listTab, setListTab } = useAgentsStore(
    useShallow((s) => ({ selection: s.selection, select: s.select, listTab: s.listTab, setListTab: s.setListTab })),
  );
  const item =
    "mb-1 flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-sidebar-foreground outline-none transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <Tabs value={listTab} onValueChange={(v) => setListTab(v as AgentsListTab)} className="mt-2 min-h-0 flex-1 gap-3">
      <TabsList aria-label={t("agents.title")} className="mx-2">
        <TabsTrigger value="runs">{t("agents.tabRuns")}</TabsTrigger>
        <TabsTrigger value="agents">{t("agents.tabAgents")}</TabsTrigger>
        <TabsTrigger value="actions">{t("agents.tabActions")}</TabsTrigger>
      </TabsList>
      <nav aria-label={t("agents.title")} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <TabsContent value="runs">
          <button
            type="button"
            onClick={() => select({ type: "new" })}
            className={cn(item, selection.type === "new" && "bg-white/[0.08] text-foreground")}
          >
            <Plus aria-hidden className="size-3.5 text-primary" />
            {t("agents.new")}
          </button>
          <button
            type="button"
            onClick={() => select({ type: "usage" })}
            className={cn(item, selection.type === "usage" && "bg-white/[0.08] text-foreground")}
          >
            <BarChart3 aria-hidden className="size-3.5 text-muted-foreground" />
            {t("usage.open")}
          </button>
          <button
            type="button"
            onClick={() => select({ type: "board" })}
            className={cn(item, selection.type === "board" && "bg-white/[0.08] text-foreground")}
          >
            <Columns2 aria-hidden className="size-3.5 text-muted-foreground" />
            {t("board.open")}
          </button>
          <ul>
            <AppRuns repoPath={repoPath} query={query} />
            <ClaudeSessions repoPath={repoPath} query={query} />
          </ul>
        </TabsContent>
        <TabsContent value="agents">
          <ul>
            <AgentDefinitionsSection repoPath={repoPath} query={query} />
          </ul>
        </TabsContent>
        <TabsContent value="actions">
          <ul>
            <WorkflowRuns repoPath={repoPath} query={query} />
          </ul>
        </TabsContent>
      </nav>
    </Tabs>
  );
}
