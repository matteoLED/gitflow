import { describe, expect, it } from "vitest";
import { formatHistoryQuery, isEmptySearch, parseHistoryQuery } from "./search-query";

describe("parseHistoryQuery", () => {
  it("reads key tokens and free text as the message", () => {
    expect(parseHistoryQuery('author:mat file:src/x.ts "fix login" bug')).toEqual({
      author: "mat",
      path: "src/x.ts",
      message: "fix login bug",
    });
  });

  it("accepts quoted values and aliases", () => {
    expect(parseHistoryQuery('author:"Mat Le" code:useMemo after:2024-01-01 before:"2 weeks ago"')).toEqual({
      author: "Mat Le",
      content: "useMemo",
      since: "2024-01-01",
      until: "2 weeks ago",
    });
  });

  it("keeps unknown keys as plain text", () => {
    expect(parseHistoryQuery("fix: crash")).toEqual({ message: "fix: crash" });
  });

  it("turns is:regex into the regex flag", () => {
    expect(parseHistoryQuery("is:regex content:foo.*bar")).toEqual({ regex: true, content: "foo.*bar" });
  });

  it("returns an empty search for blank text", () => {
    expect(isEmptySearch(parseHistoryQuery("   "))).toBe(true);
  });
});

describe("formatHistoryQuery", () => {
  it("round-trips through the parser", () => {
    const search = { author: "Mat Le", path: "src/a b.ts", message: "fix: crash", since: "2024-01-01", regex: true };
    expect(parseHistoryQuery(formatHistoryQuery(search))).toEqual(search);
  });
});
