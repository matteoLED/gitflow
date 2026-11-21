import { useShallow } from "zustand/react/shallow";
import { ChangedFilesPanel } from "@/features/changed-files/ChangedFilesPanel";
import { useCommits } from "@/lib/git-queries";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { CommitList } from "./CommitList";
import { useHistorySearchStore } from "./history-search-store";

/** The commit list's fixed parts (header, search, "All changes") and one row, in px: see CommitList. */
const CHROME = 175;
const ROW = 32;

/**
 * Reviewing a pull request, one column to find your way: its commits (and "All changes") above, the files of the
 * one picked below. The commits take the room they need, up to 40% of the column; the files get the rest.
 */
export function ReviewNavigator({ repoPath }: { repoPath: string }) {
  const { historyRev } = useWorkspaceStore(useShallow((s) => ({ historyRev: s.historyRev })));
  const search = useHistorySearchStore((s) => s.search);
  // Same query as the list itself: already cached, no second call.
  const count = useCommits(repoPath, historyRev, search).data?.pages.flat().length ?? 3;
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-white/[0.06]" style={{ height: `min(40%, ${CHROME + count * ROW}px)` }}>
        <CommitList repoPath={repoPath} />
      </div>
      <div className="min-h-0 flex-1">
        <ChangedFilesPanel repoPath={repoPath} header={false} />
      </div>
    </div>
  );
}
