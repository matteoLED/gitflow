import { describe, expect, it } from "vitest";
import { layoutSteps, parseTour, snippetLines } from "./tour";

const answer = JSON.stringify({
  overview: "Fixes two bugs.",
  risk: "medium",
  impact: "huge",
  attention: "low",
  reasons: { risk: "Touches the parser.", impact: 42 },
  steps: [
    { label: "Parser fix", title: "Fix EOF", explanation: "`a`", snippets: [{ path: "src/a.rs", start: 3, end: 9 }] },
    { label: "Test", title: "Covers it", explanation: "b", snippets: [{ path: "../etc/passwd", start: 1, end: 2 }] },
    { label: "", title: "dropped", explanation: "c" },
  ],
  links: [
    { from: 0, to: 1, label: "verified by" },
    { from: 0, to: 7, label: "out of range" },
  ],
});

describe("pull request tours", () => {
  it("keeps the reason given for a rating", () => {
    expect(parseTour(answer)?.reasons.risk).toBe("Touches the parser.");
  });

  it("leaves a malformed reason empty", () => {
    expect(parseTour(answer)?.reasons.impact).toBe("");
  });

  it("keeps the valid steps only", () => {
    expect(parseTour(answer)?.steps.map((s) => s.label)).toEqual(["Parser fix", "Test"]);
  });

  it("drops snippets that point outside the repository", () => {
    expect(parseTour(answer)?.steps[1].snippets).toEqual([]);
  });

  it("drops links to steps that don't exist", () => {
    expect(parseTour(answer)?.links).toHaveLength(1);
  });

  it("reads an unknown rating as medium", () => {
    expect(parseTour(answer)?.impact).toBe("medium");
  });

  it("refuses an answer without steps", () => {
    expect(parseTour('{"overview": "x", "steps": []}')).toBeNull();
  });

  it("puts a linked step below the one it comes from", () => {
    expect(layoutSteps(3, [{ from: 0, to: 2, label: "" }])).toEqual([
      { row: 0, column: 0 },
      { row: 0, column: 1 },
      { row: 1, column: 0 },
    ]);
  });

  it("cuts a snippet out of the diff by its new-file lines", () => {
    const hunks = [
      {
        hiddenBefore: 0,
        lines: [
          { kind: "context" as const, oldLine: 1, newLine: 1, content: "a" },
          { kind: "removed" as const, oldLine: 2, newLine: null, content: "b" },
          { kind: "added" as const, oldLine: null, newLine: 2, content: "c" },
          { kind: "context" as const, oldLine: 3, newLine: 3, content: "d" },
        ],
      },
    ];
    expect(snippetLines(hunks, { path: "x", start: 2, end: 3 }).map((l) => l.content)).toEqual(["c", "d"]);
  });
});
