import { describe, expect, it } from "vitest";
import { checkDuration, checkOutcome, runIdOf } from "./ChecksMenu";

const run = { __typename: "CheckRun" as const, status: "COMPLETED", conclusion: "SUCCESS" };

describe("checks", () => {
  it("formats a run's duration like Linear", () => {
    expect(checkDuration({ ...run, startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:01:02Z" })).toBe(
      "1m 2s",
    );
  });

  it("finds the Actions run behind a check", () => {
    expect(runIdOf({ ...run, detailsUrl: "https://github.com/o/r/actions/runs/123/job/9" })).toBe(123);
  });

  it("reads a status context's state", () => {
    expect(checkOutcome({ __typename: "StatusContext", state: "FAILURE" })).toBe("fail");
  });
});

describe("job logs", () => {
  it("groups gh's log lines by step and drops timestamps", async () => {
    const { logByStep } = await import("./PullRequestCi");
    const log = "test\tRun tests\t2026-01-01T00:00:00.1234567Z ok\ntest\tRun tests\t2026-01-01T00:00:01Z FAIL a";
    expect(logByStep(log)).toEqual([{ step: "Run tests", lines: ["ok", "FAIL a"] }]);
  });
});
