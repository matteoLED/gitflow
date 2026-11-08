import type { DiffLine } from "@/types/git";

export const CONTEXT_LINES = 3;
export const EXPAND_STEP = 20;
/** Unchanged runs shorter than this are shown inline: a fold control would take as much room. */
const MIN_FOLD = 4;

export type GapPosition = "start" | "middle" | "end";

export type Segment =
  { kind: "lines"; lines: DiffLine[] } | { kind: "gap"; id: number; position: GapPosition; lines: DiffLine[] };

/** Lines revealed at each end of a gap: `top` grows downward from the previous block, `bottom` upward from the next. */
export type GapReveal = { top: number; bottom: number };

function visibility(lines: DiffLine[], context: number): boolean[] {
  const visible = lines.map(() => false);
  lines.forEach((line, i) => {
    if (line.kind === "context") return;
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) visible[j] = true;
  });
  return visible;
}

function positionOf(start: number, end: number, total: number): GapPosition {
  if (start === 0) return "start";
  return end === total ? "end" : "middle";
}

/** Splits a full-context diff into visible blocks and foldable runs of unchanged lines. */
export function buildSegments(lines: DiffLine[], context = CONTEXT_LINES): Segment[] {
  if (!lines.some((l) => l.kind !== "context")) return lines.length ? [{ kind: "lines", lines }] : [];
  const visible = visibility(lines, context);
  const segments: Segment[] = [];
  let start = 0;
  while (start < lines.length) {
    let end = start;
    while (end < lines.length && visible[end] === visible[start]) end++;
    const run = lines.slice(start, end);
    const fold = !visible[start] && run.length >= MIN_FOLD;
    const last = segments.at(-1);
    if (fold) segments.push({ kind: "gap", id: start, position: positionOf(start, end, lines.length), lines: run });
    else if (last?.kind === "lines") last.lines.push(...run);
    else segments.push({ kind: "lines", lines: run });
    start = end;
  }
  return segments;
}

/** Splits a gap into the lines revealed above the fold, the hidden count, and the lines revealed below it. */
export function revealGap(lines: DiffLine[], reveal: GapReveal) {
  if (reveal.top + reveal.bottom >= lines.length) return { head: lines, hidden: 0, tail: [] as DiffLine[] };
  return {
    head: lines.slice(0, reveal.top),
    hidden: lines.length - reveal.top - reveal.bottom,
    tail: lines.slice(lines.length - reveal.bottom),
  };
}
