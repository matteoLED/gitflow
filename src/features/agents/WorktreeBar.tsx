import { Copy, GitBranchPlus, GitMerge, GitPullRequestArrow, Trash2 } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { useT } from "@/i18n";
import type { Worktree } from "@/types/git";
import { useWorktreeActions } from "./use-worktree-actions";

const BUTTON =
  "flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40";

/**
 * A conversation isolated in its own worktree: its branch, what the agent changed there, and the two ways out
 * (merge it into the current branch, or throw it away).
 */
export function WorktreeBar({
  repoPath,
  worktree,
  title,
  running,
}: {
  repoPath: string;
  worktree: Worktree;
  title: string;
  running: boolean;
}) {
  const t = useT();
  const { status, current, changes, busy, merge, publish, remove } = useWorktreeActions(
    repoPath,
    worktree,
    title,
    running,
  );
  // Removed (here or by hand): nothing left to act on.
  if (status.isError) return null;
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-primary/[0.05] px-4 text-[12.5px]">
      <GitBranchPlus aria-hidden className="size-3.5 shrink-0 text-primary" />
      <span className="shrink-0 text-muted-foreground">{t("worktree.isolated")}</span>
      <code className="truncate rounded bg-white/[0.06] px-1.5 font-mono text-[11.5px]">{worktree.branch}</code>
      <button
        type="button"
        aria-label={t("worktree.copyPath")}
        title={worktree.path}
        onClick={() => void navigator.clipboard.writeText(worktree.path)}
        className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
      >
        <Copy aria-hidden className="size-3" />
      </button>
      {status.data && (
        <span className="shrink-0 text-muted-foreground">
          ·{" "}
          {changes === 0
            ? t("worktree.noChanges")
            : [
                status.data.changed > 0 && t.plural("worktree.changed", status.data.changed),
                status.data.ahead > 0 && t.plural("worktree.commits", status.data.ahead),
              ]
                .filter(Boolean)
                .join(" · ")}
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {busy && <BrailleLoader className="text-primary" />}
        <button
          type="button"
          disabled={running || changes === 0 || busy || !current}
          title={running ? t("worktree.waitAgent") : undefined}
          onClick={publish}
          className={`${BUTTON} text-foreground hover:bg-white/[0.08]`}
        >
          <GitPullRequestArrow aria-hidden className="size-3.5" />
          {current ? t("worktree.prInto", { branch: current }) : t("worktree.pr")}
        </button>
        <button
          type="button"
          disabled={running || changes === 0 || busy}
          title={running ? t("worktree.waitAgent") : undefined}
          onClick={merge}
          className={`${BUTTON} bg-primary text-primary-foreground hover:bg-primary/90`}
        >
          <GitMerge aria-hidden className="size-3.5" />
          {current ? t("worktree.mergeInto", { branch: current }) : t("worktree.merge")}
        </button>
        <button
          type="button"
          disabled={running || busy}
          onClick={() => void remove()}
          className={`${BUTTON} text-muted-foreground hover:bg-removed/20 hover:text-removed-foreground`}
        >
          <Trash2 aria-hidden className="size-3.5" />
          {t("worktree.remove")}
        </button>
      </div>
    </div>
  );
}
