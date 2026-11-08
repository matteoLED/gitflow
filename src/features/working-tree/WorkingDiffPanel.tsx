import { useState } from "react";
import { FileDiff as FileDiffIcon } from "lucide-react";
import { PanelHeader, PanelMessage } from "@/components/layout/panel";
import { useWorkingDiff, useWorkingTree } from "@/lib/git-queries";
import { useWorkspaceStore, type SelectedChange } from "@/stores/workspace-store";
import { DiffBody, DiffCard } from "@/features/diff/DiffCard";
import { ViewOptions } from "@/features/diff/ViewOptions";
import { groupChanges } from "./group-changes";
import { useT, type MessageKey } from "@/i18n";

const SIDE_LABEL = {
  staged: "changes.sideStaged",
  unstaged: "changes.sideUnstaged",
  untracked: "changes.sideUntracked",
} as const satisfies Record<string, MessageKey>;

function WorkingDiff({ repoPath, change }: { repoPath: string; change: SelectedChange }) {
  const t = useT();
  const diff = useWorkingDiff(repoPath, change.path, change.previousPath, change.side);
  const [open, setOpen] = useState(true);
  const status = change.side === "untracked" ? "untracked" : change.previousPath ? "renamed" : "modified";
  return (
    <>
      <PanelHeader>
        <p data-tauri-drag-region className="text-xs text-muted-foreground">
          {t(SIDE_LABEL[change.side])}
        </p>
        <span className="ml-auto">
          <ViewOptions />
        </span>
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-1 pb-3">
        <DiffCard file={{ ...change, status }} open={open} onToggle={() => setOpen(!open)}>
          <DiffBody path={change.path} diff={diff.data} error={diff.error} loading={diff.isPending} />
        </DiffCard>
      </div>
    </>
  );
}

export function WorkingDiffPanel({ repoPath }: { repoPath: string }) {
  const t = useT();
  const selected = useWorkspaceStore((s) => s.selectedChange);
  const tree = useWorkingTree(repoPath).data ?? [];
  // A file that was just staged/committed leaves its list: don't keep showing a stale diff.
  const groups = groupChanges(tree);
  const stillListed = [...groups.conflicted, ...groups.staged, ...groups.unstaged].some(
    (item) => item.path === selected?.path && item.side === selected.side,
  );
  const change = stillListed ? selected : null;
  return (
    <section aria-label={t("diff.panel")} className="flex h-full flex-col">
      {change ? (
        <WorkingDiff key={`${change.side}:${change.path}`} repoPath={repoPath} change={change} />
      ) : (
        <PanelMessage icon={<FileDiffIcon />} title={t("changes.noFile")} hint={t("changes.noFileHint")} />
      )}
    </section>
  );
}
