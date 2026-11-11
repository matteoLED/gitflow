import { describe, expect, it } from "vitest";
import { groupLimit, mergeUnique, parsePaletteQuery, rankByText } from "./palette-search";

describe("parsePaletteQuery", () => {
  it("searches everything without a prefix", () => {
    expect(parsePaletteQuery("  fix login ")).toEqual({ scope: "all", term: "fix login" });
  });

  it.each([
    [">fetch", "actions", "fetch"],
    ["# 42", "prs", "42"],
    ["@src/app", "files", "src/app"],
    ["!ENG-1", "issues", "ENG-1"],
  ])("reads the %s prefix", (raw, scope, term) => {
    expect(parsePaletteQuery(raw)).toEqual({ scope, term });
  });

  it("keeps a lone prefix as an empty term", () => {
    expect(parsePaletteQuery("#")).toEqual({ scope: "prs", term: "" });
  });
});

describe("groupLimit", () => {
  it("shows more rows once narrowed to one kind", () => {
    expect(groupLimit("prs")).toBeGreaterThan(groupLimit("all"));
  });
});

describe("rankByText", () => {
  const same = (s: string) => s;

  it("needs every word, in any order and case", () => {
    expect(rankByText("login FIX", ["Fix login", "Fix logout", "login"], same, 5)).toEqual(["Fix login"]);
  });

  it("puts a leading match before a word match before a mid-word one", () => {
    expect(rankByText("port", ["support it", "the port", "port forward"], same, 5)).toEqual([
      "port forward",
      "the port",
      "support it",
    ]);
  });

  it("keeps the given order for equal matches", () => {
    expect(rankByText("a", ["b a", "c a"], same, 5)).toEqual(["b a", "c a"]);
  });

  it("returns the first items for an empty term", () => {
    expect(rankByText(" ", ["a", "b", "c"], same, 2)).toEqual(["a", "b"]);
  });

  it("stops at the limit", () => {
    expect(rankByText("x", ["x1", "x2", "x3"], same, 2)).toHaveLength(2);
  });
});

describe("mergeUnique", () => {
  it("appends only the unseen items, up to the limit", () => {
    const id = (s: string) => s;
    expect(mergeUnique(["a", "b"], ["b", "c", "d"], id, 3)).toEqual(["a", "b", "c"]);
  });
});
