import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";
import { FileIcon } from "@/components/file-icon";
import { BrailleLoader } from "@/components/braille-loader";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { editorOf, useEditorStore } from "@/stores/editor-store";
import { useRepoFiles } from "./EditorPage";
import { buildTree, parentsOf, visibleRows, type TreeRow } from "./file-tree";
import { fuzzyFilter } from "./fuzzy";

const ROW_HEIGHT = 26;

/** The project's files: a virtualized tree (thousands of files stay smooth), or fuzzy matches when filtering. */
export function FileTree({ repoPath, query }: { repoPath: string; query: string }) {
  const t = useT();
  const files = useRepoFiles(repoPath);
  const { active, folders } = useEditorStore((s) => editorOf(s, repoPath));
  const { open, toggleFolder } = useEditorStore.getState();
  const tree = useMemo(() => buildTree(files.data ?? []), [files.data]);
  const openFolders = useMemo(() => new Set(folders), [folders]);
  const rows: TreeRow[] = useMemo(() => {
    if (query.trim())
      return fuzzyFilter(query, files.data ?? [], 200).map((path) => ({
        path,
        name: path,
        depth: 0,
        dir: false,
        open: false,
      }));
    return visibleRows(tree, openFolders);
  }, [files.data, openFolders, query, tree]);
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

  if (files.isPending)
    return (
      <div className="p-3">
        <BrailleLoader className="text-primary" label={t("common.loading")} />
      </div>
    );
  if (files.isError) return <p className="p-3 text-[12.5px] text-removed-foreground">{String(files.error)}</p>;
  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-1.5 pb-2">
      <div style={{ height: virtualizer.getTotalSize() }} className="relative">
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          const slash = row.path.lastIndexOf("/");
          return (
            <button
              key={row.path}
              type="button"
              title={row.path}
              onClick={() => (row.dir ? toggleFolder(repoPath, row.path) : open(repoPath, row.path))}
              style={{ transform: `translateY(${item.start}px)`, height: ROW_HEIGHT, paddingLeft: 8 + row.depth * 12 }}
              className={cn(
                "absolute inset-x-0 flex items-center gap-1.5 rounded-md pr-2 text-left text-[12.5px] outline-none hover:bg-white/[0.05] focus-visible:bg-white/[0.07]",
                row.path === active && "bg-white/[0.08] text-foreground",
                row.path !== active && "text-foreground/85",
              )}
            >
              {row.dir ? (
                <ChevronRight
                  aria-hidden
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    row.open && "rotate-90",
                  )}
                />
              ) : (
                <FileIcon path={row.path} className="size-3.5 shrink-0" />
              )}
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
  );
}
