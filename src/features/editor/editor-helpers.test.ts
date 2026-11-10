import { describe, expect, it } from "vitest";
import { buildTree, parentsOf, visibleRows } from "./file-tree";
import { fuzzyFilter, fuzzyScore } from "./fuzzy";

describe("fuzzyFilter", () => {
  const paths = ["src/features/diff/DiffCard.tsx", "src/features/diff/diff-model.ts", "docs/card-design.md"];

  it("ranks file-name and word-start matches first", () => {
    expect(fuzzyFilter("dicard", paths)[0]).toBe("src/features/diff/DiffCard.tsx");
  });

  it("drops paths missing a character, in order", () => {
    expect(fuzzyScore("zz", paths[0])).toBeNull();
  });
});

describe("visibleRows", () => {
  const tree = buildTree(["b.ts", "src/z.ts", "src/lib/a.ts", "a.md"]);

  it("lists folders first and only opens what's open", () => {
    expect(visibleRows(tree, new Set(["src"])).map((r) => `${"  ".repeat(r.depth)}${r.name}`)).toEqual([
      "src",
      "  lib",
      "  z.ts",
      "a.md",
      "b.ts",
    ]);
  });

  it("names the folders to open to reveal a file", () => {
    expect(parentsOf("src/lib/a.ts")).toEqual(["src", "src/lib"]);
  });
});
