import type { DiffHunk, DiffLine } from "@/types/git";

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

type Cursor = { oldLine: number; newLine: number };

function toDiffLine(raw: string, cursor: Cursor): DiffLine | null {
  const content = raw.slice(1);
  switch (raw[0]) {
    case "+":
      return { kind: "added", oldLine: null, newLine: cursor.newLine++, content };
    case "-":
      return { kind: "removed", oldLine: cursor.oldLine++, newLine: null, content };
    case " ":
      return { kind: "context", oldLine: cursor.oldLine++, newLine: cursor.newLine++, content };
    default:
      return null; // "\ No newline at end of file", trailing blank line
  }
}

/** Parses the hunks of a single-file unified diff (`git diff`/`git show` output). */
export function parseUnifiedDiff(text: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const cursor: Cursor = { oldLine: 1, newLine: 1 };
  for (const raw of text.split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      const newStart = Number(header[2]);
      hunks.push({ hiddenBefore: Math.max(0, newStart - cursor.newLine), lines: [] });
      cursor.oldLine = Number(header[1]);
      cursor.newLine = newStart;
      continue;
    }
    const line = hunks.length > 0 ? toDiffLine(raw, cursor) : null;
    if (line) hunks[hunks.length - 1].lines.push(line);
  }
  return hunks;
}
