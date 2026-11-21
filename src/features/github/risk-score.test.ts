import { describe, expect, it } from "vitest";
import type { PullRequestDetails } from "@/types/git";
import { riskScoreIn, riskScoreOf } from "./risk-score";

const block = (entry: object) => `<!-- linear:extension\n${JSON.stringify({ version: 1, plugins: [entry] })}\n-->`;
const score = {
  plugin: "riskScore",
  level: 3,
  explanations: ["Touches CI"],
  areas: [
    { name: "Reporting", level: 1, explanation: "No change" },
    { name: "Payments", level: 3 },
  ],
};

describe("riskScoreIn", () => {
  it("orders areas highest risk first", () => {
    expect(riskScoreIn(block(score), null)?.areas.map((a) => a.name)).toEqual(["Payments", "Reporting"]);
  });

  it("ignores a score with an unknown field", () => {
    expect(riskScoreIn(block({ ...score, extra: 1 }), null)).toBeNull();
  });

  it("ignores a score made for another commit", () => {
    expect(riskScoreIn(block({ ...score, sha: "a".repeat(40) }), "b".repeat(40))).toBeNull();
  });
});

describe("riskScoreOf", () => {
  it("takes the newest comment's score", () => {
    const pr = {
      body: block(score),
      author: { login: "me" },
      createdAt: "2026-01-01T00:00:00Z",
      commits: [],
      reviews: [],
      comments: [{ body: block({ ...score, level: 1 }), author: { login: "bot" }, createdAt: "2026-01-02T00:00:00Z" }],
    } as unknown as PullRequestDetails;
    expect(riskScoreOf(pr)).toMatchObject({ level: 1, author: "bot" });
  });
});
