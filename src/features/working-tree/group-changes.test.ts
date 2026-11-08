import { describe, expect, it } from "vitest";
import type { WorkingTreeEntry } from "@/types/git";
import { groupChanges, pathsOf } from "./group-changes";

const entry = (overrides: Partial<WorkingTreeEntry>): WorkingTreeEntry => ({
  path: "a.ts",
  previousPath: null,
  staged: null,
  unstaged: null,
  conflicted: false,
  ...overrides,
});

describe("groupChanges", () => {
  it("lists a partially staged file in both groups", () => {
    const groups = groupChanges([entry({ staged: "modified", unstaged: "modified" })]);
    expect([groups.staged.length, groups.unstaged.length]).toEqual([1, 1]);
  });

  it("diffs untracked files as untracked", () => {
    expect(groupChanges([entry({ unstaged: "untracked" })]).unstaged[0].side).toBe("untracked");
  });

  it("keeps conflicts out of the staged list", () => {
    expect(groupChanges([entry({ staged: "unmerged", conflicted: true })]).staged).toEqual([]);
  });

  it("keeps the rename origin on the staged side", () => {
    expect(groupChanges([entry({ staged: "renamed", previousPath: "old.ts" })]).staged[0].previousPath).toBe("old.ts");
  });
});

describe("pathsOf", () => {
  it("includes both paths of a rename", () => {
    expect(pathsOf([{ path: "new.ts", previousPath: "old.ts", status: "renamed", side: "staged" }])).toEqual([
      "old.ts",
      "new.ts",
    ]);
  });
});
