import { describe, expect, it } from "vitest";
import { buildGraph } from "./graph";

describe("commit graph", () => {
  it("keeps a linear history on one lane", () => {
    const rows = buildGraph([
      { hash: "c", parents: ["b"] },
      { hash: "b", parents: ["a"] },
      { hash: "a", parents: [] },
    ]);
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0]);
  });

  it("opens a lane for the merged branch and joins it back", () => {
    const rows = buildGraph([
      { hash: "m", parents: ["a", "f"] },
      { hash: "f", parents: ["a"] },
      { hash: "a", parents: [] },
    ]);
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0]);
  });

  it("draws the merge commit's second parent towards the new lane", () => {
    const [merge] = buildGraph([{ hash: "m", parents: ["a", "f"] }]);
    expect(merge.segments).toContainEqual(expect.objectContaining({ from: 0, to: 1, part: "bottom" }));
  });
});
