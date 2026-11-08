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
  TriangleAlert,
  Crosshair,
} from "lucide-react";
import { FilterInput, PanelHeader, PanelMessage, PanelToolbar } from "@/components/layout/panel";
import { useCommits, useRefs } from "@/lib/git-queries";
import { formatCommitDate } from "@/lib/format-date";
import { nextListIndex } from "@/lib/list-navigation";
import { toGitError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { splitSubject } from "@/lib/commit-subject";
import { HistoryOptions } from "./HistoryOptions";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { CommitRef, CommitSummary } from "@/types/git";
import { useT } from "@/i18n";

const REF_ICONS = { head: Crosshair, branch: GitBranch, remote: Cloud, tag: Tag } as const;
const ROW_HEIGHT = 40;
const rowId = (hash: string) => `commit-${hash}`;

function matches(commit: CommitSummary, query: string): boolean {
  const q = query.toLowerCase();
  return [commit.subject, commit.author, commit.hash].some((field) => field.toLowerCase().includes(q));
}

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
      className="inline-flex max-w-40 min-w-0 shrink-0 items-center gap-1 rounded-full border border-white/12 px-1.5 text-[10px] text-foreground/85"
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{badge.name}</span>
      {badge.synced && <Cloud aria-label={t("history.inSyncShort")} className="size-3 shrink-0 opacity-60" />}
    </span>
  );
}

type CommitRowProps = { commit: CommitSummary; selected: boolean; top: number; onSelect: () => void };

function CommitRow({ commit, selected, top, onSelect }: CommitRowProps) {
  const t = useT();
  const badges = badgesOf(commit.refs);
  const { title, pr } = splitSubject(commit.subject);
  const extra = badges.length - MAX_BADGES;
  return (
    <div
      id={rowId(commit.hash)}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      title={`${commit.subject}\n${commit.hash.slice(0, 10)} · ${commit.author}`}
      style={{ transform: `translateY(${top}px)`, height: ROW_HEIGHT }}
      className={cn(
        "absolute inset-x-0 flex cursor-default flex-col justify-center gap-0.5 overflow-hidden rounded-lg pr-3 pl-8 hover:bg-white/4",
        selected && "bg-white/[0.06] hover:bg-white/[0.06]",
      )}
    >
      <span aria-hidden className="absolute top-0 bottom-0 left-3.5 w-px bg-primary/30" />
      <span
        aria-hidden
        className={cn(
          "absolute top-[11px] left-[11px] size-[7px] rounded-full border-[1.5px] border-primary bg-panel",
          (selected || commit.parents.length > 1) && "bg-primary",
        )}
      />
      <span className="truncate text-[11.5px] font-medium text-foreground">{title}</span>
      <span className="flex min-w-0 items-center gap-2 text-[10.5px] text-muted-foreground">
        {/* Badges clip at this box's edge instead of squeezing, so the date always stays readable. */}
        <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <span className="max-w-[45%] shrink-0 truncate">{commit.author}</span>
          {pr && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/12 px-1.5 text-[10px] text-foreground/85">
              <GitPullRequest aria-hidden className="size-3" />#{pr}
            </span>
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
              className="shrink-0 text-[10px]"
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
  );
}

function HistoryHeader({ repoPath }: { repoPath: string }) {
  const t = useT();
  const { historyRev, historyLabel } = useWorkspaceStore();
  const refs = useRefs(repoPath).data;
  const headBranch = refs?.branches.find((b) => b.name === refs.head.branch);
  const title = historyLabel ?? historyRev ?? refs?.head.branch ?? "HEAD";
  return (
    <PanelHeader>
      <div data-tauri-drag-region className="min-w-0">
        <h2 className="truncate text-[12px] font-semibold">{title}</h2>
        {historyLabel && historyRev && (
          <p className="truncate text-[10.5px] text-muted-foreground" title={historyRev}>
            {historyRev}
          </p>
        )}
        {historyRev === null && headBranch && (
          <p className="truncate text-[10.5px] text-muted-foreground">
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
  const { historyRev, showHistoryOf } = useWorkspaceStore();
  const refs = useRefs(repoPath).data;
  const branch = refs?.branches.find((b) => b.name === refs.head.branch);
  if (historyRev !== null || !branch?.upstream || branch.behind === 0) return null;
  const upstream = branch.upstream;
  return (
    <button
      type="button"
      onClick={() => showHistoryOf(upstream)}
      className="mx-2 mb-1 flex h-6 shrink-0 items-center gap-1 rounded-lg border border-dashed border-white/15 px-3 text-[10.5px] text-muted-foreground outline-none hover:border-white/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="truncate">{t.plural("history.incoming", branch.behind, { upstream })}</span>
      <ChevronRight aria-hidden className="size-3 shrink-0" />
    </button>
  );
}

export function CommitList({ repoPath }: { repoPath: string }) {
  const t = useT();
  const { historyRev, selectedCommitHash, selectCommit } = useWorkspaceStore();
  const history = useCommits(repoPath, historyRev);
  const [query, setQuery] = useState("");
  const loaded = useMemo(() => history.data?.pages.flat() ?? [], [history.data]);
  const commits = useMemo(() => (query ? loaded.filter((c) => matches(c, query)) : loaded), [loaded, query]);
  const selectedIndex = commits.findIndex((c) => c.hash === selectedCommitHash);

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

  // ponytail: the filter only searches loaded pages; add `git log --grep/--author` server-side if that's not enough
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && lastVisible >= commits.length - 30) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, lastVisible, commits.length]);

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
        <FilterInput label={t("history.filter")} value={query} onValueChange={setQuery} className="flex-1" />
      </PanelToolbar>
      <div className="mt-4" />
      <IncomingCommits repoPath={repoPath} />
      {history.isError ? (
        <PanelMessage
          icon={<TriangleAlert />}
          title={t("history.loadError")}
          hint={toGitError(history.error).message}
        />
      ) : history.isPending ? (
        <PanelMessage title={t("history.loading")} />
      ) : commits.length === 0 ? (
        query ? (
          <PanelMessage icon={<SearchX />} title={t("history.noMatch")} hint={t("history.noMatchHint")} />
        ) : (
          <PanelMessage icon={<GitCommitHorizontal />} title={t("history.empty")} hint={t("history.emptyHint")} />
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
                />
              );
            })}
          </div>
          {isFetchingNextPage && (
            <p className="py-2 text-center text-xs text-muted-foreground">{t("history.loadingMore")}</p>
          )}
        </div>
      )}
    </section>
  );
}
