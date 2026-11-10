import { Check, MoreHorizontal, TriangleAlert } from "lucide-react";
import { FileIcon } from "@/components/file-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConflicts, useOperationAction } from "@/features/conflicts/use-conflicts";
import { useT } from "@/i18n";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { editorOf, useEditorStore } from "@/stores/editor-store";

/** Above the tree while files are conflicted: open one, take a whole side, or mark it resolved once edited. */
export function ConflictsSection({ repoPath }: { repoPath: string }) {
  const t = useT();
  const { operation, conflicted } = useConflicts(repoPath);
  const active = useEditorStore((s) => editorOf(s, repoPath).active);
  const action = useOperationAction(repoPath);
  if (!operation || conflicted.length === 0) return null;
  return (
    <section className="mx-1.5 mb-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-1">
      <h3 className="flex items-center gap-1.5 px-1.5 pt-0.5 pb-1 text-[11.5px] font-medium text-amber-200">
        <TriangleAlert aria-hidden className="size-3.5" />
        {t("conflicts.title")}
        <span className="text-amber-200/70">{conflicted.length}</span>
      </h3>
      <ul>
        {conflicted.map((path) => (
          <li key={path} className="group flex items-center">
            <button
              type="button"
              title={path}
              onClick={() => useEditorStore.getState().open(repoPath, path)}
              className={cn(
                "flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-[12.5px] hover:bg-white/[0.05]",
                path === active && "bg-white/[0.08]",
              )}
            >
              <FileIcon path={path} className="size-3.5 shrink-0" />
              <span className="truncate">{path.split("/").pop()}</span>
            </button>
            <button
              type="button"
              aria-label={t("conflicts.markResolved")}
              title={t("conflicts.markResolved")}
              onClick={() => action.mutate(() => gitBackend.stageFiles(repoPath, [path]))}
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-white/[0.08] hover:text-added-foreground"
            >
              <Check aria-hidden className="size-3.5" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t("common.more")}
                className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 outline-none group-hover:opacity-100 hover:bg-white/[0.08] data-[state=open]:opacity-100"
              >
                <MoreHorizontal aria-hidden className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem
                  onSelect={() => action.mutate(() => gitBackend.resolveWithSide(repoPath, [path], false))}
                >
                  {t("conflicts.ours")} · {operation.ours}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => action.mutate(() => gitBackend.resolveWithSide(repoPath, [path], true))}
                >
                  {t("conflicts.theirs")} · {operation.theirs}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => action.mutate(() => gitBackend.stageFiles(repoPath, [path]))}>
                  {t("conflicts.markResolved")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
    </section>
  );
}
