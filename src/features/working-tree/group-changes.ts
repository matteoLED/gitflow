import type { FileStatus, WorkingSide, WorkingTreeEntry } from "@/types/git";

export type ChangeItem = { path: string; previousPath: string | null; status: FileStatus; side: WorkingSide };

export type ChangeGroups = { conflicted: ChangeItem[]; staged: ChangeItem[]; unstaged: ChangeItem[] };

/** Splits `git status` entries into the lists shown in the Changes view. One file can be in both staged and unstaged. */
export function groupChanges(entries: WorkingTreeEntry[]): ChangeGroups {
  const groups: ChangeGroups = { conflicted: [], staged: [], unstaged: [] };
  for (const { path, previousPath, staged, unstaged, conflicted } of entries) {
    if (conflicted) {
      groups.conflicted.push({ path, previousPath, status: "unmerged", side: "unstaged" });
      continue;
    }
    if (staged) groups.staged.push({ path, previousPath, status: staged, side: "staged" });
    if (unstaged) {
      const side = unstaged === "untracked" ? "untracked" : "unstaged";
      groups.unstaged.push({ path, previousPath: null, status: unstaged, side });
    }
  }
  return groups;
}

/** Paths git needs to unstage a change: both sides of a staged rename. */
export function pathsOf(items: ChangeItem[]): string[] {
  return items.flatMap((item) => (item.previousPath ? [item.previousPath, item.path] : [item.path]));
}
