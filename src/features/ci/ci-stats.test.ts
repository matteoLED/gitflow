import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "@/types/git";
import { byDay, formatDuration, summarize } from "./ci-stats";

const run = (over: Partial<WorkflowRun>): WorkflowRun => ({
  databaseId: 1,
  displayTitle: "t",
  workflowName: "CI",
  status: "completed",
  conclusion: "success",
  headBranch: "main",
  event: "push",
  createdAt: "2026-11-09T10:00:00Z",
  startedAt: "2026-11-09T10:00:00Z",
  updatedAt: "2026-11-09T10:02:00Z",
  url: "u",
  ...over,
});

describe("CI stats", () => {
  it("rates success over decided runs only", () => {
    const s = summarize([run({}), run({ conclusion: "failure" }), run({ conclusion: "cancelled" })]);
    expect(s.rate).toBe(0.5);
  });

  it("takes the median duration", () => {
    expect(summarize([run({}), run({ updatedAt: "2026-11-09T10:04:00Z" })]).median).toBe(180);
  });

  it("buckets runs by day, oldest first", () => {
    const days = byDay([run({}), run({ conclusion: "failure" })], 2, new Date("2026-11-09T12:00:00Z"));
    expect(days).toEqual([
      { day: "2026-11-08", success: 0, failure: 0, other: 0 },
      { day: "2026-11-09", success: 1, failure: 1, other: 0 },
    ]);
  });

  it("formats durations", () => {
    expect([formatDuration(59), formatDuration(62), formatDuration(3720)]).toEqual(["59s", "1m 2s", "1h 2m"]);
  });
});
