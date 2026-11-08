import { describe, expect, it } from "vitest";
import type { DiffLine } from "@/types/git";
import { toSplitRows } from "./split-rows";
import { isGenerated } from "./generated";

const ctx = (n: number): DiffLine => ({ kind: "context", oldLine: n, newLine: n, content: "c" });
const del = (n: number): DiffLine => ({ kind: "removed", oldLine: n, newLine: null, content: "d" });
const add = (n: number): DiffLine => ({ kind: "added", oldLine: null, newLine: n, content: "a" });

const shape = (lines: DiffLine[]) =>
  toSplitRows(lines).map(({ left, right }) => `${left?.kind[0] ?? "_"}${right?.kind[0] ?? "_"}`);

describe("toSplitRows", () => {
  it("pairs removed and added lines of the same change", () => {
    expect(shape([ctx(1), del(2), del(3), add(2), ctx(4)])).toEqual(["cc", "ra", "r_", "cc"]);
  });

  it("leaves the left side empty for pure additions", () => {
    expect(shape([add(1), add(2)])).toEqual(["_a", "_a"]);
  });

  it("starts a new pair run when a removal follows additions", () => {
    expect(shape([add(1), del(1)])).toEqual(["_a", "r_"]);
  });
});

describe("isGenerated", () => {
  it("flags lockfiles", () => expect(isGenerated("apps/web/pnpm-lock.yaml")).toBe(true));
  it("flags build output folders", () => expect(isGenerated("packages/ui/dist/index.js")).toBe(true));
  it("keeps regular sources", () => expect(isGenerated("src/distance.ts")).toBe(false));
});
