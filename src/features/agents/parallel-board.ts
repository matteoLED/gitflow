import type { AgentRun, RunStatus } from "@/stores/agents-store";
import type { AgentKind, FileStatus, Worktree } from "@/types/git";

/** One file of a multi-file `git diff`: its own patch, ready for `DiffBody`. */
export type PatchFile = {
  path: string;
  previousPath: string | null;
  status: FileStatus;
  binary: boolean;
  additions: number;
  deletions: number;
  patch: string;
};

const HEADER = "diff --git ";

/** `a/x` or `b/x` → `x`; `/dev/null` → null. Git appends a tab to names with spaces. */
function stripSide(name: string | null): string | null {
  if (!name) return null;
  const clean = name.replace(/\t$/, "");
  return clean === "/dev/null" ? null : clean.replace(/^[ab]\//, "");
}

/** `diff --git a/P b/P` → `P` (only exact when both sides match, i.e. no rename: those have `rename to`). */
function headerPath(line: string): string {
  const rest = line.slice(HEADER.length);
  return rest.slice(2, 2 + (rest.length - 5) / 2);
}

function parseFile(chunk: string): PatchFile {
  const lines = chunk.split("\n");
  const firstHunk = lines.findIndex((l) => l.startsWith("@@"));
  const header = firstHunk === -1 ? lines : lines.slice(0, firstHunk);
  const body = firstHunk === -1 ? [] : lines.slice(firstHunk);
  const field = (prefix: string) => header.find((l) => l.startsWith(prefix))?.slice(prefix.length) ?? null;
  const renamedFrom = field("rename from ");
  const path = field("rename to ") ?? stripSide(field("+++ ")) ?? stripSide(field("--- ")) ?? headerPath(lines[0]);
  const status: FileStatus = renamedFrom
    ? "renamed"
    : field("new file mode ") !== null
      ? "added"
      : field("deleted file mode ") !== null
        ? "deleted"
        : "modified";
  return {
    path,
    previousPath: renamedFrom,
    status,
    binary: header.some((l) => l.startsWith("Binary files ") || l === "GIT binary patch"),
    additions: body.filter((l) => l.startsWith("+")).length,
    deletions: body.filter((l) => l.startsWith("-")).length,
    patch: chunk,
  };
}

/** Splits `git diff` output covering many files into one entry per file. */
export function splitPatch(text: string): PatchFile[] {
  return text
    .split(/^(?=diff --git )/m)
    .filter((chunk) => chunk.startsWith(HEADER))
    .map(parseFile);
}

export type BoardRow = {
  /** The conversation's first run: it holds the worktree, title, agent and group. */
  run: AgentRun;
  worktree: Worktree;
  /** Status of the conversation's latest run. */
  status: RunStatus;
  lastActivity: string;
};

/**
 * Isolated conversations of a repository, newest first, with runs launched together (same `group`) kept
 * adjacent so they read side by side. `runs` is the store's list, newest first.
 */
export function boardRows(runs: AgentRun[], repoPath: string): BoardRow[] {
  const rows = runs.flatMap((run): BoardRow[] => {
    if (run.repoPath !== repoPath || run.thread !== run.id || !run.worktree) return [];
    const latest = runs.find((r) => r.thread === run.id) ?? run;
    const stepAt = [...latest.steps].reverse().find((s) => s.at)?.at;
    return [{ run, worktree: run.worktree, status: latest.status, lastActivity: stepAt ?? latest.startedAt }];
  });
  const firstIndex = new Map<string, number>();
  rows.forEach((row, i) => {
    const key = row.run.group ?? row.run.id;
    if (!firstIndex.has(key)) firstIndex.set(key, i);
  });
  const rank = (row: BoardRow) => firstIndex.get(row.run.group ?? row.run.id) ?? 0;
  return [...rows].sort((a, b) => rank(a) - rank(b)); // stable: members keep their order
}

export type FileCounts = { additions: number; deletions: number };
export type ComparedFile = { path: string; a: FileCounts | null; b: FileCounts | null };

/** Files touched by either side, with each side's line counts (null: that side didn't touch it). */
export function compareTouched(a: PatchFile[], b: PatchFile[]): ComparedFile[] {
  const counts = (files: PatchFile[], path: string) => {
    const file = files.find((f) => f.path === path);
    return file ? { additions: file.additions, deletions: file.deletions } : null;
  };
  const paths = [...new Set([...a, ...b].map((f) => f.path))].sort();
  return paths.map((path) => ({ path, a: counts(a, path), b: counts(b, path) }));
}

/** Sum of the line counts of a diff. */
export const totals = (files: PatchFile[]): FileCounts => ({
  additions: files.reduce((n, f) => n + f.additions, 0),
  deletions: files.reduce((n, f) => n + f.deletions, 0),
});

/** How many agents a new task runs on: one, Claude and Codex, or the preferred agent twice. */
export type FanOut = "off" | "mixed" | "twice";

export function fanOutAgents(fanOut: FanOut, preferred: AgentKind): AgentKind[] {
  if (fanOut === "mixed") return ["claude", "codex"];
  return fanOut === "twice" ? [preferred, preferred] : [preferred];
}
