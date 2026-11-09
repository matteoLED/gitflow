import { describe, expect, it } from "vitest";
import { formatAge, formatCommitDate } from "./format-date";
import { nextListIndex } from "./list-navigation";

describe("nextListIndex", () => {
  it("moves down", () => expect(nextListIndex("ArrowDown", 1, 5)).toBe(2));
  it("stops at the last item", () => expect(nextListIndex("ArrowDown", 4, 5)).toBe(4));
  it("stops at the first item", () => expect(nextListIndex("ArrowUp", 0, 5)).toBe(0));
  it("starts at the top when nothing is selected", () => expect(nextListIndex("ArrowUp", -1, 5)).toBe(0));
  it("ignores other keys", () => expect(nextListIndex("Enter", 1, 5)).toBeNull());
  it("ignores empty lists", () => expect(nextListIndex("ArrowDown", 0, 0)).toBeNull());
});

describe("formatCommitDate", () => {
  const now = new Date(2026, 10, 8, 18, 0); // Sun 8 Nov 2026

  it("labels same-day commits as Today", () => {
    expect(formatCommitDate(new Date(2026, 10, 8, 9, 46).toISOString(), now)).toBe("Today 9.46");
  });

  it("uses the weekday within the last week", () => {
    expect(formatCommitDate(new Date(2026, 10, 6, 21, 48).toISOString(), now)).toBe("Fri 21.48");
  });

  it("says Aujourd'hui in French", () => {
    expect(formatCommitDate(new Date(2026, 10, 8, 9, 46).toISOString(), now, "fr")).toBe("Aujourd'hui 9.46");
  });

  it("uses French weekday abbreviations", () => {
    expect(formatCommitDate(new Date(2026, 10, 6, 21, 48).toISOString(), now, "fr")).toBe("ven. 21.48");
  });

  it("uses the full date beyond a week", () => {
    expect(formatCommitDate(new Date(2026, 2, 3, 12, 0).toISOString(), now)).toBe("3 Mar 2026");
  });
});

describe("formatAge", () => {
  const now = new Date("2026-11-08T12:00:00Z");

  it("uses hours within a day", () => {
    expect(formatAge("2026-11-08T09:00:00Z", now)).toBe("3h");
  });

  it("uses weeks past a week", () => {
    expect(formatAge("2026-09-13T12:00:00Z", now)).toBe("8w");
  });

  it("localizes the unit", () => {
    expect(formatAge("2026-11-03T12:00:00Z", now, "fr")).toBe("5 j");
  });
});
