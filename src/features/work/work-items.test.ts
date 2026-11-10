import { describe, expect, it } from "vitest";
import type { LocalBranch, PullRequest, WorkflowRun } from "@/types/git";
import { issueIdOf, workItems } from "./work-items";

const NOW = new Date("2026-11-10T12:00:00Z").getTime();
const branch = (name: string, committedAt = "2026-11-09T12:00:00Z"): LocalBranch => ({
  name,
  upstream: `origin/${name}`,
  upstreamGone: false,
  ahead: 0,
  behind: 0,
  committedAt,
  subject: `last commit of ${name}`,
});
const pr = (headRefName: string, patch: Partial<PullRequest> = {}): PullRequest => ({
  number: 1,
  title: `PR ${headRefName}`,
  author: { login: "mat" },
  headRefName,
  baseRefName: "main",
  headRefOid: "abc",
  isDraft: false,
  updatedAt: "2026-11-10T10:00:00Z",
  reviewDecision: "REVIEW_REQUIRED",
  state: "OPEN",
  url: "u",
  ...patch,
});
const run = (headBranch: string, conclusion: WorkflowRun["conclusion"]): WorkflowRun => ({
  databaseId: 1,
  displayTitle: "",
  workflowName: "CI",
  status: "completed",
  conclusion,
  headBranch,
  event: "push",
  createdAt: "",
  updatedAt: "",
  url: "",
});
const items = (sources: Partial<Parameters<typeof workItems>[0]>) =>
  workItems({ branches: [], pullRequests: [], runs: [], issues: [], head: null, now: NOW, ...sources });

describe("issueIdOf", () => {
  it("reads the Linear id of a branch name", () => {
    expect(issueIdOf("mat/mnt-936-fix-backoffice-coach")).toBe("MNT-936");
  });

  it("ignores a number in the middle of a branch name", () => {
    expect(issueIdOf("backup/turbo-before-rebase-1106")).toBeNull();
  });

  it("finds none in a plain branch name", () => {
    expect(issueIdOf("fix-deploy-ci")).toBeNull();
  });
});

describe("workItems", () => {
  it("puts a branch and its open pull request on one line", () => {
    expect(items({ branches: [branch("feat/x")], pullRequests: [pr("feat/x")] }).length).toBe(1);
  });

  it("shows a teammate's pull request without a local branch", () => {
    expect(items({ pullRequests: [pr("lena/fold")] })[0].status).toBe("review");
  });

  it("hides a merged pull request whose branch is gone", () => {
    expect(items({ pullRequests: [pr("old", { state: "MERGED" })] })).toEqual([]);
  });

  it("keeps a merged branch still here, to clean up", () => {
    expect(items({ branches: [branch("old")], pullRequests: [pr("old", { state: "MERGED" })] })[0].status).toBe(
      "merged",
    );
  });

  it("leaves the default branch out", () => {
    expect(items({ branches: [branch("main")] })).toEqual([]);
  });

  it("calls a month-old branch without pull request stale", () => {
    expect(items({ branches: [branch("x", "2026-09-01T00:00:00Z")] })[0].status).toBe("stale");
  });

  it("reads the CI of the branch's latest run", () => {
    expect(items({ branches: [branch("x")], runs: [run("x", "failure"), run("x", "success")] })[0].ci).toBe("failure");
  });

  it("prefers the open pull request over an older merged one", () => {
    const prs = [pr("x", { state: "MERGED", number: 1 }), pr("x", { number: 2 })];
    expect(items({ branches: [branch("x")], pullRequests: prs })[0].pr?.number).toBe(2);
  });

  it("lists a branch that is only on GitHub", () => {
    const remotes = [{ remote: "origin", name: "old", committedAt: "2026-08-01T00:00:00Z" }];
    expect(items({ remotes })[0]).toMatchObject({ local: null, status: "stale" });
  });

  it("keeps a merged pull request's branch still on GitHub, to clean up", () => {
    const remotes = [{ remote: "origin", name: "old", committedAt: "2026-11-01T00:00:00Z" }];
    expect(items({ remotes, pullRequests: [pr("old", { state: "MERGED" })] })[0].status).toBe("merged");
  });
});
