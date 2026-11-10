import { describe, expect, it } from "vitest";
import { parseCommitPlan } from "./commit-plan";

const changed = new Set(["a.ts", "b.ts"]);

describe("parseCommitPlan", () => {
  it("reads a plan inside a code fence", () => {
    const text = '```json\n[{"message":"feat: a","files":["a.ts"]}]\n```';
    expect(parseCommitPlan(text, changed)).toEqual([{ message: "feat: a", files: ["a.ts"] }]);
  });

  it("rejects files outside the change set", () => {
    expect(() => parseCommitPlan('[{"message":"x","files":["c.ts"]}]', changed)).toThrow("c.ts");
  });

  it("rejects a file in two commits", () => {
    const text = '[{"message":"x","files":["a.ts"]},{"message":"y","files":["a.ts"]}]';
    expect(() => parseCommitPlan(text, changed)).toThrow("two commits");
  });

  it("rejects an empty message", () => {
    expect(() => parseCommitPlan('[{"message":" ","files":["a.ts"]}]', changed)).toThrow("message");
  });

  it("rejects prose", () => {
    expect(() => parseCommitPlan("Here is the plan", changed)).toThrow();
  });
});
