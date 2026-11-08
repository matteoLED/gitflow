import type { DiffLine } from "@/types/git";

export type SplitRow = { left: DiffLine | null; right: DiffLine | null };

/** Side-by-side rows: unchanged lines on both sides, each removed/added run paired line by line. */
export function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      rows.push({ left: removed[i] ?? null, right: added[i] ?? null });
    }
    removed = [];
    added = [];
  };
  for (const line of lines) {
    if (line.kind === "removed") {
      if (added.length) flush(); // a removal after additions starts a new change run
      removed.push(line);
    } else if (line.kind === "added") added.push(line);
    else {
      flush();
      rows.push({ left: line, right: line });
    }
  }
  flush();
  return rows;
}
