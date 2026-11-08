import { describe, expect, it } from "vitest";
import type { DiffLine } from "@/types/git";
import { buildSegments, revealGap } from "./diff-model";

const ctx = (n: number): DiffLine => ({ kind: "context", oldLine: n, newLine: n, content: `l${n}` });
const add = (n: number): DiffLine => ({ kind: "added", oldLine: null, newLine: n, content: `a${n}` });

/** 30 unchanged lines with one addition at line 15. */
const FILE = [
  ...Array.from({ length: 14 }, (_, i) => ctx(i + 1)),
  add(15),
  ...Array.from({ length: 15 }, (_, i) => ctx(i + 16)),
];

const shape = (lines: DiffLine[]) => buildSegments(lines).map((s) => `${s.kind}:${s.lines.length}`);

describe("buildSegments", () => {
  it("folds unchanged lines around a change, keeping 3 lines of context", () => {
    expect(shape(FILE)).toEqual(["gap:11", "lines:7", "gap:12"]);
  });

  it("labels the first fold as the start of the file", () => {
    expect(buildSegments(FILE)[0]).toMatchObject({ kind: "gap", position: "start" });
  });

  it("labels the last fold as the end of the file", () => {
    expect(buildSegments(FILE)[2]).toMatchObject({ kind: "gap", position: "end" });
  });

  it("shows short unchanged runs inline instead of folding them", () => {
    expect(shape([ctx(1), ctx(2), ctx(3), ctx(4), add(5)])).toEqual(["lines:5"]);
  });

  it("keeps everything visible when nothing changed", () => {
    expect(shape([ctx(1), ctx(2)])).toEqual(["lines:2"]);
  });

  it("returns no segments for an empty diff", () => {
    expect(buildSegments([])).toEqual([]);
  });
});

describe("revealGap", () => {
  const gap = Array.from({ length: 10 }, (_, i) => ctx(i + 1));

  it("reveals lines on both sides of the fold", () => {
    const { head, hidden, tail } = revealGap(gap, { top: 2, bottom: 3 });
    expect([head.length, hidden, tail.length]).toEqual([2, 5, 3]);
  });

  it("shows everything once both sides meet", () => {
    expect(revealGap(gap, { top: 8, bottom: 8 }).hidden).toBe(0);
  });
});
