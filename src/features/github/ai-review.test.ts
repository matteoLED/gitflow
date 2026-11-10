import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/features/diff/parse-unified-diff";
import { commentableLines, keepInDiff, parseAiReview } from "./ai-review";

const comment = { path: "src/a.ts", line: 2, side: "RIGHT", severity: "bug", body: "Off by one" } as const;
const answer = (comments: unknown[]) => JSON.stringify({ summary: "Looks risky", comments });

describe("parseAiReview", () => {
  it("reads a bare JSON answer", () => {
    expect(parseAiReview(answer([comment]))?.comments).toEqual([comment]);
  });

  it("extracts the JSON from a fenced block surrounded by prose", () => {
    const text = "Here is my review:\n```json\n" + answer([comment]) + "\n```\nDone.";
    expect(parseAiReview(text)?.summary).toBe("Looks risky");
  });

  it("extracts the JSON from prose without a fence", () => {
    expect(parseAiReview(`Sure! ${answer([])} Hope it helps`)?.comments).toEqual([]);
  });

  it("returns null when there is no JSON", () => {
    expect(parseAiReview("No issues found.")).toBeNull();
  });

  it("returns null when the shape is wrong", () => {
    expect(parseAiReview(JSON.stringify({ summary: 1, comments: [] }))).toBeNull();
  });

  it("drops comments with an invalid field and counts them", () => {
    const bad = [
      { ...comment, side: "BOTH" },
      { ...comment, severity: "blocker" },
      { ...comment, line: 0 },
      { ...comment, line: 1.5 },
      { ...comment, path: "../secret" },
      { ...comment, path: "/etc/passwd" },
      { ...comment, body: "  " },
      "not an object",
    ];
    expect(parseAiReview(answer([comment, ...bad]))?.invalid).toBe(bad.length);
  });

  it("normalizes a leading ./ in paths", () => {
    expect(parseAiReview(answer([{ ...comment, path: "./src/a.ts" }]))?.comments[0].path).toBe("src/a.ts");
  });
});

describe("keepInDiff", () => {
  const patch = "@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n";
  const lines = new Map([["src/a.ts", commentableLines(parseUnifiedDiff(patch))]]);

  it("keeps added and context lines on the RIGHT side", () => {
    expect(keepInDiff([comment, { ...comment, line: 3 }], lines)).toHaveLength(2);
  });

  it("keeps removed lines on the LEFT side", () => {
    expect(keepInDiff([{ ...comment, side: "LEFT", line: 2 }], lines)).toHaveLength(1);
  });

  it("drops lines outside the diff", () => {
    expect(keepInDiff([{ ...comment, line: 40 }], lines)).toEqual([]);
  });

  it("drops files outside the diff", () => {
    expect(keepInDiff([{ ...comment, path: "src/b.ts" }], lines)).toEqual([]);
  });
});
