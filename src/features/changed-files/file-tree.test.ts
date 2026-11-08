import { describe, expect, it } from "vitest";
import type { ChangedFile } from "@/types/git";
import { buildFileRows, buildFileTree, flattenTree } from "./file-tree";

const file = (path: string): ChangedFile => ({
  path,
  previousPath: null,
  status: "modified",
  binary: false,
  additions: 1,
  deletions: 0,
});

const FILES = [file("app/src/b.ts"), file("app/src/lib/a.ts"), file("README.md"), file("app/src/a.ts")];

const names = (rows: ReturnType<typeof flattenTree>) => rows.map(({ node }) => node.name);

describe("buildFileTree", () => {
  it("merges single-child directory chains", () => {
    expect(buildFileTree(FILES)[0].name).toBe("app/src");
  });

  it("lists directories before files, each sorted by name", () => {
    expect(names(flattenTree(buildFileTree(FILES), new Set()))).toEqual([
      "app/src",
      "lib",
      "a.ts",
      "a.ts",
      "b.ts",
      "README.md",
    ]);
  });

  it("keeps file names with spaces and unicode intact", () => {
    expect(buildFileTree([file("docs/notes été.md")])[0]).toMatchObject({
      name: "docs",
      children: [{ name: "notes été.md" }],
    });
  });
});

describe("flattenTree", () => {
  it("hides children of collapsed directories", () => {
    expect(names(flattenTree(buildFileTree(FILES), new Set(["app/src"])))).toEqual(["app/src", "README.md"]);
  });

  it("indents nested rows by depth", () => {
    expect(flattenTree(buildFileTree(FILES), new Set())[1].depth).toBe(1);
  });
});

describe("buildFileRows", () => {
  const files: ChangedFile[] = [file("b/x.ts"), { ...file("a/new.ts"), status: "added" }];

  it("lists files flat and sorted in list mode", () => {
    const rows = buildFileRows(files, { mode: "list", grouping: "none", collapsed: new Set() });
    expect(rows.map((r) => r.key)).toEqual(["all:a/new.ts", "all:b/x.ts"]);
  });

  it("puts a header before each status group, added first", () => {
    const rows = buildFileRows(files, { mode: "list", grouping: "status", collapsed: new Set() });
    expect(rows.map((r) => (r.kind === "header" ? r.status : r.node.name))).toEqual([
      "added",
      "new.ts",
      "modified",
      "x.ts",
    ]);
  });

  it("collapses a directory only within its own group", () => {
    const rows = buildFileRows(files, { mode: "tree", grouping: "status", collapsed: new Set(["modified:b"]) });
    expect(rows.map((r) => r.key)).toEqual([
      "header:added",
      "added:a",
      "added:a/new.ts",
      "header:modified",
      "modified:b",
    ]);
  });
});
