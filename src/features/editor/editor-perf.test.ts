import { describe, expect, it } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { blameExtension } from "./blame-cm";
import { conflictMarkers, touchesMarker } from "./conflicts-cm";
import { hasLongLine } from "./codemirror";

const hunk = (sha: string, startLine: number, lines: number) => ({
  sha,
  startLine,
  lines,
  author: "Ana",
  authorTime: 1,
  summary: "s",
});
const labels = { gutter: () => "g", inline: (h: { sha: string }) => h.sha, title: () => "t" };

/** The blame annotation decorations on the cursor line, as widgets' texts. */
function ghosts(state: EditorState) {
  const out: number[] = [];
  for (const source of state.facet(EditorView.decorations))
    if (typeof source !== "function") source.between(0, state.doc.length, (from) => void out.push(from));
  return out;
}

describe("inline blame", () => {
  const doc = "one\ntwo\nthree";
  const make = (sha: string) =>
    EditorState.create({ doc, extensions: blameExtension([hunk(sha, 1, 3)], labels, () => {}, false) });

  it("annotates the cursor line of a committed hunk", () => {
    expect(ghosts(make("abc123"))).toEqual([3]);
  });

  it("stays silent on lines not committed yet", () => {
    expect(ghosts(make("0000000"))).toEqual([]);
  });

  it("drops the annotation of a line once it is edited", () => {
    const state = make("abc123").update({ changes: { from: 1, insert: "x" } }).state;
    expect(ghosts(state)).toEqual([]);
  });

  it("keeps the annotation of untouched lines", () => {
    const edited = make("abc123").update({ changes: { from: 9, insert: "x" } }).state;
    expect(ghosts(edited.update({ selection: { anchor: 0 } }).state)).toEqual([3]);
  });
});

describe("conflict scan", () => {
  const state = EditorState.create({ doc: "a\nb\nc", extensions: conflictMarkers });

  it("skips the rescan for an edit on an ordinary line", () => {
    expect(touchesMarker(state.update({ changes: { from: 0, insert: "z" } }))).toBe(false);
  });

  it("rescans when an edit writes a marker line", () => {
    expect(touchesMarker(state.update({ changes: { from: 0, insert: "<<<<<<< HEAD\n" } }))).toBe(true);
  });
});

describe("hasLongLine", () => {
  it("flags a minified line", () => {
    expect(hasLongLine(Text.of(["a", "x".repeat(10_001)]))).toBe(true);
  });

  it("leaves ordinary code highlighted", () => {
    expect(hasLongLine(Text.of(Array.from({ length: 100 }, () => "const a = 1;")))).toBe(false);
  });
});
