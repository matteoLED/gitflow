import { describe, expect, it } from "vitest";
import { ciFixPrompt, logTail, MAX_LOG } from "./ci-fix";

const failure = { name: "test", workflow: "CI", jobId: 7, runId: 42 };
const target = { branch: "feat/x", pr: { number: 12, title: "Add x" }, failures: [failure] };

describe("logTail", () => {
  it("keeps the end of a long log, from a line start", () => {
    const log = `${"noise\n".repeat(5000)}Error: boom`;
    const tail = logTail(log);
    expect(tail.length <= MAX_LOG + 2 && tail.startsWith("…\nnoise\n") && tail.endsWith("Error: boom")).toBe(true);
  });
});

describe("ciFixPrompt", () => {
  it("names the check, workflow and PR, embeds the log and asks for a verified root-cause fix", () => {
    const prompt = ciFixPrompt(target, ["Error: boom"]);
    expect(
      ["CI / test", "#12", "`feat/x`", "Error: boom", "Reproduce", "root cause", "tests", "summarize"].every((s) =>
        prompt.includes(s),
      ),
    ).toBe(true);
  });

  it("points to gh when a log couldn't be loaded", () => {
    expect(ciFixPrompt(target, [null])).toContain("gh run view 42 --log-failed");
  });
});
