import { ask } from "@tauri-apps/plugin-dialog";
import { CircleCheck, GitMerge, TriangleAlert } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { useT } from "@/i18n";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { openInEditor } from "@/stores/editor-store";
import { useConflicts, useOperationAction } from "./use-conflicts";

const BUTTON =
  "h-6 rounded-md px-2.5 text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40";

/**
 * Shown on every page while a merge, rebase, cherry-pick or revert is stopped: where it stands, the way to the
 * conflicts, and the two ways out (continue once resolved, or abort back to where it started).
 */
export function OperationBar({ repoPath }: { repoPath: string }) {
  const t = useT();
  const { operation, conflicted } = useConflicts(repoPath);
  const action = useOperationAction(repoPath);
  if (!operation) return null;
  const left = conflicted.length;
  const title = t(`conflicts.${operation.kind}`, { branch: operation.branch ?? operation.theirs });
  const abort = async () => {
    const sure = await ask(t("conflicts.abortConfirm", { kind: operation.kind }), {
      kind: "warning",
      okLabel: t("conflicts.abort"),
    });
    if (sure) action.mutate(() => gitBackend.abortOperation(repoPath));
  };
  return (
    <div
      role="status"
      className={cn(
        "mx-1.5 mb-1.5 flex h-9 shrink-0 items-center gap-2.5 rounded-[10px] border px-3 text-[12.5px]",
        left > 0 ? "border-amber-400/25 bg-amber-400/[0.07]" : "border-added-foreground/25 bg-added-foreground/[0.07]",
      )}
    >
      {left > 0 ? (
        <TriangleAlert aria-hidden className="size-4 shrink-0 text-amber-300" />
      ) : (
        <CircleCheck aria-hidden className="size-4 shrink-0 text-added-foreground" />
      )}
      <GitMerge aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{title}</span>
      {operation.step && (
        <span className="shrink-0 text-muted-foreground">
          {t("conflicts.step", { n: operation.step[0], m: operation.step[1] })}
        </span>
      )}
      <span className={cn("shrink-0", left > 0 ? "text-amber-200" : "text-added-foreground")}>
        · {left > 0 ? t.plural("conflicts.count", left) : t("conflicts.none")}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {action.isPending && <BrailleLoader className="text-primary" />}
        {left > 0 && (
          <button
            type="button"
            onClick={() => openInEditor(repoPath, conflicted[0])}
            className={cn(BUTTON, "bg-white/[0.08] hover:bg-white/[0.12]")}
          >
            {t("conflicts.resolve")}
          </button>
        )}
        {operation.kind === "rebase" && (
          <button
            type="button"
            disabled={action.isPending}
            onClick={() => action.mutate(() => gitBackend.skipRebaseCommit(repoPath))}
            className={cn(BUTTON, "text-muted-foreground hover:bg-white/[0.08] hover:text-foreground")}
          >
            {t("conflicts.skip")}
          </button>
        )}
        <button
          type="button"
          disabled={action.isPending}
          onClick={() => void abort()}
          className={cn(BUTTON, "text-muted-foreground hover:bg-removed/20 hover:text-removed-foreground")}
        >
          {t("conflicts.abort")}
        </button>
        <button
          type="button"
          disabled={left > 0 || action.isPending}
          onClick={() => action.mutate(() => gitBackend.continueOperation(repoPath))}
          className={cn(BUTTON, "bg-primary text-primary-foreground hover:bg-primary/90")}
        >
          {t("conflicts.continue")}
        </button>
      </div>
    </div>
  );
}
