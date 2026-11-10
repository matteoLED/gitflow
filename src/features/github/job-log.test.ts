import { describe, expect, it } from "vitest";
import { delta, parseJobLog } from "./job-log";

const log = [
  "test\tRun tests\t\uFEFF2026-11-10T16:23:19.000Z ##[group]Run pnpm test",
  "test\tRun tests\t2026-11-10T16:23:19.002Z pnpm test",
  "test\tRun tests\t2026-11-10T16:23:19.010Z ##[endgroup]",
  "test\tRun tests\t2026-11-10T16:23:20.000Z \x1b[41m FAIL \x1b[0m a.test.ts",
  "test\tRun tests\t2026-11-10T16:23:21.000Z ##[error]Process completed with exit code 1.",
].join("\n");

describe("parseJobLog", () => {
  const step = parseJobLog(log).get("Run tests");

  it("folds ##[group] blocks under their title", () => {
    expect(step?.items[0]).toMatchObject({
      kind: "group",
      title: { text: "Run pnpm test" },
      lines: [{ text: "pnpm test" }],
    });
  });

  it("flags failing lines, colored or marked", () => {
    expect(step?.items.slice(1).map((i) => i.kind === "line" && i.line.error)).toEqual([true, true]);
  });

  it("spans the step from its first to its last timestamp", () => {
    expect((step?.end ?? 0) - (step?.start ?? 0)).toBe(2000);
  });
});

describe("delta", () => {
  it("reads in ms, then seconds, then minutes", () => {
    expect([delta(2), delta(1400), delta(125_000)]).toEqual(["+2ms", "+1.4s", "+2min"]);
  });
});
