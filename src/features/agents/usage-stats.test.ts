import { describe, expect, it } from "vitest";
import { summarize } from "./usage-stats";

const tokens = { input: 1_000_000, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
const stats = {
  rows: [
    { day: "2026-11-09", project: "app", model: "claude-opus-4-8", messages: 3, tokens },
    { day: "2026-11-01", project: "app", model: "claude-opus-4-8", messages: 1, tokens },
    { day: "2026-11-09", project: "other", model: "claude-sonnet-4-6", messages: 1, tokens },
  ],
  sessions: [
    { project: "app", day: "2026-11-09" },
    { project: "app", day: "2026-10-01" },
  ],
};
const today = new Date("2026-11-09T12:00:00Z");

describe("summarize", () => {
  it("keeps only the period", () => {
    expect(summarize(stats, 7, "app", today).cost).toBe(5);
  });
  it("adds up every project when none is picked", () => {
    expect(summarize(stats, 7, null, today).cost).toBe(8);
  });
  it("has one bar per day, today last", () => {
    const daily = summarize(stats, 7, null, today).daily;
    expect([daily.length, daily[6].key]).toEqual([7, "2026-11-09"]);
  });
  it("counts sessions by the day they started", () => {
    expect(summarize(stats, 30, "app", today).sessions).toBe(1);
  });
  it("ranks models by cost", () => {
    expect(summarize(stats, 30, null, today).byModel[0].key).toBe("claude-opus-4-8");
  });
});
