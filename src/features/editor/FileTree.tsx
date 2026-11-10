import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ask } from "@tauri-apps/plugin-dialog";
import { ChevronRight, Copy, FilePlus, FolderOpen, FolderPlus, Link, Pencil, Trash2 } from "lucide-react";
import { FileIcon } from "@/components/file-icon";
import { BrailleLoader } from "@/components/braille-loader";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { editorOf, isUnder, useEditorStore } from "@/stores/editor-store";
import { useNoticesStore } from "@/stores/notices-store";
import { unsavedPaths, useRepoFiles } from "./EditorPage";
import { buildTree, parentsOf, visibleRows, type TreeRow } from "./file-tree";
import { fuzzyFilter } from "./fuzzy";

const ROW_HEIGHT = 26;
/** The row holding the name input of a file or folder being created. */
const DRAFT = "\0draft";

/** A name being typed in the tree: a new entry inside `parent`, or a rename of `path`. */
type Draft = { kind: "file" | "folder"; parent: string } | { kind: "rename"; path: string };

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const dirOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf("/"), 0));
const moveUnder = (path: string, from: string, to: string) =>
  isUnder(path, from) ? to + path.slice(from.length) : path;

/** Inline name field: Enter or leaving it commits, Escape cancels; a rename preselects the name without extension. */
function InlineName({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    const name = value?.trim();
    if (name && name !== initial) onSubmit(name);
    else onCancel();
  };
  return (
    <input
      autoFocus
      defaultValue={initial}
      aria-label={initial ? t("editor.rename") : t("editor.newFile")}
      onFocus={(e) => {
        const dot = initial.lastIndexOf(".");
        e.currentTarget.setSelectionRange(0, dot > 0 ? dot : initial.length);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(e.currentTarget.value);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      className="h-5 min-w-0 flex-1 rounded-sm border border-primary/60 bg-background px-1 text-[12.5px] outline-none"
    />
  );
}

/** The project's files: a virtualized tree (thousands of files stay smooth), or fuzzy matches when filtering. */
export function FileTree({ repoPath, query }: { repoPath: string; query: string }) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const files = useRepoFiles(repoPath);
  const { active, folders } = useEditorStore((s) => editorOf(s, repoPath));
  const { open, toggleFolder, renamePath, removePath } = useEditorStore.getState();
  // Folders created here and still empty: git doesn't list them. ponytail: forgotten when the tree unmounts.
  const [emptyDirs, setEmptyDirs] = useState<string[]>([]);
  const [target, setTarget] = useState<TreeRow | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const tree = useMemo(() => buildTree(files.data ?? [], emptyDirs), [files.data, emptyDirs]);
  const openFolders = useMemo(() => new Set(folders), [folders]);
  const rows: TreeRow[] = useMemo(() => {
    const base = query.trim()
      ? fuzzyFilter(query, files.data ?? [], 200).map((path) => ({
          path,
          name: path,
          depth: 0,
          dir: false,
          open: false,
        }))
      : visibleRows(tree, openFolders);
    if (!draft || draft.kind === "rename") return base;
    const at = draft.parent ? base.findIndex((r) => r.path === draft.parent) : -1;
    const row = {
      path: DRAFT,
      name: "",
      depth: at >= 0 ? base[at].depth + 1 : 0,
      dir: draft.kind === "folder",
      open: false,
    };
    return [...base.slice(0, at + 1), row, ...base.slice(at + 1)];
  }, [draft, files.data, openFolders, query, tree]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // The file in front is revealed: its folders open and it scrolls into view.
  useEffect(() => {
    if (!active) return;
    for (const folder of parentsOf(active)) toggleFolder(repoPath, folder, true);
  }, [active, repoPath, toggleFolder]);
  const activeIndex = rows.findIndex((r) => r.path === active);
  useEffect(() => {
    if (activeIndex >= 0) virtualizer.scrollToIndex(activeIndex, { align: "auto" });
  }, [activeIndex, virtualizer]);
  const draftIndex = rows.findIndex((r) => r.path === DRAFT);
  useEffect(() => {
    if (draftIndex >= 0) virtualizer.scrollToIndex(draftIndex, { align: "auto" });
  }, [draftIndex, virtualizer]);

  const attempt = async (op: () => Promise<unknown>) => {
    try {
      await op();
    } catch (error) {
      notify({ tone: "error", title: t("editor.fileOpFailed"), detail: toGitError(error).message });
    } finally {
      void client.invalidateQueries({ queryKey: ["files", repoPath] });
    }
  };
  /** Unsaved edits under `path` would be lost by a rename or delete: refuse and say why. */
  const blocked = (path: string) => {
    const dirty = [...unsavedPaths(repoPath)].find((p) => isUnder(p, path));
    if (dirty) notify({ tone: "error", title: t("editor.unsavedBlocked", { name: dirty }) });
    return dirty !== undefined;
  };

  // Once the menu has closed: while open it keeps focus inside and would blur the name field at once.
  const editLater = (next: Draft) => setTimeout(() => setDraft(next), 0);
  const startCreate = (kind: "file" | "folder") => {
    const parent = target ? (target.dir ? target.path : dirOf(target.path)) : "";
    if (parent) toggleFolder(repoPath, parent, true);
    editLater({ kind, parent });
  };
  const submit = (name: string) => {
    setDraft(null);
    if (!draft) return;
    if (draft.kind === "rename") {
      const { path } = draft;
      const to = join(dirOf(path), name);
      void attempt(async () => {
        await gitBackend.renamePath(repoPath, path, to);
        renamePath(repoPath, path, to);
        setEmptyDirs((dirs) => dirs.map((d) => moveUnder(d, path, to)));
      });
      return;
    }
    const path = join(draft.parent, name);
    const kind = draft.kind;
    void attempt(async () => {
      if (kind === "file") {
        await gitBackend.createFile(repoPath, path);
        open(repoPath, path);
      } else {
        await gitBackend.createDir(repoPath, path);
        setEmptyDirs((dirs) => [...dirs, path]);
      }
    });
  };
  const remove = async (row: TreeRow) => {
    if (blocked(row.path)) return;
    const name = row.path.split("/").pop() ?? row.path;
    const confirmed = await ask(t("editor.deleteConfirm", { name }), { kind: "warning", okLabel: t("editor.delete") });
    if (!confirmed) return;
    await attempt(async () => {
      await gitBackend.deletePath(repoPath, row.path);
      removePath(repoPath, row.path);
      setEmptyDirs((dirs) => dirs.filter((d) => !isUnder(d, row.path)));
    });
  };

  if (files.isPending)
    return (
      <div className="p-3">
        <BrailleLoader className="text-primary" label={t("common.loading")} />
      </div>
    );
  if (files.isError) return <p className="p-3 text-[12.5px] text-removed-foreground">{String(files.error)}</p>;
  return (
    <ContextMenu onOpenChange={(isOpen) => !isOpen && setTarget(null)}>
      <ContextMenuTrigger asChild>
        <div
          ref={scrollRef}
          onContextMenuCapture={() => setTarget(null)}
          className="h-full overflow-y-auto px-1.5 pb-2"
        >
          <div style={{ height: virtualizer.getTotalSize() }} className="relative">
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              const slash = row.path.lastIndexOf("/");
              const style = {
                transform: `translateY(${item.start}px)`,
                height: ROW_HEIGHT,
                paddingLeft: 8 + row.depth * 12,
              };
              const editing = row.path === DRAFT || (draft?.kind === "rename" && draft.path === row.path);
              const icon = row.dir ? (
                <ChevronRight
                  aria-hidden
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    row.open && "rotate-90",
                  )}
                />
              ) : (
                <FileIcon path={row.path === DRAFT ? "" : row.path} className="size-3.5 shrink-0" />
              );
              if (editing)
                return (
                  <div
                    key={row.path}
                    style={style}
                    className="absolute inset-x-0 flex items-center gap-1.5 rounded-md bg-white/[0.05] pr-2"
                  >
                    {icon}
                    <InlineName
                      initial={row.path === DRAFT ? "" : row.path.slice(slash + 1)}
                      onSubmit={submit}
                      onCancel={() => setDraft(null)}
                    />
                  </div>
                );
              return (
                <button
                  key={row.path}
                  type="button"
                  title={row.path}
                  onClick={() => (row.dir ? toggleFolder(repoPath, row.path) : open(repoPath, row.path))}
                  onContextMenu={() => setTarget(row)}
                  style={style}
                  className={cn(
                    "absolute inset-x-0 flex items-center gap-1.5 rounded-md pr-2 text-left text-[12.5px] outline-none hover:bg-white/[0.05] focus-visible:bg-white/[0.07]",
                    row.path === active && "bg-white/[0.08] text-foreground",
                    row.path !== active && "text-foreground/85",
                    target?.path === row.path && "ring-1 ring-primary/50 ring-inset",
                  )}
                >
                  {icon}
                  {query.trim() && !row.dir ? (
                    <>
                      <span className="shrink-0">{row.path.slice(slash + 1)}</span>
                      <span className="min-w-0 truncate text-[11.5px] text-muted-foreground">
                        {row.path.slice(0, Math.max(slash, 0))}
                      </span>
                    </>
                  ) : (
                    <span className="min-w-0 truncate">{row.name}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52" onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem onSelect={() => startCreate("file")}>
          <FilePlus aria-hidden />
          {t("editor.newFile")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => startCreate("folder")}>
          <FolderPlus aria-hidden />
          {t("editor.newFolder")}
        </ContextMenuItem>
        {target && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => !blocked(target.path) && editLater({ kind: "rename", path: target.path })}>
              <Pencil aria-hidden />
              {t("editor.rename")}
            </ContextMenuItem>
            {!target.dir && (
              <ContextMenuItem
                onSelect={() =>
                  void attempt(async () => open(repoPath, await gitBackend.duplicateFile(repoPath, target.path)))
                }
              >
                <Copy aria-hidden />
                {t("editor.duplicate")}
              </ContextMenuItem>
            )}
            <ContextMenuItem variant="destructive" onSelect={() => void remove(target)}>
              <Trash2 aria-hidden />
              {t("editor.delete")}
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => void navigator.clipboard.writeText(target ? `${repoPath}/${target.path}` : repoPath)}
        >
          <Link aria-hidden />
          {t("editor.copyPath")}
        </ContextMenuItem>
        {target && (
          <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(target.path)}>
            <Link aria-hidden />
            {t("editor.copyRelativePath")}
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => void attempt(() => gitBackend.revealPath(repoPath, target?.path ?? "."))}>
          <FolderOpen aria-hidden />
          {t("editor.revealInFinder")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
