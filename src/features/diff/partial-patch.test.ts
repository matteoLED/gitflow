import { describe, expect, it } from "vitest";
import { buildPartialPatch, changeBlocks } from "./partial-patch";
import { parseUnifiedDiff } from "./parse-unified-diff";

const header = "diff --git a/f b/f\n--- a/f\n+++ b/f\n";
// Lines as parseUnifiedDiff indexes them: 0 " a", 1 "-b", 2 "+B", 3 " c", 4 "+d"
const PATCH = `${header}@@ -1,3 +1,4 @@\n a\n-b\n+B\n c\n+d\n`;

describe("buildPartialPatch", () => {
  it("keeps every change when all are selected", () => {
    expect(buildPartialPatch(PATCH, new Set([1, 2, 4]), false)).toBe("@@ -1,3 +1,4 @@\n a\n-b\n+B\n c\n+d\n");
  });

  it("turns unselected removed lines into context and drops unselected added lines", () => {
    expect(buildPartialPatch(PATCH, new Set([4]), false)).toBe("@@ -1,3 +1,4 @@\n a\n b\n c\n+d\n");
  });

  it("does the opposite in reverse, against the new side", () => {
    expect(buildPartialPatch(PATCH, new Set([4]), true)).toBe("@@ -1,3 +1,4 @@\n a\n B\n c\n+d\n");
  });

  it("supports a removed line alone", () => {
    expect(buildPartialPatch(PATCH, new Set([1]), false)).toBe("@@ -1,3 +1,2 @@\n a\n-b\n c\n");
  });

  it("ignores selected context lines", () => {
    expect(buildPartialPatch(PATCH, new Set([0, 3]), false)).toBeNull();
  });

  it("shifts later hunks by the changes kept before them", () => {
    const patch = `${header}@@ -1,2 +1,3 @@\n a\n+x\n b\n@@ -10,2 +11,2 @@\n-y\n+Y\n z\n`;
    expect(buildPartialPatch(patch, new Set([1, 3, 4]), false)).toBe(
      "@@ -1,2 +1,3 @@\n a\n+x\n b\n@@ -10,2 +11,2 @@\n-y\n+Y\n z\n",
    );
    expect(buildPartialPatch(patch, new Set([3, 4]), false)).toBe("@@ -10,2 +10,2 @@\n-y\n+Y\n z\n");
  });

  it("keeps the no-newline marker after a kept line", () => {
    const patch = `${header}@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n`;
    expect(buildPartialPatch(patch, new Set([1, 2]), false)).toBe(
      "@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n",
    );
  });

  it("drops the no-newline marker with a dropped line", () => {
    const patch = `${header}@@ -1 +1,3 @@\n a\n+b\n+c\n\\ No newline at end of file\n`;
    expect(buildPartialPatch(patch, new Set([1]), false)).toBe("@@ -1,1 +1,2 @@\n a\n+b\n");
  });

  it("numbers a new file's hunk from zero", () => {
    const patch = `${header}@@ -0,0 +1,2 @@\n+a\n+b\n`;
    expect(buildPartialPatch(patch, new Set([1]), true)).toBe("@@ -1,1 +1,2 @@\n a\n+b\n");
    expect(buildPartialPatch(patch, new Set([0]), false)).toBe("@@ -0,0 +1,1 @@\n+a\n");
  });

  it("uses the same indexes as parseUnifiedDiff", () => {
    const lines = parseUnifiedDiff(PATCH).flatMap((h) => h.lines);
    expect(lines[4]).toMatchObject({ kind: "added", content: "d" });
  });
});

describe("changeBlocks", () => {
  it("groups consecutive changed lines", () => {
    const lines = parseUnifiedDiff(PATCH).flatMap((h) => h.lines);
    expect(changeBlocks(lines)).toEqual([[1, 2], [4]]);
  });
});
