import { useEffect, useRef, useState, type ComponentType } from "react";
import { useCanGoBack, useRouter } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  GitCommitVertical,
  GitPullRequest,
  Globe,
  History,
  House,
  Layers,
  MonitorSmartphone,
  Network,
  Code2,
  PanelLeft,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { GithubIcon } from "@/components/github-icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LinearIcon } from "@/features/linear/LinearIcon";
import { useOpenIssue } from "@/features/linear/linear-queries";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useLinearStore } from "@/stores/linear-store";
import { placeKey, useTabsStore, type TabPlace } from "@/stores/tabs-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore, type View } from "@/stores/workspace-store";

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

export const VIEW_ICONS: Record<View, IconType> = {
  home: House,
  history: GitCommitVertical,
  changes: Layers,
  github: GithubIcon,
  ci: Activity,
  linear: LinearIcon,
  preview: MonitorSmartphone,
  agents: Sparkles,
  browser: Globe,
  graph: Network,
  editor: Code2,
  work: GitBranch,
};

export const VIEW_LABELS = {
  home: "view.home",
  history: "view.history",
  changes: "view.changes",
  github: "view.github",
  ci: "CI",
  linear: "Linear",
  preview: "view.preview",
  agents: "view.agents",
  browser: "view.browser",
  graph: "view.graph",
  editor: "view.editor",
  work: "view.work",
} as const;

function PlaceIcon({ place, className }: { place: TabPlace; className?: string }) {
  if (place.pullRequest) return <GitPullRequest aria-hidden className={cn("text-added-foreground", className)} />;
  const Icon = VIEW_ICONS[place.view];
  return <Icon aria-hidden className={className} />;
}

/** The place on screen right now, as a tab remembers it. */
function useCurrentPlace(): TabPlace {
  const t = useT();
  const { repo, view, pullRequest, historyRev } = useWorkspaceStore(
    useShallow((s) => ({ repo: s.repo, view: s.view, pullRequest: s.pullRequest, historyRev: s.historyRev })),
  );
  const { issue, issueOrg } = useLinearStore(useShallow((s) => ({ issue: s.issue, issueOrg: s.issueOrg })));
  const issueData = useOpenIssue().data;
  const label = VIEW_LABELS[view];
  const pageTitle = label === "Linear" || label === "CI" ? label : t(label);
  const showsPr = view === "github" && pullRequest;
  const showsIssue = view === "linear" && issue;
  const title = showsPr
    ? `#${pullRequest.number} ${pullRequest.title}`
    : showsIssue
      ? issueData
        ? `${issueData.identifier} ${issueData.title}`
        : pageTitle
      : pageTitle;
  return {
    repoPath: repo?.path ?? null,
    view,
    pullRequest: showsPr ? pullRequest : null,
    range: showsPr ? historyRev : null,
    issue: showsIssue ? { id: issue, orgId: issueOrg } : null,
    title,
  };
}

/** Shows a remembered place: its repository, page, and the pull request or issue in it. */
export function goTo(place: TabPlace) {
  const ws = useWorkspaceStore.getState();
  if (place.repoPath && place.repoPath !== ws.repo?.path) ws.switchRepo(place.repoPath);
  if (place.pullRequest && place.range) {
    useWorkspaceStore.getState().openPullRequest(place.pullRequest, place.range);
  } else if (place.view === "github" && useWorkspaceStore.getState().pullRequest) {
    useWorkspaceStore.getState().showHistoryOf(null);
  }
  if (place.view === "linear") useLinearStore.getState().setIssue(place.issue?.id ?? null, place.issue?.orgId ?? null);
  useWorkspaceStore.getState().setView(place.view);
}

/** The active tab follows navigation, like a browser tab. */
function useFollowNavigation(place: TabPlace) {
  const follow = useTabsStore((s) => s.follow);
  const key = `${placeKey(place)}:${place.title}`;
  useEffect(() => {
    follow(place);
    // The key covers every field that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, follow]);
}

function BarButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:enabled:bg-white/[0.07] hover:enabled:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35 [&_svg]:size-4"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function RecentMenu() {
  const t = useT();
  const recent = useTabsStore((s) => s.recent);
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t("tabs.recent")}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-white/[0.07] hover:text-foreground data-[state=open]:bg-white/[0.08] [&_svg]:size-4"
            >
              <History />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("tabs.recent")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-80 rounded-xl p-1">
        <p className="px-2 pt-1 pb-1.5 text-[11.5px] font-medium text-muted-foreground">{t("tabs.recent")}</p>
        {recent.length === 0 && <p className="px-2 pb-2 text-[12.5px] text-muted-foreground">{t("tabs.noRecent")}</p>}
        {recent.map((place) => (
          <button
            key={placeKey(place)}
            type="button"
            onClick={() => {
              goTo(place);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-white/[0.06]"
          >
            <PlaceIcon place={place} className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{place.title}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function Tabs() {
  const t = useT();
  const { tabs, active, activate, close, open } = useTabsStore();
  const activeRef = useRef<HTMLDivElement>(null);
  // Keeps the active tab in view when there are more tabs than room.
  useEffect(() => activeRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" }), [active, tabs.length]);
  const select = (id: string) => {
    const tab = tabs.find((x) => x.id === id);
    if (!tab || id === active) return;
    activate(id);
    goTo(tab);
  };
  const closeTab = (id: string) => {
    close(id);
    const { tabs: rest, active: next } = useTabsStore.getState();
    if (id === active) {
      const tab = rest.find((x) => x.id === next);
      if (tab) goTo(tab);
    }
  };
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <div
        role="tablist"
        aria-label={t("tabs.label")}
        onWheel={(e) => {
          // A vertical wheel scrolls the strip sideways, like a browser's tab bar.
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
        className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            ref={tab.id === active ? activeRef : undefined}
            role="tab"
            aria-selected={tab.id === active}
            tabIndex={0}
            onClick={() => select(tab.id)}
            onKeyDown={(e) => e.key === "Enter" && select(tab.id)}
            onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
            className={cn(
              // Every tab sits on its own soft fill; the active one is lighter, as in Linear's desktop app.
              "group/tab relative flex h-7 max-w-56 min-w-0 shrink-0 cursor-default items-center gap-2 rounded-lg bg-white/[0.04] pr-1.5 pl-2.5 text-[12.5px] text-muted-foreground outline-none transition-colors hover:bg-white/[0.06] hover:text-foreground/85 focus-visible:ring-2 focus-visible:ring-ring",
              tab.id === active && "bg-white/[0.09] text-foreground hover:bg-white/[0.1] hover:text-foreground",
            )}
          >
            <PlaceIcon place={tab} className="size-3.5 shrink-0" />
            {/* A title too long fades out (the fade sits in the padding, so a short one stays sharp). */}
            <span className="-mr-5 min-w-0 flex-1 overflow-hidden pr-5 whitespace-nowrap [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]">
              {tab.title || t("view.home")}
            </span>
            <button
              type="button"
              aria-label={t("tabs.close")}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground opacity-0 group-hover/tab:opacity-100 hover:bg-white/[0.12] hover:text-foreground focus-visible:opacity-100"
            >
              <X aria-hidden className="size-3" />
            </button>
          </div>
        ))}
      </div>
      <BarButton
        label={t("tabs.new")}
        onClick={() => {
          const repoPath = useWorkspaceStore.getState().repo?.path ?? null;
          const place: TabPlace = { repoPath, view: "home", pullRequest: null, range: null, issue: null, title: "" };
          open(place);
          goTo(place);
        }}
      >
        <Plus />
      </BarButton>
    </div>
  );
}

/** Sidebar toggle, then recently viewed and back/forward, like Linear's desktop title bar. */
function Controls() {
  const t = useT();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const { sidebarOpen, setSidebarOpen } = useUiStore(
    useShallow((s) => ({ sidebarOpen: s.sidebarOpen, setSidebarOpen: s.setSidebarOpen })),
  );
  return (
    <>
      <BarButton label={t("tabs.sidebar")} pressed={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}>
        <PanelLeft />
      </BarButton>
      <span data-tauri-drag-region className="h-full min-w-2 flex-1" />
      <RecentMenu />
      <BarButton label={t("tabs.back")} disabled={!canGoBack} onClick={() => router.history.back()}>
        <ChevronLeft />
      </BarButton>
      <BarButton label={t("tabs.forward")} onClick={() => router.history.forward()}>
        <ChevronRight />
      </BarButton>
    </>
  );
}

/** macOS hides the window buttons in full screen: the controls then start at the left edge. */
function useFullscreen() {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    let win: ReturnType<typeof getCurrentWindow>;
    try {
      win = getCurrentWindow();
    } catch {
      return; // outside the desktop shell (tests, browser preview)
    }
    const check = () => void win.isFullscreen().then(setFullscreen, () => undefined);
    check();
    const off = win.onResized(check);
    return () => void off.then((unlisten) => unlisten());
  }, []);
  return fullscreen;
}

/** Height of the title bar: its middle is the window buttons' middle (trafficLightPosition in tauri.conf.json). */
const BAR = "h-[45px]";

/** Top of the sidebar column: room for the window buttons, then the controls. */
export function SidebarBar() {
  const fullscreen = useFullscreen();
  return (
    <header
      data-tauri-drag-region
      className={cn("flex shrink-0 items-center gap-0.5 pr-2", BAR, fullscreen ? "pl-2" : "pl-[78px]")}
    >
      <Controls />
    </header>
  );
}

/** Top of the page column: the tabs start where the page starts. With the sidebar hidden, the controls too. */
export function TabsBar({ controls }: { controls?: boolean }) {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const fullscreen = useFullscreen();
  const showControls = controls ?? !sidebarOpen;
  return (
    <header data-tauri-drag-region className={cn("flex shrink-0 items-center gap-0.5 pr-2", BAR)}>
      {showControls && (
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 pr-2",
            fullscreen ? "w-[150px] pl-0.5" : "w-[220px] pl-[78px]",
          )}
        >
          <Controls />
        </div>
      )}
      <Tabs />
    </header>
  );
}

/** Mounted once: the active tab follows navigation. */
export function TabSync() {
  useFollowNavigation(useCurrentPlace());
  return null;
}
