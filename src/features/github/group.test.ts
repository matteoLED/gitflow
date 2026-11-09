import { describe, expect, it } from "vitest";
import type { PullRequest } from "@/types/git";
import { groupOf } from "./PullRequestList";
import { ghStatus } from "@/features/agents/status";

const pr = (over: Partial<PullRequest>): PullRequest => ({
  number: 1,
  title: "t",
  author: { login: "a" },
  headRefName: "h",
  baseRefName: "main",
  headRefOid: "abc",
  isDraft: false,
  updatedAt: "2026-01-01T00:00:00Z",
  reviewDecision: null,
  state: "OPEN",
  url: "https://github.com/o/r/pull/1",
  ...over,
});

describe("pull request groups", () => {
  it("puts approved pull requests in ready to merge", () => {
    expect(groupOf(pr({ reviewDecision: "APPROVED" }))).toBe("ready");
  });

  it("keeps approved drafts with the drafts", () => {
    expect(groupOf(pr({ isDraft: true, reviewDecision: "APPROVED" }))).toBe("draft");
  });

  it("files merged pull requests apart", () => {
    expect(groupOf(pr({ state: "MERGED" }))).toBe("merged");
  });
});

describe("GitHub Actions status", () => {
  it("shows a run in progress as running", () => {
    expect(ghStatus("in_progress", "")).toBe("running");
  });

  it("treats a timeout as a failure", () => {
    expect(ghStatus("completed", "timed_out")).toBe("failed");
  });
});
