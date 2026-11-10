import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { CommandPalette } from "@/features/command/CommandPalette";
import { WorkList } from "@/features/work/WorkList";
import { WorkPage } from "@/features/work/WorkPage";
import { Group, Panel, useDefaultLayout } from "react-resizable-panels";
import { GitPullRequest, PanelLeftOpen } from "lucide-react";
import { useLayoutStore } from "@/stores/layout-store";
import { ListCollapseContext } from "@/components/layout/ListPanel";
import { BranchesList, BranchSidebar } from "@/features/branches/BranchSidebar";
import { GutterHandle, ResizeHandle } from "@/components/layout/ResizeHandle";
import { ListPanel } from "@/components/layout/ListPanel";
import { SidebarBar, TabSync, TabsBar } from "@/components/layout/TitleBar";
import { EmptyState } from "@/components/states";
import { PullRequestList } from "@/features/github/PullRequestList";
import { AgentsList } from "@/features/agents/AgentsList";
import { PreviewList } from "@/features/preview/PreviewList";
import { LinearList } from "@/features/linear/LinearList";
import { CreateIssueButton } from "@/features/linear/CreateIssue";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { CommitList } from "@/features/history/CommitList";
import { ChangedFilesPanel } from "@/features/changed-files/ChangedFilesPanel";
import { DiffPanel } from "@/features/diff/DiffPanel";
import { ChangesPanel } from "@/features/working-tree/ChangesPanel";
import { WorkingDiffPanel } from "@/features/working-tree/WorkingDiffPanel";
import { WelcomeScreen } from "@/features/repositories/WelcomeScreen";
import { PanelLoading } from "@/components/layout/panel";
import { Columns } from "@/components/layout/Columns";
import { TerminalDock } from "@/features/terminal/TerminalDock";
import { useUiStore } from "@/stores/ui-store";
import { useRepoWatcher } from "@/features/repositories/use-repo-watcher";

// Opened on demand: kept out of the startup bundle.
const AgentDetail = lazy(() => import("@/features/agents/AgentDetail").then((m) => ({ default: m.AgentDetail })));
const LinearIssueView = lazy(() => import("@/features/linear/LinearIssueView"));
const Dashboard = lazy(() => import("@/features/dashboard/Dashboard"));
const PullRequestPage = lazy(() => import("@/features/github/PullRequestPage"));
const CiPage = lazy(() => import("@/features/ci/CiPage").then((m) => ({ default: m.CiPage })));
const CiList = lazy(() => import("@/features/ci/CiPage").then((m) => ({ default: m.CiList })));
const AssistantPanel = lazy(() => import("@/features/agents/AssistantPanel"));
const CodeGraphPage = lazy(() => import("@/features/code-graph/CodeGraph").then((m) => ({ default: m.CodeGraphPage })));
const EditorPage = lazy(() => import("@/features/editor/EditorPage").then((m) => ({ default: m.EditorPage })));
const EditorSidebar = lazy(() => import("@/features/editor/EditorSidebar").then((m) => ({ default: m.EditorSidebar })));
const CodeGraphList = lazy(() => import("@/features/code-graph/CodeGraph").then((m) => ({ default: m.CodeGraphList })));
const BrowserPanel = lazy(() => import("@/features/browser/Browser").then((m) => ({ default: m.BrowserPanel })));
const BrowserTabs = lazy(() => import("@/features/browser/Browser").then((m) => ({ default: m.BrowserTabs })));
const PreviewPanel = lazy(() => import("@/features/preview/PreviewPanel").then((m) => ({ default: m.PreviewPanel })));
import { useWorkspaceStore, type View } from "@/stores/workspace-store";
import type { RepositoryInfo } from "@/types/git";

/** Linear-like frame: the sidebar on the window background, the page inside one rounded inset surface. */
/** Thin rail left when a page's list column is folded: one click brings it back. */
function ListRail({ title, onExpand }: { title: string; onExpand: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={t("layout.showList", { list: title })}
      title={t("layout.showList", { list: title })}
      className="flex w-9 shrink-0 flex-col items-center gap-3 border-r border-white/[0.06] pt-3.5 text-muted-foreground hover:bg-white/[0.03] hover:text-foreground"
    >
      <PanelLeftOpen aria-hidden className="size-3.5" />
      <span className="text-[12px] [writing-mode:vertical-rl]">{title}</span>
    </button>
  );
}

function Frame({
  repo,
  list,
  listTitle = "",
  page: pageId = "",
  children,
}: {
  repo: RepositoryInfo;
  list?: ReactNode;
  listTitle?: string;
  /** Key under which the list's folded state is remembered. */
  page?: string;
  children: ReactNode;
}) {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const collapsed = useLayoutStore((s) => !!s.collapsedLists[pageId]);
  const toggleList = useLayoutStore((s) => s.toggleList);
  const layout = useDefaultLayout({ id: "frame", storage: localStorage });
  const page = (
    <div className={cn("flex h-full flex-col pr-1.5 pb-1.5", !sidebarOpen && "pl-1.5")}>
      <TabsBar />
      <div className="min-h-0 flex-1 overflow-hidden rounded-[10px] border border-white/[0.06] bg-background shadow-[0_1px_3px_rgb(0_0_0/0.35)]">
        {list && collapsed ? (
          <div className="flex h-full">
            <ListRail title={listTitle} onExpand={() => toggleList(pageId)} />
            <div className="min-w-0 flex-1">{children}</div>
          </div>
        ) : list ? (
          <Columns id="list-columns">
            <Panel id="list" defaultSize="20" minSize={220} maxSize="40">
              <ListCollapseContext.Provider value={() => toggleList(pageId)}>{list}</ListCollapseContext.Provider>
            </Panel>
            <ResizeHandle />
            <Panel id="page" minSize={360}>
              {children}
            </Panel>
          </Columns>
        ) : (
          children
        )}
      </div>
    </div>
  );
  if (!sidebarOpen) return page;
  return (
    <Group
      orientation="horizontal"
      className="h-full"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      <Panel id="sidebar" defaultSize="15" minSize={200} maxSize="25">
        <div className="flex h-full flex-col">
          <SidebarBar />
          <div className="min-h-0 flex-1">
            <BranchSidebar repo={repo} />
          </div>
        </div>
      </Panel>
      <GutterHandle />
      <Panel id="main" minSize={480}>
        {page}
      </Panel>
    </Group>
  );
}

function HistoryLayout({ repo }: { repo: RepositoryInfo }) {
  const t = useT();
  return (
    <Frame
      repo={repo}
      page="history"
      listTitle={t("view.branches")}
      list={
        <ListPanel title={t("view.branches")} filterLabel={t("branches.filter")}>
          {(query) => <BranchesList repo={repo} query={query} />}
        </ListPanel>
      }
    >
      <Columns id="history-main">
        <Panel id="history" defaultSize="30" minSize={260}>
          <CommitList repoPath={repo.path} />
        </Panel>
        <ResizeHandle />
        <Panel id="files" defaultSize="20" minSize={180}>
          <ChangedFilesPanel repoPath={repo.path} />
        </Panel>
        <ResizeHandle />
        <Panel id="diff" defaultSize="50" minSize={320}>
          <DiffPanel repoPath={repo.path} />
        </Panel>
      </Columns>
    </Frame>
  );
}

function ChangesLayout({ repo }: { repo: RepositoryInfo }) {
  return (
    <Frame repo={repo}>
      <Columns id="changes-main">
        <Panel id="changes" defaultSize="34" minSize={260}>
          <ChangesPanel repoPath={repo.path} />
        </Panel>
        <ResizeHandle />
        <Panel id="working-diff" defaultSize="66" minSize={320}>
          <WorkingDiffPanel repoPath={repo.path} />
        </Panel>
      </Columns>
    </Frame>
  );
}

/** The list column of each tool page. */
function PageList({ repo, view }: { repo: RepositoryInfo; view: View }) {
  const t = useT();
  if (view === "github")
    return (
      <ListPanel title={t("view.github")} filterLabel={t("github.filter")}>
        {(query) => <PullRequestList repoPath={repo.path} query={query} />}
      </ListPanel>
    );
  if (view === "ci")
    return (
      <ListPanel title="CI" filterLabel={t("common.filter")}>
        {(query) => (
          <Suspense fallback={null}>
            <CiList repoPath={repo.path} query={query} />
          </Suspense>
        )}
      </ListPanel>
    );
  if (view === "linear")
    return (
      <ListPanel title="Linear" filterLabel={t("common.filter")} actions={<CreateIssueButton />}>
        {(query) => <LinearList query={query} />}
      </ListPanel>
    );
  if (view === "agents")
    return (
      <ListPanel title={t("view.agents")} filterLabel={t("agents.filter")}>
        {(query) => <AgentsList repoPath={repo.path} query={query} />}
      </ListPanel>
    );
  if (view === "work") return <ListPanel title={t("view.work")}>{() => <WorkList repoPath={repo.path} />}</ListPanel>;
  if (view === "editor")
    return (
      <ListPanel title={t("view.editor")}>
        {() => (
          <Suspense fallback={null}>
            <EditorSidebar repoPath={repo.path} />
          </Suspense>
        )}
      </ListPanel>
    );
  if (view === "graph")
    return (
      <ListPanel title={t("view.graph")}>
        {() => (
          <Suspense fallback={null}>
            <CodeGraphList repoPath={repo.path} />
          </Suspense>
        )}
      </ListPanel>
    );
  if (view === "browser")
    return (
      <ListPanel title={t("view.browser")} filterLabel={t("common.filter")}>
        {(query) => (
          <Suspense fallback={null}>
            <BrowserTabs query={query} />
          </Suspense>
        )}
      </ListPanel>
    );
  return <ListPanel title={t("view.preview")}>{() => <PreviewList repoPath={repo.path} />}</ListPanel>;
}

function Layout({ repo, view }: { repo: RepositoryInfo; view: View }) {
  const t = useT();
  const pullRequest = useWorkspaceStore((s) => s.pullRequest);
  // Keyed by path: switching repository resets every panel's local state.
  if (view === "home") {
    return (
      <Frame key={`${repo.path}:home`} repo={repo}>
        <Suspense fallback={<PanelLoading title="" />}>
          <Dashboard repo={repo} />
        </Suspense>
      </Frame>
    );
  }
  if (
    view === "github" ||
    view === "ci" ||
    view === "agents" ||
    view === "preview" ||
    view === "linear" ||
    view === "browser" ||
    view === "graph" ||
    view === "editor" ||
    view === "work"
  ) {
    return (
      <Frame
        key={`${repo.path}:${view}`}
        repo={repo}
        page={view}
        listTitle={
          view === "github"
            ? t("view.github")
            : view === "ci"
              ? "CI"
              : view === "linear"
                ? "Linear"
                : t(
                    view === "agents"
                      ? "view.agents"
                      : view === "browser"
                        ? "view.browser"
                        : view === "graph"
                          ? "view.graph"
                          : view === "editor"
                            ? "view.editor"
                            : view === "work"
                              ? "view.work"
                              : "view.preview",
                  )
        }
        list={<PageList repo={repo} view={view} />}
      >
        <Suspense fallback={<PanelLoading title="" />}>
          {view === "github" ? (
            pullRequest ? (
              <PullRequestPage key={pullRequest.number} repoPath={repo.path} pr={pullRequest} />
            ) : (
              <EmptyState icon={<GitPullRequest />} title={t("pr.pick")} description={t("pr.pickHint")} />
            )
          ) : view === "ci" ? (
            <CiPage repoPath={repo.path} />
          ) : view === "agents" ? (
            <AgentDetail repoPath={repo.path} />
          ) : view === "linear" ? (
            <LinearIssueView repoPath={repo.path} />
          ) : view === "browser" ? (
            <BrowserPanel />
          ) : view === "work" ? (
            <WorkPage repoPath={repo.path} />
          ) : view === "graph" ? (
            <CodeGraphPage repoPath={repo.path} />
          ) : view === "editor" ? (
            <EditorPage repoPath={repo.path} />
          ) : (
            <PreviewPanel repoPath={repo.path} />
          )}
        </Suspense>
      </Frame>
    );
  }
  return view === "changes" ? (
    <ChangesLayout key={repo.path} repo={repo} />
  ) : (
    <HistoryLayout key={repo.path} repo={repo} />
  );
}

/** ⌘I opens or closes the assistant next to the current view. */
function useAssistantShortcut() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.shiftKey || event.altKey || event.key.toLowerCase() !== "i") return;
      event.preventDefault();
      const { assistantOpen, setAssistantOpen } = useUiStore.getState();
      setAssistantOpen(!assistantOpen);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** The views over a docked terminal (⌃`). */
export function AppShell({ view }: { view: View }) {
  const repo = useWorkspaceStore((s) => s.repo);
  if (!repo) return <WelcomeScreen />;
  return <Workspace repo={repo} view={view} />;
}

function Workspace({ repo, view }: { repo: RepositoryInfo; view: View }) {
  useRepoWatcher(repo.path);
  useAssistantShortcut();
  const assistantOpen = useUiStore((s) => s.assistantOpen);
  return (
    <div className="flex h-full flex-col bg-sidebar">
      <TabSync />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <Layout repo={repo} view={view} />
        </div>
        {assistantOpen && (
          <Suspense fallback={null}>
            <AssistantPanel repoPath={repo.path} />
          </Suspense>
        )}
      </div>
      <TerminalDock key={repo.path} repoPath={repo.path} />
      <CommandPalette repo={repo} />
    </div>
  );
}
