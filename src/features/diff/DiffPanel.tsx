import { useShallow } from "zustand/react/shallow";
import { DataUnavailable } from "@/components/states";
import { useCallback, useEffect, useState } from "react";
import { FileDiff as FileDiffIcon, FileWarning, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PanelHeader, PanelLoading, PanelMessage } from "@/components/layout/panel";
import { useCommitDiff, useCommitFiles } from "@/lib/git-queries";
import { useInView, useNearViewport } from "@/lib/use-in-view";
import { revealInContainer } from "@/lib/reveal";
import { useWorkspaceStore, type ActivePullRequest } from "@/stores/workspace-store";
import { reviewKey, useReviewStore } from "@/stores/review-store";
import type { ChangedFile } from "@/types/git";
import { useViewSettings } from "@/stores/view-settings-store";
import { DiffBody, DiffCard } from "./DiffCard";
import { FileCommentCount, LineCommentsProvider } from "./LineComments";
import { isGenerated } from "./generated";
import { ViewOptions } from "./ViewOptions";
import { FileActions } from "./FileActions";
import { AgentButton } from "@/features/agents/AgentButton";
import { ReviewButton } from "@/features/github/ReviewButton";
import { useT } from "@/i18n";

const cardId = (path: string) => `diff-${path}`;

type CommitDiffCardProps = {
  repoPath: string;
  hash: string;
  base: string | null;
  file: ChangedFile;
  highlighted: boolean;
  open: boolean;
  onToggle: () => void;
};

/** Loads its diff only once scrolled near the viewport, so huge commits stay responsive. */
function CommitDiffCard({ repoPath, hash, base, file, highlighted, open, onToggle }: CommitDiffCardProps) {
  const [ref, inView] = useInView<HTMLElement>();
  // Far off-screen, a seen diff is swapped for an empty block of its height: big PRs keep a small DOM.
  const [placeRef, place] = useNearViewport<HTMLDivElement>();
  const rendered = place.near || highlighted;
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((e) => !e), []);
  const diff = useCommitDiff(repoPath, hash, file.path, file.previousPath, open && (inView || highlighted), base);
  // Lines take comments only on the pull request's own diff, the one GitHub anchors them to.
  const pr = useWorkspaceStore((s) => (s.pullRequest?.head === hash ? s.pullRequest : null));
  const body = (
    <div ref={placeRef}>
      {rendered ? (
        <DiffBody
          path={file.path}
          diff={diff.data}
          error={diff.error}
          loading={diff.isPending}
          expandAll={expanded}
          image={{ repoPath, hash, base, status: file.status }}
        />
      ) : (
        <div style={{ height: place.height }} />
      )}
    </div>
  );
  return (
    <DiffCard
      file={file}
      open={open}
      onToggle={onToggle}
      highlighted={highlighted}
      cardRef={ref}
      id={cardId(file.path)}
      actions={
        <>
          {pr && <FileCommentCount repoPath={repoPath} number={pr.number} path={file.path} />}
          <FileActions
            repoPath={repoPath}
            hash={hash}
            base={base}
            file={file}
            open={open}
            onToggleOpen={onToggle}
            expanded={expanded}
            onToggleExpanded={toggleExpanded}
            selected={highlighted}
          />
        </>
      }
    >
      {pr ? (
        <LineCommentsProvider repoPath={repoPath} pr={pr} path={file.path}>
          {body}
        </LineCommentsProvider>
      ) : (
        body
      )}
    </DiffCard>
  );
}

function ReviewProgress({ pr, paths }: { pr: ActivePullRequest; paths: string[] }) {
  const t = useT();
  const reviewed = useReviewStore((s) => paths.filter((p) => s.reviewed[reviewKey(pr.number, pr.head, p)]).length);
  return (
    <span className="mr-1 text-[12px] text-muted-foreground tabular-nums">
      {t("review.progress", { count: reviewed, total: paths.length })}
    </span>
  );
}

function CollapseAllButton({ allCollapsed, onClick }: { allCollapsed: boolean; onClick: () => void }) {
  const t = useT();
  const label = allCollapsed ? t("diff.expandAll") : t("diff.collapseAll");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} className="text-muted-foreground">
          {allCollapsed ? <Maximize2 /> : <Minimize2 />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function CommitDiffs({ repoPath, hash, base }: { repoPath: string; hash: string; base: string | null }) {
  const t = useT();
  const {
    selectedFilePath,
    pullRequest,
    collapsedDiffs: collapsed,
    toggleDiff,
    setCollapsedDiffs,
  } = useWorkspaceStore(
    useShallow((s) => ({
      selectedFilePath: s.selectedFilePath,
      pullRequest: s.pullRequest,
      collapsedDiffs: s.collapsedDiffs,
      toggleDiff: s.toggleDiff,
      setCollapsedDiffs: s.setCollapsedDiffs,
    })),
  );
  const hideGenerated = useViewSettings((s) => s.hideGenerated);
  const files = useCommitFiles(repoPath, hash, base);

  useEffect(() => {
    if (selectedFilePath) revealInContainer(cardId(selectedFilePath), "start");
  }, [selectedFilePath]);

  if (files.isError)
    return (
      <DataUnavailable title={t("diff.loadFilesError")} error={files.error} onRetry={() => void files.refetch()} />
    );
  if (!files.data) return <PanelLoading title={t("common.loading")} variant="grid-diagonal" />;
  const visible = hideGenerated ? files.data.filter((f) => !isGenerated(f.path)) : files.data;
  const hiddenCount = files.data.length - visible.length;
  const paths = visible.map((f) => f.path);
  const allCollapsed = paths.length > 0 && paths.every((p) => collapsed.has(p));

  return (
    <>
      <PanelHeader className="justify-end gap-1">
        {pullRequest && <ReviewButton repoPath={repoPath} pr={pullRequest} />}
        {pullRequest && <ReviewProgress pr={pullRequest} paths={paths} />}
        <AgentButton repoPath={repoPath} />
        <ViewOptions />
        <CollapseAllButton
          allCollapsed={allCollapsed}
          onClick={() => setCollapsedDiffs(allCollapsed ? new Set() : new Set(paths))}
        />
      </PanelHeader>
      {visible.length === 0 ? (
        <PanelMessage icon={<FileWarning />} title={t("diff.noChanges")} />
      ) : (
        <div
          data-scroll-container
          className="min-h-0 flex-1 space-y-2.5 overflow-y-auto scroll-smooth px-2.5 pt-1 pb-3 motion-reduce:scroll-auto"
        >
          {visible.map((file) => (
            <CommitDiffCard
              key={`${hash}:${base}:${file.path}`}
              repoPath={repoPath}
              hash={hash}
              base={base}
              file={file}
              highlighted={file.path === selectedFilePath}
              open={!collapsed.has(file.path)}
              onToggle={() => toggleDiff(file.path)}
            />
          ))}
          {hiddenCount > 0 && (
            <p className="py-2 text-center text-[12px] text-muted-foreground">
              {t.plural("diff.generatedHidden", hiddenCount)}
            </p>
          )}
        </div>
      )}
    </>
  );
}

export function DiffPanel({ repoPath }: { repoPath: string }) {
  const t = useT();
  const { selectedCommitHash: hash, compareBase: base } = useWorkspaceStore(
    useShallow((s) => ({ selectedCommitHash: s.selectedCommitHash, compareBase: s.compareBase })),
  );
  return (
    <section aria-label={t("diff.panel")} className="flex h-full flex-col">
      {hash ? (
        <CommitDiffs key={`${hash}:${base}`} repoPath={repoPath} hash={hash} base={base} />
      ) : (
        <PanelMessage icon={<FileDiffIcon />} title={t("diff.nothing")} hint={t("diff.nothingHint")} />
      )}
    </section>
  );
}
