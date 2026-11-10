import { useEffect, useState } from "react";
import { Files, Search } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";
import { ConflictsSection } from "./ConflictsSection";
import { FileTree } from "./FileTree";
import { SearchPanel } from "./SearchPanel";

/** The editor's left column: the file tree, or the project search (⇧⌘F). */
export function EditorSidebar({ repoPath }: { repoPath: string }) {
  const t = useT();
  const sidebar = useEditorStore((s) => s.sidebar);
  const setSidebar = useEditorStore((s) => s.setSidebar);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSidebar("search");
      }
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setSidebar("files");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSidebar]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-0.5 px-2 pb-2">
        {(
          [
            ["files", Files, t("editor.files"), "⇧⌘E"],
            ["search", Search, t("editor.search"), "⇧⌘F"],
          ] as const
        ).map(([value, Icon, label, keys]) => (
          <button
            key={value}
            type="button"
            aria-pressed={sidebar === value}
            title={`${label} ${keys}`}
            onClick={() => setSidebar(value)}
            className={cn(
              "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-[12.5px] text-muted-foreground hover:text-foreground",
              sidebar === value && "bg-white/[0.07] text-foreground",
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            {label}
          </button>
        ))}
      </div>
      {sidebar === "search" ? (
        <SearchPanel repoPath={repoPath} />
      ) : (
        <>
          <ConflictsSection repoPath={repoPath} />
          <div className="px-2 pb-1.5">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("editor.filterFiles")}
              aria-label={t("editor.filterFiles")}
              className="h-7 w-full rounded-md border border-white/10 bg-white/[0.03] px-2 text-[12.5px] outline-none placeholder:text-muted-foreground focus:border-primary/60"
            />
          </div>
          <div className="min-h-0 flex-1">
            <FileTree repoPath={repoPath} query={filter} />
          </div>
        </>
      )}
    </div>
  );
}
