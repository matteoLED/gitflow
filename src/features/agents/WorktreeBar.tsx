import { Copy, GitBranchPlus, GitMerge, GitPullRequestArrow, Trash2 } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { useT } from "@/i18n";
import { usePullRequests } from "@/lib/git-queries";
import type { Worktree } from "@/types/git";
import { BranchPullRequest } from "./BranchPullRequest";
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
  // A CI fix's pull request goes into the branch it fixes; anything else into the checked-out branch.
  const into = worktree.target ?? current;
  const hasPr = !!usePullRequests(repoPath).data?.some((p) => p.headRefName === worktree.branch);
  const branch = (
    <>
      <GitBranchPlus aria-hidden className="size-3.5 shrink-0 text-primary" />
      {/* The branch can be long (Linear's names): it gives way first, the full name in its tooltip. */}
      <code
        title={worktree.branch}
        className="min-w-0 truncate rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11.5px] text-foreground/90"
      >
        {worktree.branch}
      </code>
    </>
  );
  // Removed (merged, published, or by hand): nothing left to act on, only the pull request it became.
  if (status.isError)
    return !hasPr ? null : (
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] px-4 text-[12.5px]">
        {branch}
        <span className="ml-auto" />
        <BranchPullRequest repoPath={repoPath} branch={worktree.branch} />
      </div>
    );
  const wait = running ? t("worktree.waitAgent") : undefined;
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] px-4 text-[12.5px]">
      {branch}
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
        <BranchPullRequest repoPath={repoPath} branch={worktree.branch} />
        <button
          type="button"
          disabled={running || changes === 0 || busy}
          title={wait ?? (current ? t("worktree.mergeInto", { branch: current }) : undefined)}
          onClick={merge}
          className={`${BUTTON} text-muted-foreground hover:bg-white/[0.08] hover:text-foreground`}
        >
          <GitMerge aria-hidden className="size-3.5" />
          {t("worktree.merge")}
        </button>
        <button
          type="button"
          disabled={running || changes === 0 || busy || !into}
          title={wait ?? (into ? t("worktree.prInto", { branch: into }) : undefined)}
          onClick={publish}
          className={`${BUTTON} bg-primary text-primary-foreground hover:bg-primary/90`}
        >
          <GitPullRequestArrow aria-hidden className="size-3.5" />
          {t("worktree.pr")}
        </button>
        <button
          type="button"
          aria-label={t("worktree.remove")}
          title={t("worktree.remove")}
          disabled={running || busy}
          onClick={() => void remove()}
          className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-removed/20 hover:text-removed-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          <Trash2 aria-hidden className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
