import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./parse-unified-diff";

const TWO_HUNKS = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -10,2 +10,3 @@ fn
 keep
-old
+new
+extra
@@ -40,2 +41,2 @@
 tail
\\ No newline at end of file`;

describe("parseUnifiedDiff", () => {
  it("ignores file headers before the first hunk", () => {
    expect(parseUnifiedDiff(TWO_HUNKS)).toHaveLength(2);
  });

  it("counts unchanged lines before the first hunk", () => {
    expect(parseUnifiedDiff(TWO_HUNKS)[0].hiddenBefore).toBe(9);
  });

  it("counts unchanged lines between hunks using new-file line numbers", () => {
    expect(parseUnifiedDiff(TWO_HUNKS)[1].hiddenBefore).toBe(28);
  });

  it("numbers removed lines with the old file only", () => {
    expect(parseUnifiedDiff(TWO_HUNKS)[0].lines[1]).toEqual({
      kind: "removed",
      oldLine: 11,
      newLine: null,
      content: "old",
    });
  });

  it("numbers added lines with the new file only", () => {
    expect(parseUnifiedDiff(TWO_HUNKS)[0].lines[3]).toEqual({
      kind: "added",
      oldLine: null,
      newLine: 12,
      content: "extra",
    });
  });

  it("skips the no-newline marker", () => {
    expect(parseUnifiedDiff(TWO_HUNKS)[1].lines).toHaveLength(1);
  });

  it("keeps removed lines whose content starts with dashes", () => {
    expect(parseUnifiedDiff("@@ -1 +0,0 @@\n--- not a header")[0].lines[0].content).toBe("-- not a header");
  });

  it("returns no hunks for an empty diff", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});
