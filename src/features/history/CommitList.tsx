import { useShallow } from "zustand/react/shallow";
import { DataUnavailable, EmptyState } from "@/components/states";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Cloud,
  GitBranch,
  GitPullRequest,
  ChevronRight,
  GitCommitHorizontal,
  SearchX,
  Tag,
  Crosshair,
  FileDiff,
  Layers,
} from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { buildGraph, type GraphRow } from "./graph";
import { stackOf } from "@/features/github/stacks";
import { useOpenPullRequest } from "@/features/github/PullRequestList";
import { useViewSettings } from "@/stores/view-settings-store";
import { PanelHeader, PanelToolbar } from "@/components/layout/panel";
import { CommitListSkeleton } from "@/components/skeletons";
import { useCommits, usePullRequests, useRefs } from "@/lib/git-queries";
import { formatCommitDate } from "@/lib/format-date";
import { nextListIndex } from "@/lib/list-navigation";
import { cn } from "@/lib/utils";
import { splitSubject } from "@/lib/commit-subject";
import { HistoryOptions } from "./HistoryOptions";
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
import { CommitHoverCard, PullRequestHoverCard } from "@/features/refs/RefPreview";

const REF_ICONS = { head: Crosshair, branch: GitBranch, remote: Cloud, tag: Tag } as const;
const ROW_HEIGHT = 46;
const rowId = (hash: string) => `commit-${hash}`;

const MAX_BADGES = 2;

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

function RefBadge({ badge }: { badge: Badge }) {
  const t = useT();
  const Icon = REF_ICONS[badge.kind];
  return (
    <span
      title={badge.synced ? t("history.inSync", { name: badge.name }) : badge.name}
      className="inline-flex max-w-40 min-w-0 shrink-0 items-center gap-1 rounded-full border border-white/12 px-1.5 text-[11px] text-foreground/85"
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{badge.name}</span>
      {badge.synced && <Cloud aria-label={t("history.inSyncShort")} className="size-3 shrink-0 opacity-60" />}
    </span>
  );
}

const LANE = 12;
const NODE_Y = 15;
const LANE_COLORS = ["var(--primary)", "#5fb3a8", "#d39a5f", "#c77dbb", "#6f9fd8", "#8db88f"];
const MAX_LANES = 8;

const laneX = (lane: number) => 10 + Math.min(lane, MAX_LANES - 1) * LANE;

/** One row of the commit graph: lines from above into the node or passing by, lines down to the parents. */
function GraphCell({ row, merge, selected }: { row: GraphRow; merge: boolean; selected: boolean }) {
  const path = (s: GraphRow["segments"][number]) => {
    const [y1, y2] = s.part === "top" ? [0, NODE_Y] : [NODE_Y, ROW_HEIGHT];
    const [x1, x2] = [laneX(s.from), laneX(s.to)];
    if (x1 === x2) return `M${x1} ${y1}V${y2}`;
    // Branch lines curve between lanes, like Fork and GitKraken.
    return `M${x1} ${y1}C${x1} ${y2} ${x2} ${y1} ${x2} ${y2}`;
  };
  const color = LANE_COLORS[row.color % LANE_COLORS.length];
  return (
    <svg
      aria-hidden
      className="absolute top-0 left-0 overflow-visible"
      width={laneX(row.lanes) + 4}
      height={ROW_HEIGHT}
    >
      {row.segments.map((s, i) => (
        <path
          key={i}
          d={path(s)}
          fill="none"
          strokeWidth={1.6}
          stroke={LANE_COLORS[s.color % LANE_COLORS.length]}
          strokeOpacity={0.75}
        />
      ))}
      <circle
        cx={laneX(row.col)}
        cy={NODE_Y}
        r={merge ? 3 : 4}
        fill={selected || merge ? color : "var(--panel)"}
        stroke={color}
        strokeWidth={2}
      />
    </svg>
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
};

function CommitRow({ commit, selected, top, onSelect, graph, graphWidth, actions, terms, repoPath }: CommitRowProps) {
  const t = useT();
  const badges = badgesOf(commit.refs);
  const { title, pr } = splitSubject(commit.subject);
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
          "absolute inset-x-0 flex cursor-default flex-col justify-center gap-0.5 overflow-hidden rounded-lg pr-3 hover:bg-white/[0.07]",
          selected && "bg-white/[0.06] hover:bg-white/[0.09]",
        )}
      >
        {graph ? (
          <GraphCell row={graph} merge={commit.parents.length > 1} selected={selected} />
        ) : (
          <span
            aria-hidden
            className="absolute top-[11px] left-[7px] size-2 rounded-full border-2 border-primary bg-panel"
          />
        )}
        <CommitHoverCard repoPath={repoPath} commit={commit} side="right">
          <span className="self-start truncate text-[12.5px] font-medium text-foreground max-w-full">
            <Highlight text={title} term={terms.message} />
          </span>
        </CommitHoverCard>
        <span className="flex min-w-0 items-center gap-2 text-[11.5px] text-muted-foreground">
          {/* Badges clip at this box's edge instead of squeezing, so the date always stays readable. */}
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <span className="max-w-[45%] shrink-0 truncate">
              <Highlight text={commit.author} term={terms.author} />
            </span>
            {pr && (
              <PullRequestHoverCard repoPath={repoPath} number={Number(pr)}>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/12 px-1.5 text-[11px] text-foreground/85">
                  <GitPullRequest aria-hidden className="size-3" />#{pr}
                </span>
              </PullRequestHoverCard>
            )}
            {badges.slice(0, MAX_BADGES).map((badge) => (
              <RefBadge key={`${badge.kind}:${badge.name}`} badge={badge} />
            ))}
            {extra > 0 && (
              <span
                title={badges
                  .slice(MAX_BADGES)
                  .map((b) => b.name)
                  .join(", ")}
                className="shrink-0 text-[11px]"
              >
                +{extra}
              </span>
            )}
          </span>
          <time dateTime={commit.authoredAt} className="shrink-0 tabular-nums">
            {formatCommitDate(commit.authoredAt, undefined, t.locale)}
          </time>
        </span>
      </div>
    </CommitMenu>
  );
}

function HistoryHeader({ repoPath }: { repoPath: string }) {
  const t = useT();
  const { historyRev, historyLabel } = useWorkspaceStore(
    useShallow((s) => ({ historyRev: s.historyRev, historyLabel: s.historyLabel })),
  );
  const refs = useRefs(repoPath).data;
  const headBranch = refs?.branches.find((b) => b.name === refs.head.branch);
  const title = historyLabel ?? historyRev ?? refs?.head.branch ?? "HEAD";
  return (
    <PanelHeader>
      <div data-tauri-drag-region className="min-w-0">
        <h2 className="truncate text-[13px] font-semibold">{title}</h2>
        {historyLabel && historyRev && (
          <p className="truncate text-[11.5px] text-muted-foreground" title={historyRev}>
            {historyRev}
          </p>
        )}
        {historyRev === null && headBranch && (
          <p className="truncate text-[11.5px] text-muted-foreground">
            ↑{headBranch.ahead} ↓{headBranch.behind} {headBranch.upstream ?? t("history.noUpstream")}
          </p>
        )}
      </div>
      <HistoryOptions />
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
  const graphWidth = graph ? laneX(Math.min(Math.max(1, ...graph.map((r) => r.lanes)), MAX_LANES)) + 8 : 26;

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
      <HistoryHeader repoPath={repoPath} />
      <PanelToolbar className="mt-1">
        <HistorySearchBar />
      </PanelToolbar>
      <div className="mt-4" />
      <IncomingCommits repoPath={repoPath} />
      <PullRequestChanges />
      <PullRequestStack repoPath={repoPath} />
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
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
                />
              );
            })}
          </div>
          {isFetchingNextPage && (
            <p className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
              <BrailleLoader className="text-primary" label={t("history.loadingMore")} />
              <span aria-hidden>{t("history.loadingMore")}</span>
            </p>
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
