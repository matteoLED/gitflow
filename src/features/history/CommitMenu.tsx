import type { ReactNode } from "react";
import { GitCommitVertical, ListOrdered, ArrowDownToDot, Undo2 } from "lucide-react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useT } from "@/i18n";
import type { CommitSummary } from "@/types/git";

/** What the history list can do with a commit; an absent action isn't offered. */
export type CommitActions = {
  /** Only for commits shown from another branch: on the current one they're already there. */
  cherryPick?: (commit: CommitSummary) => void;
  revert: (commit: CommitSummary) => void;
  /** Only when viewing the current branch. */
  rebaseFrom?: (commit: CommitSummary) => void;
  /** Only when viewing the current branch. */
  fixup?: (commit: CommitSummary) => void;
  busy: boolean;
};

const ITEM = "text-[12.5px]";

/** Right-click menu of a commit row. Merge commits can't be cherry-picked, reverted, rebased from or fixed up here. */
export function CommitMenu({
  commit,
  actions,
  children,
}: {
  commit: CommitSummary;
  actions: CommitActions;
  children: ReactNode;
}) {
  const t = useT();
  const { cherryPick, revert, rebaseFrom, fixup, busy } = actions;
  const merge = commit.parents.length > 1;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-56">
        {cherryPick && (
          <ContextMenuItem className={ITEM} disabled={busy || merge} onSelect={() => cherryPick(commit)}>
            <GitCommitVertical />
            {t("rewrite.cherryPick")}
          </ContextMenuItem>
        )}
        <ContextMenuItem className={ITEM} disabled={busy || merge} onSelect={() => revert(commit)}>
          <Undo2 />
          {t("rewrite.revert")}
        </ContextMenuItem>
        {rebaseFrom && (
          <ContextMenuItem className={ITEM} disabled={busy || merge} onSelect={() => rebaseFrom(commit)}>
            <ListOrdered />
            {t("rewrite.rebaseFromHere")}
          </ContextMenuItem>
        )}
        {fixup && (
          <ContextMenuItem className={ITEM} disabled={busy || merge} onSelect={() => fixup(commit)}>
            <ArrowDownToDot />
            {t("rewrite.fixup")}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
