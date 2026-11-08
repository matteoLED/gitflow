import { useEffect } from "react";
import { FileDiff as FileDiffIcon, FileWarning, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PanelHeader, PanelMessage } from "@/components/layout/panel";
import { useCommitDiff, useCommitFiles } from "@/lib/git-queries";
import { useInView } from "@/lib/use-in-view";
import { revealInContainer } from "@/lib/reveal";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { ChangedFile } from "@/types/git";
import { useViewSettings } from "@/stores/view-settings-store";
import { DiffBody, DiffCard } from "./DiffCard";
import { isGenerated } from "./generated";
import { ViewOptions } from "./ViewOptions";
import { useT } from "@/i18n";

const cardId = (path: string) => `diff-${path}`;

type CommitDiffCardProps = {
  repoPath: string;
  hash: string;
  file: ChangedFile;
  highlighted: boolean;
  open: boolean;
  onToggle: () => void;
};

/** Loads its diff only once scrolled near the viewport, so huge commits stay responsive. */
function CommitDiffCard({ repoPath, hash, file, highlighted, open, onToggle }: CommitDiffCardProps) {
  const [ref, inView] = useInView<HTMLElement>();
  const diff = useCommitDiff(repoPath, hash, file.path, file.previousPath, open && (inView || highlighted));
  return (
    <DiffCard
      file={file}
      open={open}
      onToggle={onToggle}
      highlighted={highlighted}
      cardRef={ref}
      id={cardId(file.path)}
    >
      <DiffBody path={file.path} diff={diff.data} error={diff.error} loading={diff.isPending} />
    </DiffCard>
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

function CommitDiffs({ repoPath, hash }: { repoPath: string; hash: string }) {
  const t = useT();
  const { selectedFilePath, collapsedDiffs: collapsed, toggleDiff, setCollapsedDiffs } = useWorkspaceStore();
  const hideGenerated = useViewSettings((s) => s.hideGenerated);
  const files = useCommitFiles(repoPath, hash);

  useEffect(() => {
    if (selectedFilePath) revealInContainer(cardId(selectedFilePath), "start");
  }, [selectedFilePath]);

  if (!files.data) return <PanelMessage title={files.isError ? t("diff.loadFilesError") : t("common.loading")} />;
  const visible = hideGenerated ? files.data.filter((f) => !isGenerated(f.path)) : files.data;
  const hiddenCount = files.data.length - visible.length;
  const paths = visible.map((f) => f.path);
  const allCollapsed = paths.length > 0 && paths.every((p) => collapsed.has(p));

  return (
    <>
      <PanelHeader className="justify-end gap-1">
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
              key={`${hash}:${file.path}`}
              repoPath={repoPath}
              hash={hash}
              file={file}
              highlighted={file.path === selectedFilePath}
              open={!collapsed.has(file.path)}
              onToggle={() => toggleDiff(file.path)}
            />
          ))}
          {hiddenCount > 0 && (
            <p className="py-2 text-center text-[11px] text-muted-foreground">
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
  const hash = useWorkspaceStore((s) => s.selectedCommitHash);
  return (
    <section aria-label={t("diff.panel")} className="flex h-full flex-col">
      {hash ? (
        <CommitDiffs key={hash} repoPath={repoPath} hash={hash} />
      ) : (
        <PanelMessage icon={<FileDiffIcon />} title={t("diff.nothing")} hint={t("diff.nothingHint")} />
      )}
    </section>
  );
}
