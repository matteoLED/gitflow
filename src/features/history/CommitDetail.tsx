import { Suspense } from "react";
import { GitCommitHorizontal } from "lucide-react";
import { EmptyState } from "@/components/states";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useShallow } from "zustand/react/shallow";
import { PanelLoading } from "@/components/layout/panel";
import { ChangedFilesPanel } from "@/features/changed-files/ChangedFilesPanel";
import { CollapseAllButton, DiffPanel } from "@/features/diff/DiffPanel";
import { ViewOptions } from "@/features/diff/ViewOptions";
import { isGenerated } from "@/features/diff/generated";
import { AgentButton } from "@/features/agents/AgentButton";
import { useViewSettings } from "@/stores/view-settings-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useCommitFiles } from "@/lib/git-queries";
import { useWorkspaceStore } from "@/stores/workspace-store";

/** The files panel's fixed parts (commit header, filter, summary line) and one file row, in px. */
const CHROME = 150;
const ROW = 24;
/** Remembered with the other folded panels (layout store): true once the user unfolds the file list. */
const FILES_OPEN = "history:files-open";

/** The diff's tools, in the commit's header above it: explain, view options, fold or unfold every file. */
function DiffTools({ repoPath }: { repoPath: string }) {
  const { hash, base, collapsed, setCollapsedDiffs } = useWorkspaceStore(
    useShallow((s) => ({
      hash: s.selectedCommitHash,
      base: s.compareBase,
      collapsed: s.collapsedDiffs,
      setCollapsedDiffs: s.setCollapsedDiffs,
    })),
  );
  const hideGenerated = useViewSettings((s) => s.hideGenerated);
  const files = useCommitFiles(repoPath, hash ?? "", base).data ?? [];
  const paths = (hideGenerated ? files.filter((f) => !isGenerated(f.path)) : files).map((f) => f.path);
  const allCollapsed = paths.length > 0 && paths.every((p) => collapsed.has(p));
  return (
    <>
      <AgentButton repoPath={repoPath} />
      <ViewOptions />
      <CollapseAllButton
        allCollapsed={allCollapsed}
        onClick={() => setCollapsedDiffs(allCollapsed ? new Set() : new Set(paths))}
      />
    </>
  );
}

/**
 * The picked commit, in one column: who and what at the top with its files (as tall as they need, up to a third),
 * the diff below. The commit list beside it keeps the width it needs to read.
 */
export function CommitDetail({ repoPath }: { repoPath: string }) {
  const { hash, base } = useWorkspaceStore(useShallow((s) => ({ hash: s.selectedCommitHash, base: s.compareBase })));
  // Same query as the panel: already cached, no second call.
  const t = useT();
  const count = useCommitFiles(repoPath, hash ?? "", base).data?.length ?? 4;
  // Folded by default: the diff lists every file already; unfold to filter or jump through a long list.
  const open = useLayoutStore((s) => !!s.collapsedLists[FILES_OPEN]);
  const toggle = useLayoutStore((s) => s.toggleList);
  if (!hash)
    return <EmptyState icon={<GitCommitHorizontal />} title={t("files.noCommit")} hint={t("files.noCommitHint")} />;
  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "relative shrink-0 border-b border-white/[0.06]",
          // Unfolded and scrolling: the list fades out at its foot instead of cutting a row in half.
          open &&
            "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-6 after:bg-linear-to-t after:from-panel after:to-transparent",
        )}
        style={{ height: open ? `min(40%, ${CHROME + count * ROW}px)` : undefined }}
      >
        <ChangedFilesPanel
          repoPath={repoPath}
          actions={<DiffTools repoPath={repoPath} />}
          fold={{ open, toggle: () => toggle(FILES_OPEN) }}
        />
      </div>
      <div className="min-h-0 flex-1">
        <Suspense fallback={<PanelLoading title="" />}>
          <DiffPanel repoPath={repoPath} embedded />
        </Suspense>
      </div>
    </div>
  );
}
