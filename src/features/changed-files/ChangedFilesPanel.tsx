import { useShallow } from "zustand/react/shallow";
import { DiffStatBar, LineCounts } from "@/components/diffstat";
import { AgentBadge, coAgentOf } from "@/components/agent-badge";
import { useHistorySearchStore } from "@/features/history/history-search-store";
import { DataUnavailable, EmptyState } from "@/components/states";
import { RowSkeleton, SkeletonList } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronRight, Folder, FolderOpen, GitCommitHorizontal, List, ListTree, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FilterInput, PanelHeader, PanelToolbar } from "@/components/layout/panel";
import { FileIcon } from "@/components/file-icon";
import { AuthorAvatar } from "@/components/author-avatar";
import { MiddleTruncate } from "@/components/middle-truncate";
import { useAvatar, useCommitFiles, useCommits } from "@/lib/git-queries";
import { formatCommitDate } from "@/lib/format-date";
import { splitSubject } from "@/lib/commit-subject";
import { nextListIndex } from "@/lib/list-navigation";
import { revealInContainer } from "@/lib/reveal";
import { cn } from "@/lib/utils";
import { useWorkspaceStore, type ActivePullRequest } from "@/stores/workspace-store";
import { useViewSettings, type FileListMode } from "@/stores/view-settings-store";
import { isGenerated } from "@/features/diff/generated";
import type { ChangedFile, CommitSummary } from "@/types/git";
import { buildFileRows, type FileListRow } from "./file-tree";
import { changeMark, FILE_STATUS } from "./file-status";
import { CommitHoverCard, PullRequestHoverCard } from "@/features/refs/RefPreview";
import { useT, type MessageKey } from "@/i18n";

type FileRow = Extract<FileListRow, { kind: "row" }>;

const rowId = (key: string) => `files-${key}`;
const TOGGLE_KEYS = new Set(["Enter", " ", "ArrowLeft", "ArrowRight"]);

function StatusMark({ file }: { file: ChangedFile }) {
  const t = useT();
  const mark = changeMark(file, t);
  return (
    <span
      role="img"
      aria-label={mark.label}
      title={mark.label}
      className="ml-auto grid w-3 shrink-0 place-items-center"
    >
      <span className={mark.className} />
    </span>
  );
}

type RowProps = { row: FileRow; list: boolean; active: boolean; collapsed: boolean; onActivate: () => void };

function Row({ row, list, active, collapsed, onActivate }: RowProps) {
  const { node, depth } = row;
  const file = node.kind === "file" ? node.file : null;
  const slash = node.path.lastIndexOf("/");
  return (
    <li
      id={rowId(row.key)}
      role="option"
      aria-selected={active}
      aria-expanded={node.kind === "dir" ? !collapsed : undefined}
      onClick={onActivate}
      style={{ paddingLeft: `${depth * 14 + 10}px` }}
      title={file ? (file.previousPath ? `${file.previousPath} → ${node.path}` : node.path) : undefined}
      className={cn(
        "relative flex h-6 cursor-default items-center gap-2 rounded-md pr-2 text-[12.5px]",
        node.kind === "dir"
          ? "text-[12px] text-muted-foreground hover:text-foreground"
          : "text-foreground/90 hover:bg-white/[0.05]",
        active && "bg-primary/[0.12] text-foreground hover:bg-primary/[0.16]",
      )}
    >
      {/* Indent guides: one hairline per level, so a deep file reads as part of its folder. */}
      {Array.from({ length: depth }, (_, i) => (
        <span key={i} aria-hidden className="absolute inset-y-0 w-px bg-white/[0.06]" style={{ left: i * 14 + 16 }} />
      ))}
      {node.kind === "dir" ? (
        <span className="flex shrink-0 items-center gap-1">
          <ChevronRight aria-hidden className={cn("size-3 shrink-0 transition-transform", !collapsed && "rotate-90")} />
          <Folder aria-hidden className="size-3.5 shrink-0" />
        </span>
      ) : (
        <FileIcon path={node.path} className="size-3.5" />
      )}
      <MiddleTruncate text={node.name} tail={18} />
      {list && slash > 0 && (
        <MiddleTruncate text={node.path.slice(0, slash)} tail={14} className="text-[11.5px] text-muted-foreground" />
      )}
      {file &&
        (file.additions || file.deletions ? (
          <LineCounts add={file.additions ?? 0} del={file.deletions ?? 0} className="ml-auto pl-1 text-[10.5px]" />
        ) : (
          <StatusMark file={file} />
        ))}
    </li>
  );
}

function CommitHeader({ repoPath, commit }: { repoPath: string; commit: CommitSummary }) {
  const t = useT();
  const avatar = useAvatar(repoPath, commit.hash, commit.authorEmail);
  const { title, pr } = splitSubject(commit.subject);
  const coAuthors = commit.coAuthors.length;
  return (
    <div data-tauri-drag-region className="flex min-w-0 items-center gap-2.5">
      <span className="relative shrink-0">
        <AuthorAvatar name={commit.author} src={avatar.data} className="size-8" />
        {coAgentOf(commit.coAuthors) && (
          <AgentBadge agent={coAgentOf(commit.coAuthors) ?? "claude"} className="absolute -right-1 -bottom-1 size-4" />
        )}
      </span>
      <div data-tauri-drag-region className="min-w-0">
        <h2
          className="flex min-w-0 items-center gap-1.5 text-[14px] font-semibold text-white/95"
          title={commit.subject}
        >
          <span className="truncate">{title}</span>
          {pr && (
            <PullRequestHoverCard repoPath={repoPath} number={Number(pr)}>
              <span
                tabIndex={0}
                className="shrink-0 rounded-sm text-[13px] font-normal text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                #{pr}
              </span>
            </PullRequestHoverCard>
          )}
        </h2>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-muted-foreground">
          <span title={commit.authorEmail} className="text-foreground/85">
            {commit.author}
          </span>
          {coAuthors > 0 && <span title={commit.coAuthors.join(", ")}>+{coAuthors}</span>}
          <span aria-hidden>·</span>
          <span>{formatCommitDate(commit.authoredAt, undefined, t.locale)}</span>
          <CommitHoverCard repoPath={repoPath} commit={commit}>
            <span
              tabIndex={0}
              className="rounded-md bg-white/[0.06] px-1.5 py-px font-mono text-[11px] outline-none select-text hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {commit.hash.slice(0, 7)}
            </span>
          </CommitHoverCard>
          {commit.parents.length > 1 && (
            <span className="rounded-md bg-merged/15 px-1.5 py-px text-[11px] text-merged">{t("files.merge")}</span>
          )}
        </p>
      </div>
    </div>
  );
}

/** Header of a pull request's whole diff: who opened it, and that every commit is included. */
function PullRequestHeader({ repoPath, pr }: { repoPath: string; pr: ActivePullRequest }) {
  const t = useT();
  return (
    <div data-tauri-drag-region className="flex min-w-0 items-center gap-2.5">
      <AuthorAvatar
        name={pr.author}
        src={`https://avatars.githubusercontent.com/${pr.author}?s=64`}
        className="size-8"
      />
      <div data-tauri-drag-region className="min-w-0">
        <h2 className="flex min-w-0 items-center gap-1.5 text-[14px] font-semibold text-white/95" title={pr.title}>
          <span className="truncate">{pr.title}</span>
          <PullRequestHoverCard repoPath={repoPath} number={pr.number}>
            <span
              tabIndex={0}
              className="shrink-0 rounded-sm text-[13px] font-normal text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              #{pr.number}
            </span>
          </PullRequestHoverCard>
        </h2>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-muted-foreground">
          <span className="text-foreground/85">{pr.author}</span>
          <span aria-hidden>·</span>
          <span>{t("pr.allChanges")}</span>
          <span className="rounded-md bg-white/[0.06] px-1.5 py-px font-mono text-[11px] select-text">
            {pr.head.slice(0, 7)}
          </span>
        </p>
      </div>
    </div>
  );
}

function ModeButton({ mode, label, icon }: { mode: FileListMode; label: MessageKey; icon: ReactNode }) {
  const t = useT();
  const { fileList, set } = useViewSettings(useShallow((s) => ({ fileList: s.fileList, set: s.set })));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t(label)}
          aria-pressed={fileList === mode}
          onClick={() => set("fileList", mode)}
          className={cn(
            "size-7 rounded-full text-muted-foreground [&_svg]:size-3.5",
            fileList === mode && "bg-white/10 text-foreground",
          )}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t(label)}</TooltipContent>
    </Tooltip>
  );
}

function useToggleSet() {
  const [set, setSet] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setSet((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return [set, toggle] as const;
}

/** What the change weighs: files, lines added and removed, and their split. */
/** Folding the file list away: the diff below already shows every file, each under its own header. */
type Fold = { open: boolean; toggle: () => void };

function FilesSummaryLine({ files, fold }: { files: ChangedFile[]; fold?: Fold }) {
  const t = useT();
  const add = files.reduce((sum, f) => sum + (f.additions ?? 0), 0);
  const del = files.reduce((sum, f) => sum + (f.deletions ?? 0), 0);
  const body = (
    <>
      {fold && (
        <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 transition-transform", fold.open && "rotate-90")} />
      )}
      <span className="min-w-0 truncate">{t.plural("files.changed", files.length)}</span>
      <LineCounts add={add} del={del} className="ml-auto" />
      <DiffStatBar add={add} del={del} />
    </>
  );
  return fold ? (
    <button
      type="button"
      aria-expanded={fold.open}
      onClick={fold.toggle}
      className="mx-2 my-1.5 flex h-8 items-center gap-2 rounded-lg px-2.5 text-left text-[12.5px] text-muted-foreground outline-none hover:bg-white/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </button>
  ) : (
    <p className="mx-4 mt-3 mb-1 flex items-center gap-2 text-[12px] text-muted-foreground">{body}</p>
  );
}

function FileList({ files, fold }: { files: ChangedFile[]; fold?: Fold }) {
  const t = useT();
  const { selectedFilePath, selectFile } = useWorkspaceStore(
    useShallow((s) => ({ selectedFilePath: s.selectedFilePath, selectFile: s.selectFile })),
  );
  const { fileList, grouping, hideGenerated } = useViewSettings(
    useShallow((s) => ({ fileList: s.fileList, grouping: s.grouping, hideGenerated: s.hideGenerated })),
  );
  const [query, setQuery] = useState("");
  const [collapsed, toggle] = useToggleSet();
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const shown = hideGenerated ? files.filter((f) => !isGenerated(f.path)) : files;
  const rows = useMemo(() => {
    const matching = shown.filter((f) => f.path.toLowerCase().includes(query.toLowerCase()));
    return buildFileRows(matching, { mode: fileList, grouping, collapsed: query ? new Set() : collapsed });
  }, [shown, query, fileList, grouping, collapsed]);
  const navRows = rows.filter((r): r is FileRow => r.kind === "row");
  const current = activeKey ?? navRows.find((r) => r.node.path === selectedFilePath)?.key ?? null;

  const activate = (row: FileRow) => {
    setActiveKey(row.key);
    if (row.node.kind === "dir") toggle(row.key);
    else selectFile(row.node.path);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const index = navRows.findIndex((r) => r.key === current);
    const row = navRows[index];
    if (row?.node.kind === "dir" && TOGGLE_KEYS.has(event.key)) {
      event.preventDefault();
      return toggle(row.key);
    }
    const next = nextListIndex(event.key, index, navRows.length);
    if (next === null) return;
    event.preventDefault();
    const target = navRows[next];
    setActiveKey(target.key);
    if (target.node.kind === "file") selectFile(target.node.path);
    revealInContainer(rowId(target.key));
  };

  if (fold && !fold.open) return <FilesSummaryLine files={shown} fold={fold} />;
  return (
    <>
      {fold && shown.length > 0 && <FilesSummaryLine files={shown} fold={fold} />}
      <PanelToolbar className={cn("gap-1", fold ? "mb-1" : "mt-1")}>
        <FilterInput
          label={t.plural("files.filter", shown.length)}
          placeholder={t.plural("files.count", shown.length)}
          icon="search"
          value={query}
          onValueChange={setQuery}
          className="flex-1"
        />
        <ModeButton mode="list" label="files.flat" icon={<List />} />
        <ModeButton mode="tree" label="files.tree" icon={<ListTree />} />
      </PanelToolbar>
      {!fold && shown.length > 0 && <FilesSummaryLine files={shown} />}
      {navRows.length === 0 ? (
        <EmptyState
          size="sm"
          icon={files.length ? <SearchX /> : <FolderOpen />}
          title={files.length ? t("files.noMatch") : t("files.none")}
          action={query ? { label: t("common.clearFilter"), onClick: () => setQuery("") } : undefined}
        />
      ) : (
        <ul
          role="listbox"
          aria-label={t("files.listLabel")}
          aria-activedescendant={current ? rowId(current) : undefined}
          tabIndex={0}
          data-scroll-container
          onKeyDown={onKeyDown}
          className="mt-1 min-h-0 flex-1 overflow-y-auto px-2 pb-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {rows.map((row) =>
            row.kind === "header" ? (
              <li
                key={row.key}
                role="presentation"
                className="px-2.5 pt-2.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
              >
                {t(FILE_STATUS[row.status].label)} <span className="font-mono">{row.count}</span>
              </li>
            ) : (
              <Row
                key={row.key}
                row={row}
                list={fileList === "list"}
                active={row.key === current}
                collapsed={collapsed.has(row.key)}
                onActivate={() => activate(row)}
              />
            ),
          )}
        </ul>
      )}
    </>
  );
}

/** The filter bar, then file rows (h-7: icon and name). */
function FileListSkeleton() {
  return (
    <>
      <PanelToolbar className="mt-1">
        <Skeleton className="h-7 flex-1 rounded-md bg-white/[0.035]" />
      </PanelToolbar>
      <SkeletonList
        rows={12}
        className="mt-4 px-2"
        row={(i) => <RowSkeleton i={i} height={28} lines={1} trail={false} className="pl-2.5" />}
      />
    </>
  );
}

function CommitFiles({
  repoPath,
  hash,
  base,
  fold,
}: {
  repoPath: string;
  hash: string;
  base: string | null;
  fold?: Fold;
}) {
  const t = useT();
  const files = useCommitFiles(repoPath, hash, base);
  if (files.isError) {
    return <DataUnavailable title={t("files.listError")} error={files.error} onRetry={() => void files.refetch()} />;
  }
  if (!files.data) return <FileListSkeleton />;
  return <FileList files={files.data} fold={fold} />;
}

/**
 * `header`: off under the commit list, where the picked commit is already in view. `actions`: tools shown at the
 * header's end (the diff's, when the files sit above it).
 */
export function ChangedFilesPanel({
  repoPath,
  header = true,
  actions,
  fold,
}: {
  repoPath: string;
  header?: boolean;
  actions?: ReactNode;
  /** The list folds to its one-line summary. */
  fold?: Fold;
}) {
  const t = useT();
  const {
    selectedCommitHash: hash,
    compareBase: base,
    pullRequest,
    historyRev,
  } = useWorkspaceStore(
    useShallow((s) => ({
      selectedCommitHash: s.selectedCommitHash,
      compareBase: s.compareBase,
      pullRequest: s.pullRequest,
      historyRev: s.historyRev,
    })),
  );
  // Same search as the commit list: a match deep in history is found in its results.
  const search = useHistorySearchStore((s) => s.search);
  const commit = useCommits(repoPath, historyRev, search)
    .data?.pages.flat()
    .find((c) => c.hash === hash);
  return (
    <section aria-label={t("files.panel")} className="flex h-full flex-col bg-panel">
      {header && (
        <PanelHeader>
          {base && pullRequest ? (
            <PullRequestHeader repoPath={repoPath} pr={pullRequest} />
          ) : (
            commit && <CommitHeader repoPath={repoPath} commit={commit} />
          )}
          {actions && <span className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</span>}
        </PanelHeader>
      )}
      {hash ? (
        <CommitFiles key={`${hash}:${base}`} repoPath={repoPath} hash={hash} base={base} fold={fold} />
      ) : (
        <EmptyState
          size="sm"
          icon={<GitCommitHorizontal />}
          title={t("files.noCommit")}
          hint={t("files.noCommitHint")}
        />
      )}
    </section>
  );
}
