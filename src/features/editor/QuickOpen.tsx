import { useMemo, useState } from "react";
import { FileIcon } from "@/components/file-icon";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { editorOf, useEditorStore } from "@/stores/editor-store";
import { useRepoFiles } from "./EditorPage";
import { fuzzyFilter } from "./fuzzy";

/** ⌘P: type a few letters of a file, Enter opens it. Empty, it lists the open tabs. */
export function QuickOpen({
  repoPath,
  open,
  onOpenChange,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="top-[18%] translate-y-0 gap-0 overflow-hidden rounded-xl border-white/10 p-0 shadow-2xl sm:max-w-[620px]"
      >
        <DialogTitle className="sr-only">{t("editor.quickOpen")}</DialogTitle>
        {open && <Picker repoPath={repoPath} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function Picker({ repoPath, onDone }: { repoPath: string; onDone: () => void }) {
  const t = useT();
  const files = useRepoFiles(repoPath).data;
  const tabs = useEditorStore((s) => editorOf(s, repoPath).tabs);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const results = useMemo(
    () => (query.trim() ? fuzzyFilter(query, files ?? []) : [...tabs].reverse()),
    [files, query, tabs],
  );
  const pick = (path: string | undefined) => {
    if (!path) return;
    useEditorStore.getState().open(repoPath, path);
    onDone();
  };
  return (
    <>
      <input
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setIndex((i) => Math.min(i + 1, results.length - 1));
          else if (e.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
          else if (e.key === "Enter") pick(results[index]);
          else return;
          e.preventDefault();
        }}
        placeholder={t("editor.quickOpenPlaceholder")}
        aria-label={t("editor.quickOpen")}
        className="h-12 w-full border-b border-white/[0.07] bg-transparent px-4 text-[14px] outline-none placeholder:text-muted-foreground"
      />
      <ul role="listbox" className="max-h-[420px] overflow-y-auto p-1.5">
        {results.length === 0 && (
          <li className="py-8 text-center text-[13px] text-muted-foreground">{t("palette.empty")}</li>
        )}
        {results.map((path, i) => {
          const slash = path.lastIndexOf("/");
          return (
            <li
              key={path}
              role="option"
              aria-selected={i === index}
              onMouseMove={() => setIndex(i)}
              onClick={() => pick(path)}
              className={cn(
                "flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 text-[13px]",
                i === index && "bg-white/[0.07]",
              )}
            >
              <FileIcon path={path} className="size-3.5 shrink-0" />
              <span className="shrink-0">{path.slice(slash + 1)}</span>
              <span className="min-w-0 truncate text-[12px] text-muted-foreground">
                {path.slice(0, Math.max(slash, 0))}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
