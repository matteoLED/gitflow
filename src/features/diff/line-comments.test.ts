import { describe, expect, it } from "vitest";
import type { ReviewThread } from "@/types/git";
import { threadsOf } from "./LineComments";

const thread = (t: Partial<ReviewThread>): ReviewThread => ({
  id: "T",
  isResolved: false,
  isOutdated: false,
  path: "a.ts",
  line: 4,
  originalLine: 4,
  diffSide: "RIGHT",
  comments: { nodes: [] },
  ...t,
});

describe("threadsOf", () => {
  it("keys this file's current threads by side and line, leaving outdated ones out", () => {
    const threads = threadsOf(
      [
        thread({ id: "a" }),
        thread({ id: "b", path: "b.ts" }),
        thread({ id: "c", line: null }),
        thread({ id: "d", diffSide: "LEFT", line: 2 }),
      ],
      "a.ts",
    );
    expect([...threads].map(([key, list]) => [key, list.map((t) => t.id)])).toEqual([
      ["RIGHT:4", ["a"]],
      ["LEFT:2", ["d"]],
    ]);
  });
});
