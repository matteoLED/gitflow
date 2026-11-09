import { useShallow } from "zustand/react/shallow";
import { DataUnavailable } from "@/components/states";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowRightLeft, ChevronDown, ChevronRight, GitBranch, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PanelLoading } from "@/components/layout/panel";
import { useRefs } from "@/lib/git-queries";
import { branchRows, type BranchListRow } from "./branch-rows";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useWorkspaceStore, type View } from "@/stores/workspace-store";
import { useGitAction } from "@/features/operations/use-git-action";
import type { LocalBranch, RefsSnapshot, RepositoryInfo } from "@/types/git";
import { SyncBar } from "./SyncBar";
import { GithubIncident } from "@/features/github/GithubIncident";
import { SidebarNav } from "./SidebarNav";
import { AppMenu } from "./AppMenu";
import { RepoSwitcher } from "@/features/repositories/RepoSwitcher";
import { useCheckout } from "./use-checkout";
import { BranchSwitcher } from "./BranchSwitcher";
import { useT } from "@/i18n";

const ROW =
  "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

function Counts({ ahead, behind, pill = false }: { ahead: number; behind: number; pill?: boolean }) {
  const t = useT();
  if (!ahead && !behind) return null;
  return (
    <span
      className={cn(
        "ml-auto flex shrink-0 gap-1.5 text-[11px] opacity-80",
        pill && "rounded bg-black/25 px-1.5 py-px opacity-100",
      )}
    >
      {ahead > 0 && <span aria-label={t("branches.ahead", { count: ahead })}>↑{ahead}</span>}
      {behind > 0 && <span aria-label={t("branches.behind", { count: behind })}>↓{behind}</span>}
    </span>
  );
}

type BranchRowProps = {
  branch: LocalBranch;
  label: string;
  indent: boolean;
  viewing: boolean;
  switching: boolean;
  onShow: (name: string) => void;
  onSwitch: (name: string) => void;
};

/** Hook-free row: hundreds of them render cheaply, the actions live once in the list. */
const BranchRow = memo(function BranchRow({
  branch,
  label,
  indent,
  viewing,
  switching,
  onShow,
  onSwitch,
}: BranchRowProps) {
  const t = useT();
  return (
    <div className="group/row relative">
      <button
        type="button"
        aria-current={viewing ? "true" : undefined}
        onClick={() => onShow(branch.name)}
        onDoubleClick={() => onSwitch(branch.name)}
        title={t("branches.doubleClick", { name: branch.name })}
        className={cn(
          ROW,
          "pr-8 text-sidebar-foreground",
          indent && "pl-5",
          viewing && "bg-white/[0.08] text-foreground",
        )}
      >
        <GitBranch aria-hidden className="size-3.5 shrink-0 opacity-50" />
        <span className="truncate">{label}</span>
        {branch.upstreamGone && (
          <TriangleAlert aria-label={t("branches.upstreamGone")} className="size-3 shrink-0 text-muted-foreground" />
        )}
        <Counts ahead={branch.ahead} behind={branch.behind} />
      </button>
      <button
        type="button"
        aria-label={t("branches.switchTo", { name: branch.name })}
        disabled={switching}
        onClick={() => onSwitch(branch.name)}
        className="absolute top-1 right-1 grid size-5 place-items-center rounded text-muted-foreground opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-white/[0.1] hover:text-foreground"
      >
        <ArrowRightLeft aria-hidden className="size-3" />
      </button>
    </div>
  );
});

function HeadRow({ refs }: { refs: RefsSnapshot }) {
  const t = useT();
  const { historyRev, showHistoryOf } = useWorkspaceStore(
    useShallow((s) => ({ historyRev: s.historyRev, showHistoryOf: s.showHistoryOf })),
  );
  const branch = refs.branches.find((b) => b.name === refs.head.branch);
  return (
    <button
      type="button"
      aria-current={historyRev === null ? "true" : undefined}
      onClick={() => showHistoryOf(null)}
      className={cn(
        ROW,
        "mb-1 bg-primary/75 font-semibold text-[#fff] hover:bg-primary/85 hover:text-[#fff]",
        historyRev === null && "bg-primary/90",
      )}
    >
      <GitBranch aria-hidden className="size-3.5 shrink-0 text-[#fff]/80" />
      <span className="truncate">{refs.head.branch ?? t("branches.detached")}</span>
      {branch && <Counts ahead={branch.ahead} behind={branch.behind} pill />}
    </button>
  );
}

function NewBranchForm({ repoPath, onDone }: { repoPath: string; onDone: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const create = useGitAction(repoPath, {
    run: () => gitBackend.createBranch(repoPath, name, true),
    success: t("branches.created", { name: name.trim() }),
    failure: t("branches.createFailed"),
  });
  return (
    <form
      className="mb-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) create.mutate(undefined, { onSuccess: onDone });
      }}
    >
      <Input
        autoFocus
        aria-label={t("branches.newName")}
        placeholder="new-branch-name ↵"
        value={name}
        disabled={create.isPending}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
        onBlur={() => !name && onDone()}
        className="h-6 text-[12px] md:text-[12px]"
      />
    </form>
  );
}

/** ⌘⇧P toggles Preview, ⌘⇧L Linear (⌘I is the assistant side panel). */
function useToolShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const target: View | null = !event.shiftKey ? null : key === "p" ? "preview" : key === "l" ? "linear" : null;
      if (!target) return;
      event.preventDefault();
      const { view, setView } = useWorkspaceStore.getState();
      setView(view === target ? "history" : target);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-7 items-center gap-1 px-2 text-[11.5px] font-medium text-muted-foreground">{children}</div>
  );
}

const SECTION_LABEL = { remotes: "branches.remotes", tags: "branches.tags", stashes: "branches.stashes" } as const;
const EMPTY_LABEL = { none: "common.none", noMatch: "branches.noMatch", noOther: "branches.noOther" } as const;
const ROW_HEIGHT = 28;

/** Branches column of the History page: one virtualized list, so thousands of refs stay instant. */
export function BranchesList({ repo, query }: { repo: RepositoryInfo; query: string }) {
  const t = useT();
  const refs = useRefs(repo.path);
  const { historyRev, showHistoryOf } = useWorkspaceStore(
    useShallow((s) => ({ historyRev: s.historyRev, showHistoryOf: s.showHistoryOf })),
  );
  const switchBranch = useCheckout(repo.path);
  const checkout = switchBranch.mutate;
  // Stable across renders: memoized rows don't re-render when the list does.
  const onSwitch = useCallback((name: string) => checkout({ kind: "local", name }), [checkout]);
  const [creating, setCreating] = useState(false);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const rows = useMemo(() => (refs.data ? branchRows(refs.data, query, toggled) : []), [refs.data, query, toggled]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
    initialRect: { width: 0, height: 800 },
  });
  const toggle = (key: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  if (refs.isError)
    return <DataUnavailable title={t("branches.readError")} error={refs.error} onRetry={() => void refs.refetch()} />;
  if (!refs.data) return <PanelLoading title={t("branches.loading")} variant="grid-spiral" />;

  const render = (row: BranchListRow) => {
    switch (row.kind) {
      case "branch":
        return (
          <BranchRow
            branch={row.branch}
            label={row.label}
            indent={row.indent}
            viewing={historyRev === row.branch.name}
            switching={switchBranch.isPending}
            onShow={showHistoryOf}
            onSwitch={onSwitch}
          />
        );
      case "group":
        return (
          <button type="button" onClick={() => toggle(row.key)} className={cn(ROW, "gap-1 text-sidebar-foreground")}>
            {row.prefix}
            <ChevronDown
              aria-hidden
              className={cn("size-3 opacity-60 transition-transform", !row.open && "-rotate-90")}
            />
          </button>
        );
      case "section":
        return (
          <button
            type="button"
            aria-expanded={row.open}
            onClick={() => toggle(row.key)}
            className={cn(ROW, "mt-1 gap-1 text-[11.5px] font-medium text-muted-foreground")}
          >
            {t(SECTION_LABEL[row.section])}
            <span className="font-normal">{row.count}</span>
            <ChevronRight
              aria-hidden
              className={cn("size-3 opacity-60 transition-transform", row.open && "rotate-90")}
            />
          </button>
        );
      case "rev":
        return (
          <button
            type="button"
            title={row.rev}
            aria-current={historyRev === row.rev ? "true" : undefined}
            onClick={() => showHistoryOf(row.rev)}
            onDoubleClick={() => row.key.startsWith("r:") && checkout({ kind: "remote", name: row.rev })}
            className={cn(ROW, "text-sidebar-foreground", historyRev === row.rev && "bg-white/[0.08]")}
          >
            <span className="truncate">{row.rev}</span>
          </button>
        );
      case "stash":
        return (
          <p title={row.message} className="truncate px-2 py-1 text-[12px] text-sidebar-foreground">
            {row.message}
          </p>
        );
      case "empty":
        return <p className="px-2 py-1 text-[12px] text-muted-foreground">{t(EMPTY_LABEL[row.reason])}</p>;
    }
  };

  return (
    <nav aria-label={t("branches.nav")} className="flex min-h-0 flex-1 flex-col px-2 pb-2">
      <SectionLabel>
        {t("branches.local")}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("branches.new")}
              onClick={() => setCreating(true)}
              className="ml-auto size-5 text-muted-foreground"
            >
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("branches.newHint")}</TooltipContent>
        </Tooltip>
      </SectionLabel>
      <HeadRow refs={refs.data} />
      {creating && <NewBranchForm repoPath={repo.path} onDone={() => setCreating(false)} />}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={rows[item.index].key}
              className="absolute inset-x-0"
              style={{ top: item.start, height: ROW_HEIGHT }}
            >
              {render(rows[item.index])}
            </div>
          ))}
        </div>
      </div>
    </nav>
  );
}

/** Linear-like sidebar: the repository, the pages, and the sync buttons. Lists live in each page. */
export function BranchSidebar({ repo }: { repo: RepositoryInfo }) {
  const t = useT();
  const refs = useRefs(repo.path);
  useToolShortcuts();
  return (
    <aside aria-label={t("branches.sidebar")} className="flex h-full flex-col">
      <div className="flex items-center gap-1 px-2 pb-2">
        <div className="min-w-0 flex-1">
          <RepoSwitcher repo={repo} />
        </div>
        <AppMenu repo={repo} />
      </div>
      <BranchSwitcher repoPath={repo.path} />
      <SidebarNav repoPath={repo.path} />
      <div className="min-h-0 flex-1" />
      <GithubIncident />
      {refs.data && <SyncBar repoPath={repo.path} refs={refs.data} />}
    </aside>
  );
}
