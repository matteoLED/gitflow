import { useShallow } from "zustand/react/shallow";
import { DataUnavailable, EmptyState } from "@/components/states";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Cloud,
  GitBranch,
  ChevronRight,
  GitCommitHorizontal,
  SearchX,
  Tag,
  Crosshair,
  FileDiff,
  Layers,
  ChevronDown,
} from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { buildGraph, type GraphRow } from "./graph";
import { stackOf } from "@/features/github/stacks";
import { useOpenPullRequest } from "@/features/github/PullRequestList";
import { useViewSettings } from "@/stores/view-settings-store";
import { PanelHeader, PanelToolbar } from "@/components/layout/panel";
import { CommitListSkeleton } from "@/components/skeletons";
import { useAvatar, useCommits, usePullRequests, useRefs, useWorkingTree } from "@/lib/git-queries";
import { AuthorAvatar } from "@/components/author-avatar";
import { AgentBadge, coAgentOf } from "@/components/agent-badge";
import { formatAge, formatCommitDate } from "@/lib/format-date";
import { nextListIndex } from "@/lib/list-navigation";
import { cn } from "@/lib/utils";
import { splitSubject } from "@/lib/commit-subject";
import { HistoryOptions } from "./HistoryOptions";
import { FocusButton } from "@/components/layout/FocusButton";
import { Highlight, HistorySearchBar } from "./HistorySearchBar";
import { useHistorySearchStore } from "./history-search-store";
import { isEmptySearch } from "./search-query";
import { CommitMenu, type CommitActions } from "./CommitMenu";
import { RebaseDialog } from "./RebaseDialog";
import { TagDialog } from "@/features/releases/TagDialog";
import { useRewrite } from "./use-rewrite";
import { gitBackend } from "@/lib/tauri-git";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { CommitRef, CommitSummary, HistorySearch } from "@/types/git";
import { useT } from "@/i18n";
import { CommitHoverCard } from "@/features/refs/RefPreview";

const REF_ICONS = { head: Crosshair, branch: GitBranch, remote: Cloud, tag: Tag } as const;
/** One line per commit, like the reference: title, ref, author, age. */
const ROW_HEIGHT = 32;
const rowId = (hash: string) => `commit-${hash}`;

/** One ref per row keeps the list calm; the others are counted, and named on hover. */
const MAX_BADGES = 1;

type Badge = CommitRef & { synced: boolean };

/** A local branch and its remote twin on the same commit collapse into one badge flagged as in sync. */
function badgesOf(refs: CommitRef[]): Badge[] {
  const locals = new Set(refs.filter((r) => r.kind === "branch").map((r) => r.name));
  const twin = (r: CommitRef) => r.kind === "remote" && locals.has(r.name.slice(r.name.indexOf("/") + 1));
  const remotesInSync = new Set(refs.filter(twin).map((r) => r.name.slice(r.name.indexOf("/") + 1)));
  return refs
    .filter((r) => r.kind !== "head" && !twin(r))
    .map((r) => ({ ...r, synced: r.kind === "branch" && remotesInSync.has(r.name) }));
}

/** Tinted with its lane's color, like the graph line it labels. */
function RefBadge({ badge, color }: { badge: Badge; color: string }) {
  // Shrinks a hundred times faster than the title next to it: the title stays readable.
  const t = useT();
  const Icon = REF_ICONS[badge.kind];
  return (
    <span
      title={badge.synced ? t("history.inSync", { name: badge.name }) : badge.name}
      style={{ color, backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)` }}
      className="inline-flex max-w-32 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium"
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{badge.name}</span>
    </span>
  );
}

const LANE = 14;
const NODE_Y = ROW_HEIGHT / 2;
const LANE_COLORS = ["var(--primary)", "#f29b45", "#ee6e6b", "#5fb3a8", "#c77dbb", "#6f9fd8"];
const laneColor = (color: number) => LANE_COLORS[color % LANE_COLORS.length];
/** Beyond this, lanes share the last column: the titles stay close to the graph. */
const MAX_LANES = 5;

const laneX = (lane: number) => 14 + Math.min(lane, MAX_LANES - 1) * LANE;

/**
 * One row of the commit graph: lines from above into the node or passing by, lines down to the parents.
 * HEAD is a ring, the main line's commits haloed dots, side branches' commits small dots.
 */
function GraphCell({
  row,
  head,
  dirty,
  selected,
}: {
  row: GraphRow;
  head: boolean;
  dirty: boolean;
  selected: boolean;
}) {
  const path = (s: GraphRow["segments"][number]) => {
    const [y1, y2] = s.part === "top" ? [0, NODE_Y] : [NODE_Y, ROW_HEIGHT];
    const [x1, x2] = [laneX(s.from), laneX(s.to)];
    if (x1 === x2) return `M${x1} ${y1}V${y2}`;
    // Branch lines curve between lanes, like Fork and GitKraken.
    return `M${x1} ${y1}C${x1} ${y2} ${x2} ${y1} ${x2} ${y2}`;
  };
  const color = laneColor(row.color);
  const x = laneX(row.col);
  return (
    <svg
      aria-hidden
      className="absolute top-0 left-0 overflow-visible"
      width={laneX(row.lanes) + 4}
      height={ROW_HEIGHT}
    >
      {row.segments.map((s, i) => (
        <path key={i} d={path(s)} fill="none" strokeWidth={1.5} stroke={laneColor(s.color)} />
      ))}
      {/* Uncommitted work sits above HEAD, joined by a dashed line (see UncommittedRow). */}
      {head && dirty && <path d={`M${x} 0V${NODE_Y - 6}`} stroke={color} strokeWidth={1.5} strokeDasharray="2 3" />}
      {head ? (
        <circle cx={x} cy={NODE_Y} r={5} fill="var(--panel)" stroke={color} strokeWidth={2.5} />
      ) : row.col === 0 || selected ? (
        <>
          <circle cx={x} cy={NODE_Y} r={6.5} fill={color} fillOpacity={0.22} />
          <circle cx={x} cy={NODE_Y} r={3.5} fill={color} />
        </>
      ) : (
        <circle cx={x} cy={NODE_Y} r={3} fill={color} />
      )}
    </svg>
  );
}

/** Uncommitted changes, above HEAD like the next commit to come: a dashed node, one click to Changes. */
function UncommittedRow({ count, onOpen }: { count: number; onOpen: () => void }) {
  const t = useT();
  const x = laneX(0);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ paddingLeft: x + 26 }}
      className="relative mx-2 flex h-8 shrink-0 items-center rounded-lg text-left text-[12.5px] text-muted-foreground outline-none hover:bg-white/[0.07] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <svg aria-hidden className="absolute top-0 left-0 overflow-visible" width={x + 8} height={32}>
        <circle cx={x} cy={16} r={5} fill="none" stroke={LANE_COLORS[0]} strokeWidth={1.5} strokeDasharray="2 2.2" />
        <path d={`M${x} 22V32`} stroke={LANE_COLORS[0]} strokeWidth={1.5} strokeDasharray="2 3" />
      </svg>
      {t.plural("history.uncommitted", count)}
    </button>
  );
}

type CommitRowProps = {
  commit: CommitSummary;
  selected: boolean;
  top: number;
  onSelect: () => void;
  graph: GraphRow | null;
  graphWidth: number;
  actions: CommitActions;
  /** Search terms to highlight (none for regular expressions). */
  terms: HistorySearch;
  repoPath: string;
  /** The working tree has uncommitted changes (drawn above HEAD). */
  dirty: boolean;
};

function CommitRow(props: CommitRowProps) {
  const { commit, selected, top, onSelect, graph, graphWidth, actions, terms, repoPath, dirty } = props;
  const t = useT();
  const avatar = useAvatar(repoPath, commit.hash, commit.authorEmail).data;
  const badges = badgesOf(commit.refs);
  const head = commit.refs.some((r) => r.kind === "head");
  const color = laneColor(graph?.color ?? 0);
  // Commits on a side branch read quieter than the main line's, like the reference.
  const side = !!graph && graph.col > 0;
  const { title } = splitSubject(commit.subject);
  const extra = badges.length - MAX_BADGES;
  return (
    <CommitMenu commit={commit} actions={actions}>
      <div
        id={rowId(commit.hash)}
        role="option"
        aria-selected={selected}
        onClick={onSelect}
        style={{ transform: `translateY(${top}px)`, height: ROW_HEIGHT, paddingLeft: graphWidth }}
        className={cn(
          "absolute inset-x-0 flex cursor-default items-center gap-3 overflow-hidden rounded-lg pr-3 hover:bg-white/[0.05]",
          selected && "bg-white/[0.06] hover:bg-white/[0.09]",
        )}
      >
        {graph ? (
          <GraphCell row={graph} head={head} dirty={dirty} selected={selected} />
        ) : (
          <span aria-hidden className="absolute top-3 left-2.5 size-2 rounded-full border-2 border-primary bg-panel" />
        )}
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <CommitHoverCard repoPath={repoPath} commit={commit} side="right">
            <span
              className={cn(
                "min-w-0 truncate text-[13.5px]",
                side && !selected ? "text-muted-foreground" : "text-foreground",
              )}
            >
              <Highlight text={title} term={terms.message} />
            </span>
          </CommitHoverCard>
          {badges.slice(0, MAX_BADGES).map((badge) => (
            <RefBadge key={`${badge.kind}:${badge.name}`} badge={badge} color={color} />
          ))}
          {extra > 0 && (
            <span
              title={badges
                .slice(MAX_BADGES)
                .map((b) => b.name)
                .join(", ")}
              className="hidden shrink-0 text-[11px] text-muted-foreground @lg:inline"
            >
              +{extra}
            </span>
          )}
        </span>
        {/* The title comes first: the ref badge gives way before it, the PR number is in the hover card. */}
        <span className="flex shrink-0 items-center gap-2 text-[12.5px] text-muted-foreground">
          <span className="relative shrink-0">
            <AuthorAvatar name={commit.author} src={avatar} className="size-[18px] text-[7px]" />
            {coAgentOf(commit.coAuthors) && (
              <AgentBadge
                agent={coAgentOf(commit.coAuthors) ?? "claude"}
                className="absolute -right-1 -bottom-1 size-2.5"
              />
            )}
          </span>
          <span className="hidden max-w-24 truncate @md:inline">
            <Highlight text={commit.author} term={terms.author} />
          </span>
        </span>
        <time
          dateTime={commit.authoredAt}
          title={formatCommitDate(commit.authoredAt, undefined, t.locale)}
          className="w-9 shrink-0 text-right text-[12.5px] text-muted-foreground tabular-nums"
        >
          {formatAge(commit.authoredAt, undefined, t.locale)}
        </time>
      </div>
    </CommitMenu>
  );
}

/** The branches to read the history of, filtered as you type; the checked-out one first. */
function BranchPicker({ repoPath }: { repoPath: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { historyRev, historyLabel, showHistoryOf } = useWorkspaceStore(
    useShallow((s) => ({ historyRev: s.historyRev, historyLabel: s.historyLabel, showHistoryOf: s.showHistoryOf })),
  );
  const refs = useRefs(repoPath).data;
  const head = refs?.head.branch ?? "HEAD";
  const pick = (rev: string | null) => {
    showHistoryOf(rev);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("history.pickBranch")}
          aria-label={`${t("history.pickBranch")}: ${historyLabel ?? historyRev ?? head}`}
          className="flex min-w-0 items-center gap-1.5 rounded-lg bg-white/[0.05] px-2.5 py-1 text-[12.5px] outline-none hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <GitBranch aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">{historyLabel ?? historyRev ?? head}</span>
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <Command>
          <CommandInput placeholder={t("branches.filter")} />
          <CommandList className="max-h-80">
            <CommandEmpty>{t("branches.noMatch")}</CommandEmpty>
            <CommandItem value={head} onSelect={() => pick(null)} className="text-[12.5px]">
              <Crosshair aria-hidden className="size-3.5" />
              <span className="truncate">{head}</span>
            </CommandItem>
            {refs?.branches
              .filter((b) => b.name !== refs.head.branch)
              .map((b) => (
                <CommandItem key={b.name} value={b.name} onSelect={() => pick(b.name)} className="text-[12.5px]">
                  <GitBranch aria-hidden className="size-3.5" />
                  <span className="truncate">{b.name}</span>
                </CommandItem>
              ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** "Commit history" and how many are loaded, then the branch shown, picked from a menu. */
function HistoryHeader({ repoPath, count, more }: { repoPath: string; count: number; more: boolean }) {
  const t = useT();
  return (
    <PanelHeader className="gap-2">
      <h2 data-tauri-drag-region className="shrink-0 text-[14px] font-medium">
        {t("history.title")}
      </h2>
      {count > 0 && (
        <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 text-[12px] text-muted-foreground tabular-nums">
          {count}
          {more && "+"}
        </span>
      )}
      <span data-tauri-drag-region className="min-w-0 flex-1" />
      <BranchPicker repoPath={repoPath} />
      <HistoryOptions />
      <FocusButton />
    </PanelHeader>
  );
}

/** Like the reference: commits waiting upstream, one click away. Shown when viewing HEAD and behind. */
function IncomingCommits({ repoPath }: { repoPath: string }) {
  const t = useT();
  const { historyRev, showHistoryOf } = useWorkspaceStore(
    useShallow((s) => ({ historyRev: s.historyRev, showHistoryOf: s.showHistoryOf })),
  );
  const refs = useRefs(repoPath).data;
  const branch = refs?.branches.find((b) => b.name === refs.head.branch);
  if (historyRev !== null || !branch?.upstream || branch.behind === 0) return null;
  const upstream = branch.upstream;
  return (
    <button
      type="button"
      onClick={() => showHistoryOf(upstream)}
      className="mx-2 mb-1 flex h-6 shrink-0 items-center gap-1 rounded-lg border border-dashed border-white/15 px-3 text-[11.5px] text-muted-foreground outline-none hover:border-white/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="truncate">{t.plural("history.incoming", branch.behind, { upstream })}</span>
      <ChevronRight aria-hidden className="size-3 shrink-0" />
    </button>
  );
}

/** Where the open PR sits in its stack, like Linear: top first, the base branch last. Click to switch. */
function PullRequestStack({ repoPath }: { repoPath: string }) {
  const t = useT();
  const current = useWorkspaceStore((s) => s.pullRequest);
  const prs = usePullRequests(repoPath).data ?? [];
  const { open, loading } = useOpenPullRequest(repoPath);
  const stack = current ? stackOf(prs, current.number) : null;
  if (!current || !stack) return null;
  return (
    <section className="mx-2 mb-1.5 rounded-lg border border-white/10 px-1.5 py-1.5">
      <p className="flex items-center gap-1.5 px-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <Layers aria-hidden className="size-3" />
        {t("github.stack")} · {stack.length}
      </p>
      <ol>
        {stack.map((pr) => {
          const isCurrent = pr.number === current.number;
          return (
            <li key={pr.number}>
              <button
                type="button"
                disabled={isCurrent}
                onClick={() => void open(pr)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] outline-none hover:enabled:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-ring",
                  isCurrent && "bg-white/[0.05]",
                )}
              >
                {loading === pr.number ? (
                  <BrailleLoader className="text-primary" />
                ) : (
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full border-2",
                      isCurrent ? "border-primary bg-primary" : "border-added-foreground",
                    )}
                  />
                )}
                <span className="shrink-0 text-muted-foreground">#{pr.number}</span>
                <span className="min-w-0 flex-1 truncate">{pr.title}</span>
                {isCurrent && <span className="shrink-0 text-[11px] text-muted-foreground">{t("github.current")}</span>}
              </button>
            </li>
          );
        })}
        <li className="flex items-center gap-2 px-1.5 py-1 font-mono text-[11.5px] text-muted-foreground">
          <span className="size-2 shrink-0 rounded-full border-2 border-white/25" />
          {stack[stack.length - 1].baseRefName}
        </li>
      </ol>
    </section>
  );
}

/** In a pull request, its whole diff (what GitHub's "Files changed" shows) sits above its commits. */
function PullRequestChanges() {
  const t = useT();
  const { pullRequest, compareBase, showPullRequestChanges } = useWorkspaceStore(
    useShallow((s) => ({
      pullRequest: s.pullRequest,
      compareBase: s.compareBase,
      showPullRequestChanges: s.showPullRequestChanges,
    })),
  );
  if (!pullRequest?.base) return null;
  const selected = compareBase !== null;
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={showPullRequestChanges}
      className={cn(
        "mx-2 mb-1 flex shrink-0 items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-left outline-none hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-primary/50 bg-primary/10",
      )}
    >
      <FileDiff aria-hidden className={cn("size-3.5 shrink-0", selected ? "text-primary" : "text-muted-foreground")} />
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-medium">{t("pr.allChanges")}</span>
        <span className="block truncate text-[11.5px] text-muted-foreground">{t("pr.allChangesHint")}</span>
      </span>
    </button>
  );
}

export function CommitList({ repoPath }: { repoPath: string }) {
  const t = useT();
  const { historyRev, selectedCommitHash, selectCommit } = useWorkspaceStore(
    useShallow((s) => ({
      historyRev: s.historyRev,
      selectedCommitHash: s.selectedCommitHash,
      selectCommit: s.selectCommit,
    })),
  );
  const search = useHistorySearchStore((s) => s.search);
  const searching = !isEmptySearch(search);
  const setQuery = useHistorySearchStore((s) => s.setQuery);
  const setView = useWorkspaceStore((s) => s.setView);
  const terms = search.regex ? {} : search;
  const history = useCommits(repoPath, historyRev, search);
  const commits = useMemo(() => history.data?.pages.flat() ?? [], [history.data]);
  const selectedIndex = commits.findIndex((c) => c.hash === selectedCommitHash);
  // The graph needs the unbroken history: a search shows plain dots instead.
  const { firstParentOnly, hideMerges } = useViewSettings(
    useShallow((s) => ({ firstParentOnly: s.firstParentOnly, hideMerges: s.hideMerges })),
  );
  const graph = useMemo(() => {
    // Without merges there's no branch shape to draw; first-parent history follows one parent only.
    if (searching || hideMerges) return null;
    return buildGraph(
      firstParentOnly ? commits.map((c) => ({ hash: c.hash, parents: c.parents.slice(0, 1) })) : commits,
    );
  }, [commits, searching, hideMerges, firstParentOnly]);
  const changes = useWorkingTree(repoPath).data?.length ?? 0;
  const dirty = historyRev === null && !searching && changes > 0;
  const graphWidth = graph ? laneX(Math.min(Math.max(1, ...graph.map((r) => r.lanes)), MAX_LANES) - 1) + 26 : 34;

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    initialRect: { width: 0, height: 800 },
  });
  const items = virtualizer.getVirtualItems();
  const lastVisible = items.at(-1)?.index ?? 0;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = history;

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && lastVisible >= commits.length - 30) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, lastVisible, commits.length]);

  const rewrite = useRewrite(repoPath);
  const [rebaseFrom, setRebaseFrom] = useState<string | null>(null);
  const [tagTarget, setTagTarget] = useState<CommitSummary | null>(null);
  const actions: CommitActions = {
    cherryPick:
      historyRev === null
        ? undefined
        : (c) =>
            rewrite.mutate({
              run: () => gitBackend.cherryPickCommit(repoPath, c.hash),
              success: t("rewrite.cherryPicked", { sha: c.hash.slice(0, 7) }),
            }),
    revert: (c) =>
      rewrite.mutate({
        run: () => gitBackend.revertCommit(repoPath, c.hash),
        success: t("rewrite.reverted", { sha: c.hash.slice(0, 7) }),
      }),
    rebaseFrom: historyRev === null ? (c) => setRebaseFrom(c.hash) : undefined,
    fixup:
      historyRev === null
        ? (c) =>
            rewrite.mutate({
              run: () => gitBackend.fixupCommit(repoPath, c.hash),
              success: t("rewrite.fixedUp", { sha: c.hash.slice(0, 7) }),
            })
        : undefined,
    tag: setTagTarget,
    busy: rewrite.isPending,
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const next = nextListIndex(event.key, selectedIndex, commits.length);
    if (next === null) return;
    event.preventDefault();
    selectCommit(commits[next].hash);
    virtualizer.scrollToIndex(next);
  };

  return (
    <section aria-label={t("history.section")} className="flex h-full flex-col bg-panel">
      <HistoryHeader repoPath={repoPath} count={commits.length} more={!!hasNextPage} />
      <PanelToolbar className="mt-1">
        <HistorySearchBar />
      </PanelToolbar>
      <div className="mt-4" />
      <IncomingCommits repoPath={repoPath} />
      <PullRequestChanges />
      <PullRequestStack repoPath={repoPath} />
      {dirty && commits.length > 0 && <UncommittedRow count={changes} onOpen={() => setView("changes")} />}
      {history.isError ? (
        <DataUnavailable title={t("history.loadError")} error={history.error} onRetry={() => void history.refetch()} />
      ) : history.isPending ? (
        <CommitListSkeleton />
      ) : commits.length === 0 ? (
        searching ? (
          <EmptyState
            icon={<SearchX />}
            title={t("history.noMatch")}
            hint={t("history.noMatchHint")}
            action={{ label: t("history.clearSearch"), onClick: () => setQuery("", true) }}
          />
        ) : (
          <EmptyState
            icon={<GitCommitHorizontal />}
            title={t("history.empty")}
            hint={t("history.emptyHint")}
            action={{ label: t("history.openChanges"), onClick: () => setView("changes") }}
          />
        )
      ) : (
        <div
          ref={scrollRef}
          role="listbox"
          aria-label={t("history.listLabel", { rev: historyRev ?? "HEAD" })}
          aria-activedescendant={selectedIndex >= 0 ? rowId(commits[selectedIndex].hash) : undefined}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="@container min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <div role="presentation" className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {items.map((item) => {
              const commit = commits[item.index];
              return (
                <CommitRow
                  key={commit.hash}
                  commit={commit}
                  top={item.start}
                  selected={commit.hash === selectedCommitHash}
                  onSelect={() => selectCommit(commit.hash)}
                  graph={graph?.[item.index] ?? null}
                  graphWidth={graphWidth}
                  actions={actions}
                  terms={terms}
                  repoPath={repoPath}
                  dirty={dirty}
                />
              );
            })}
          </div>
          {/* Like the reference: the main line fades out under "Earlier history", loaded as it comes into view. */}
          {hasNextPage && (
            <button
              type="button"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
              style={{ paddingLeft: graphWidth }}
              className="relative flex h-14 w-full items-start pt-2 text-left text-[13px] text-muted-foreground/70 outline-none hover:text-foreground"
            >
              <span
                aria-hidden
                className="absolute top-0 h-full w-[1.5px] bg-linear-to-b from-primary to-transparent"
                style={{ left: laneX(0) - 0.75 }}
              />
              {isFetchingNextPage ? (
                <BrailleLoader className="text-primary" label={t("history.loadingMore")} />
              ) : (
                t("history.earlier")
              )}
            </button>
          )}
        </div>
      )}
      <RebaseDialog repoPath={repoPath} from={rebaseFrom} onClose={() => setRebaseFrom(null)} />
      <TagDialog
        repoPath={repoPath}
        target={tagTarget && { hash: tagTarget.hash, label: tagTarget.hash.slice(0, 7) }}
        open={tagTarget !== null}
        onOpenChange={(open) => !open && setTagTarget(null)}
      />
    </section>
  );
}
