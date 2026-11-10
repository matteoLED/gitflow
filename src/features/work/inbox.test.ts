import { describe, expect, it } from "vitest";
import type { AgentRun } from "@/stores/agents-store";
import type { LinearIssue, PullRequest } from "@/types/git";
import { inboxItems, unread } from "./inbox";
import type { WorkItem } from "./work-items";

const NOW = new Date("2026-11-10T12:00:00Z").getTime();
const pr = (login: string, patch: Partial<PullRequest> = {}): PullRequest => ({
  number: 7,
  title: "t",
  author: { login },
  headRefName: "b",
  baseRefName: "main",
  headRefOid: "x",
  isDraft: false,
  updatedAt: "2026-11-10T10:00:00Z",
  reviewDecision: "REVIEW_REQUIRED",
  state: "OPEN",
  url: "u",
  ...patch,
});
const work = (patch: Partial<WorkItem>): WorkItem => ({
  key: "b",
  branch: "b",
  local: null,
  remote: null,
  pr: null,
  issueId: null,
  issue: null,
  ci: null,
  status: "progress",
  current: false,
  updatedAt: "2026-11-10T10:00:00Z",
  title: "t",
  ...patch,
});
const reasons = (sources: Partial<Parameters<typeof inboxItems>[0]>) =>
  inboxItems({ work: [], me: "mat", issues: [], runs: [], now: NOW, ...sources }).map((i) => i.reason);

describe("inboxItems", () => {
  it("asks to review a teammate's pull request", () => {
    expect(reasons({ work: [work({ pr: pr("lena") })] })).toEqual(["review"]);
  });

  it("leaves a teammate's pull request with requested changes to its author", () => {
    expect(reasons({ work: [work({ pr: pr("lena", { reviewDecision: "CHANGES_REQUESTED" }) })] })).toEqual([]);
  });

  it("doesn't ask to review the user's own pull request", () => {
    expect(reasons({ work: [work({ pr: pr("mat") })] })).toEqual([]);
  });

  it("flags requested changes on the user's pull request", () => {
    expect(reasons({ work: [work({ pr: pr("mat", { reviewDecision: "CHANGES_REQUESTED" }) })] })).toEqual([
      "changesRequested",
    ]);
  });

  it("puts a failing CI first", () => {
    const items = [work({ pr: pr("lena") }), work({ key: "c", branch: "c", pr: pr("mat"), ci: "failure" })];
    expect(reasons({ work: items })[0]).toBe("ciFailed");
  });

  it("lists urgent open issues", () => {
    const issue = { id: "i", identifier: "MNT-1", title: "x", priority: 1, updatedAt: "", state: { type: "started" } };
    expect(reasons({ issues: [issue as LinearIssue] })).toEqual(["urgentIssue"]);
  });

  it("forgets agents that finished more than a day ago", () => {
    const run = {
      id: "r",
      thread: "r",
      status: "done",
      startedAt: "2026-11-08T00:00:00Z",
      agent: "claude",
      title: "x",
    };
    expect(reasons({ runs: [run as AgentRun] })).toEqual([]);
  });
});

describe("unread", () => {
  it("brings back a dismissed item that changed", () => {
    const [item] = inboxItems({ work: [work({ pr: pr("lena") })], me: "mat", issues: [], runs: [], now: NOW });
    expect(unread([item], { [item.key]: "older" })).toEqual([item]);
  });
});
