import { useShallow } from "zustand/react/shallow";
import { DataUnavailable } from "@/components/states";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { FolderOpen, GitCommitHorizontal, GitPullRequest, List, ListTree, SearchX, Triangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FilterInput, PanelHeader, PanelLoading, PanelMessage, PanelToolbar } from "@/components/layout/panel";
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
      title={file?.previousPath ? `${file.previousPath} → ${node.path}` : node.path}
      className={cn(
        "flex h-7 cursor-default items-center gap-2 rounded-md pr-2 text-[12px] hover:bg-white/[0.07]",
        node.kind === "dir" ? "text-muted-foreground" : "text-foreground/90",
        active && "bg-white/[0.06] text-foreground hover:bg-white/[0.09]",
      )}
    >
      {node.kind === "dir" ? (
        <Triangle
          aria-hidden
          className={cn(
            "size-[7px] shrink-0 fill-current transition-transform",
            collapsed ? "rotate-90" : "rotate-180",
          )}
        />
      ) : (
        <FileIcon path={node.path} className="size-3.5" />
      )}
      <MiddleTruncate text={node.name} tail={18} />
      {list && slash > 0 && (
        <MiddleTruncate text={node.path.slice(0, slash)} tail={14} className="text-[11.5px] text-muted-foreground" />
      )}
      {file && <StatusMark file={file} />}
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
      <AuthorAvatar name={commit.author} src={avatar.data} className="size-7" />
      <div data-tauri-drag-region className="min-w-0">
        <h2
          className="flex min-w-0 items-center gap-1.5 text-[14px] font-semibold text-white/95"
          title={commit.subject}
        >
          <span className="truncate">{title}</span>
          {pr && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/12 px-1.5 text-[11px] font-normal text-foreground/85">
              <GitPullRequest aria-hidden className="size-3" />#{pr}
            </span>
          )}
        </h2>
        <p className="flex gap-1.5 truncate text-[12px] text-foreground/90">
          <span title={commit.authorEmail}>{commit.author}</span>
          {coAuthors > 0 && <span title={commit.coAuthors.join(", ")}>+{coAuthors}</span>}
          <span>{formatCommitDate(commit.authoredAt, undefined, t.locale)}</span>
          <span className="font-mono text-muted-foreground select-text">{commit.hash.slice(0, 7)}</span>
          {commit.parents.length > 1 && <span>{t("files.merge")}</span>}
        </p>
      </div>
    </div>
  );
}

/** Header of a pull request's whole diff: who opened it, and that every commit is included. */
function PullRequestHeader({ pr }: { pr: ActivePullRequest }) {
  const t = useT();
  return (
    <div data-tauri-drag-region className="flex min-w-0 items-center gap-2.5">
      <AuthorAvatar
        name={pr.author}
        src={`https://avatars.githubusercontent.com/${pr.author}?s=64`}
        className="size-7"
      />
      <div data-tauri-drag-region className="min-w-0">
        <h2 className="flex min-w-0 items-center gap-1.5 text-[14px] font-semibold text-white/95" title={pr.title}>
          <span className="truncate">{pr.title}</span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/12 px-1.5 text-[11px] font-normal text-foreground/85">
            <GitPullRequest aria-hidden className="size-3" />#{pr.number}
          </span>
        </h2>
        <p className="flex gap-1.5 truncate text-[12px] text-foreground/90">
          <span>{pr.author}</span>
          <span className="text-muted-foreground">{t("pr.allChanges")}</span>
          <span className="font-mono text-muted-foreground select-text">{pr.head.slice(0, 7)}</span>
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

function FileList({ files }: { files: ChangedFile[] }) {
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

  return (
    <>
      <PanelToolbar className="mt-1 gap-1">
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
      {navRows.length === 0 ? (
        <PanelMessage
          icon={files.length ? <SearchX /> : <FolderOpen />}
          title={files.length ? t("files.noMatch") : t("files.none")}
        />
      ) : (
        <ul
          role="listbox"
          aria-label={t("files.listLabel")}
          aria-activedescendant={current ? rowId(current) : undefined}
          tabIndex={0}
          data-scroll-container
          onKeyDown={onKeyDown}
          className="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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

function CommitFiles({ repoPath, hash, base }: { repoPath: string; hash: string; base: string | null }) {
  const t = useT();
  const files = useCommitFiles(repoPath, hash, base);
  if (files.isError) {
    return <DataUnavailable title={t("files.listError")} error={files.error} onRetry={() => void files.refetch()} />;
  }
  if (!files.data) return <PanelLoading title={t("files.loading")} variant="grid-columns" />;
  return <FileList files={files.data} />;
}

export function ChangedFilesPanel({ repoPath }: { repoPath: string }) {
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
  const commit = useCommits(repoPath, historyRev)
    .data?.pages.flat()
    .find((c) => c.hash === hash);
  return (
    <section aria-label={t("files.panel")} className="flex h-full flex-col bg-panel">
      <PanelHeader>
        {base && pullRequest ? (
          <PullRequestHeader pr={pullRequest} />
        ) : (
          commit && <CommitHeader repoPath={repoPath} commit={commit} />
        )}
      </PanelHeader>
      {hash ? (
        <CommitFiles key={`${hash}:${base}`} repoPath={repoPath} hash={hash} base={base} />
      ) : (
        <PanelMessage icon={<GitCommitHorizontal />} title={t("files.noCommit")} hint={t("files.noCommitHint")} />
      )}
    </section>
  );
}
