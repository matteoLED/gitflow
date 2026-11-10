import type { DiffLine } from "@/types/git";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

type Hunk = { oldStart: number; newStart: number; lines: string[] };

/** Rewrites one changed line for a patch holding only the selected lines; null drops it. */
function keep(raw: string, selected: boolean, reverse: boolean): string | null {
  if (raw[0] === " " || selected) return raw;
  // An unpicked line stays as it is on the side the patch applies to: old side forward, new side in reverse.
  const onTargetSide = reverse ? raw[0] === "+" : raw[0] === "-";
  return onTargetSide ? ` ${raw.slice(1)}` : null;
}

function header(hunk: Hunk, lines: string[], delta: number, reverse: boolean): string {
  const count = (sign: string) => lines.filter((l) => l[0] === " " || l[0] === sign).length;
  const oldCount = count("-");
  const newCount = count("+");
  // The side the patch applies to keeps its original position; the other one shifts by earlier hunks' changes.
  let oldStart = hunk.oldStart;
  let newStart = hunk.newStart;
  if (reverse) oldStart = (newCount === 0 ? newStart + 1 : newStart) - delta - (oldCount === 0 ? 1 : 0);
  else newStart = (oldCount === 0 ? oldStart + 1 : oldStart) + delta - (newCount === 0 ? 1 : 0);
  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
}

function parseHunks(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  for (const raw of patch.split("\n")) {
    const match = HUNK_HEADER.exec(raw);
    if (match) hunks.push({ oldStart: Number(match[1]), newStart: Number(match[3]), lines: [] });
    else if (hunks.length > 0 && /^[ +\-\\]/.test(raw)) hunks[hunks.length - 1].lines.push(raw);
  }
  return hunks;
}

/** Thrown when the selection would misplace a "\ No newline at end of file" marker (git would join two lines). */
export class EndOfFileSelectionError extends Error {}

/** A marker may only end the hunk, or follow a "-" line that only "+" lines come after (the old side's end). */
function markersInPlace(lines: string[]): boolean {
  return lines.every((line, i) => {
    if (line[0] !== "\\" || i === lines.length - 1) return true;
    const after = lines.slice(i + 1).filter((l) => l[0] !== "\\");
    return lines[i - 1]?.[0] === "-" && after.every((l) => l[0] === "+");
  });
}

/** New and deleted files apply as whole files: a partial patch can't add or remove the file itself. */
export function supportsLineStaging(patch: string): boolean {
  return !/^(new|deleted) file mode /m.test(patch);
}

/**
 * Hunks of a single-file unified diff reduced to the selected changed lines, for `git apply`.
 * `selected` holds indexes into the diff's lines as `parseUnifiedDiff` numbers them (context included).
 * `reverse` builds a patch meant for `git apply --reverse` (unstage, discard). Null when nothing is selected.
 * Throws `EndOfFileSelectionError` when the end of a file without a final newline must be selected too.
 */
export function buildPartialPatch(patch: string, selected: ReadonlySet<number>, reverse: boolean): string | null {
  let index = 0;
  let delta = 0;
  const out: string[] = [];
  for (const hunk of parseHunks(patch)) {
    const lines: string[] = [];
    let picked = false;
    let lastKept = false;
    for (const raw of hunk.lines) {
      if (raw[0] === "\\") {
        if (lastKept) lines.push(raw); // "\ No newline at end of file" follows the line it is about
        continue;
      }
      const isSelected = selected.has(index++) && raw[0] !== " ";
      picked ||= isSelected;
      const line = keep(raw, isSelected, reverse);
      lastKept = line !== null;
      if (line !== null) lines.push(line);
    }
    if (!picked) continue;
    if (!markersInPlace(lines)) throw new EndOfFileSelectionError();
    out.push(header(hunk, lines, delta, reverse), ...lines);
    const added = lines.filter((l) => l[0] === "+").length;
    delta += added - lines.filter((l) => l[0] === "-").length;
  }
  return out.length ? `${out.join("\n")}\n` : null;
}

/** Indexes of each run of consecutive changed lines: what the UI calls a hunk. */
export function changeBlocks(lines: DiffLine[]): number[][] {
  const blocks: number[][] = [];
  lines.forEach((line, i) => {
    if (line.kind === "context") return;
    if (i > 0 && lines[i - 1].kind !== "context") blocks[blocks.length - 1].push(i);
    else blocks.push([i]);
  });
  return blocks;
}
