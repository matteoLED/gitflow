import { describe, expect, it } from "vitest";
import type { AgentRun } from "@/stores/agents-store";
import type { GithubNotification, LinearNotification, WorkflowRun } from "@/types/git";
import { applyMarks, filterInbox, fromAgentRuns, fromGithub, fromLinear, fromWorkflowRuns } from "./inbox-items";

const NOW = Date.parse("2026-11-11T12:00:00Z");

const gh = (id: string, updatedAt: string, unread = true): GithubNotification => ({
  id,
  unread,
  reason: "review_requested",
  updatedAt,
  title: `PR ${id}`,
  kind: "PullRequest",
  repo: "acme/app",
  number: 1,
  url: "https://github.com/acme/app/pull/1",
});

const linear = (id: string, updatedAt: string, read = false): LinearNotification => ({
  id,
  kind: "issueNewComment",
  updatedAt,
  read,
  actor: "Ada",
  issueId: "i1",
  identifier: "ENG-1",
  title: "Crash",
  url: "",
  comment: null,
});

const run = (patch: Partial<AgentRun>): AgentRun => ({
  id: "r1",
  repoPath: "/repo",
  agent: "claude",
  task: null,
  title: "Fix it",
  status: "done",
  steps: [],
  startedAt: "2026-11-11T10:00:00.000Z",
  sessionId: null,
  thread: "t1",
  ...patch,
});

const ci = (patch: Partial<WorkflowRun>): WorkflowRun => ({
  databaseId: 1,
  displayTitle: "Build",
  workflowName: "CI",
  status: "completed",
  conclusion: "failure",
  headBranch: "main",
  event: "push",
  createdAt: "2026-11-11T09:00:00Z",
  updatedAt: "2026-11-11T09:05:00Z",
  url: "https://github.com/acme/app/actions/runs/1",
  ...patch,
});

describe("applyMarks", () => {
  it("lists every source newest first", () => {
    const items = [
      ...fromGithub([gh("1", "2026-11-09T09:00:00Z")]),
      ...fromLinear("org", [linear("n1", "2026-11-11T09:00:00.000Z")]),
    ];
    expect(applyMarks(items, {}).map((i) => i.key)).toEqual(["linear:n1", "github:1"]);
  });

  it("hides an item marked done", () => {
    const items = fromGithub([gh("1", "2026-11-09T09:00:00Z")]);
    expect(applyMarks(items, { "github:1": { version: "2026-11-09T09:00:00Z", state: "done" } })).toEqual([]);
  });

  it("brings a done item back once it changes", () => {
    const items = fromGithub([gh("1", "2026-11-10T09:00:00Z")]);
    expect(applyMarks(items, { "github:1": { version: "2026-11-09T09:00:00Z", state: "done" } })).toHaveLength(1);
  });

  it("marks an item unread on demand", () => {
    const items = fromGithub([gh("1", "2026-11-09T09:00:00Z", false)]);
    const [item] = applyMarks(items, { "github:1": { version: "2026-11-09T09:00:00Z", state: "unread" } });
    expect(item.unread).toBe(true);
  });
});

describe("fromLinear", () => {
  it("reads unread from readAt", () => {
    expect(fromLinear("org", [linear("n1", "2026-11-11T09:00:00Z", true)])[0].unread).toBe(false);
  });
});

describe("fromAgentRuns", () => {
  it("keeps only the latest run of a conversation", () => {
    const runs = [run({ id: "r2", status: "failed" }), run({ id: "r1" })];
    expect(fromAgentRuns(runs, "/repo", NOW).map((i) => i.version)).toEqual(["r2:failed"]);
  });

  it("leaves out a conversation still running", () => {
    expect(fromAgentRuns([run({ id: "r2", status: "running" }), run({})], "/repo", NOW)).toEqual([]);
  });

  it("leaves out other repositories", () => {
    expect(fromAgentRuns([run({ repoPath: "/other" })], "/repo", NOW)).toEqual([]);
  });

  it("leaves out old runs", () => {
    expect(fromAgentRuns([run({ startedAt: "2026-11-01T10:00:00Z" })], "/repo", NOW)).toEqual([]);
  });
});

describe("fromWorkflowRuns", () => {
  it("reports a recent failure", () => {
    expect(fromWorkflowRuns([ci({})], NOW).map((i) => i.key)).toEqual(["ci:1"]);
  });

  it("forgets a failure fixed by a later run", () => {
    const fixed = ci({ databaseId: 2, conclusion: "success", createdAt: "2026-11-11T10:00:00Z" });
    expect(fromWorkflowRuns([fixed, ci({})], NOW)).toEqual([]);
  });

  it("ignores runs still going", () => {
    const going = ci({ databaseId: 2, status: "in_progress", conclusion: "", createdAt: "2026-11-11T10:00:00Z" });
    expect(fromWorkflowRuns([going, ci({})], NOW)).toHaveLength(1);
  });
});

describe("filterInbox", () => {
  const items = applyMarks(
    [
      ...fromGithub([gh("1", "2026-11-09T09:00:00Z", false)]),
      ...fromLinear("org", [linear("n1", "2026-11-11T09:00:00Z")]),
    ],
    {},
  );

  it("keeps unread items only", () => {
    expect(filterInbox(items, { unreadOnly: true, source: null, query: "" }).map((i) => i.key)).toEqual(["linear:n1"]);
  });

  it("keeps one source", () => {
    expect(filterInbox(items, { unreadOnly: false, source: "github", query: "" }).map((i) => i.key)).toEqual([
      "github:1",
    ]);
  });

  it("matches the query on the context too", () => {
    expect(filterInbox(items, { unreadOnly: false, source: null, query: "eng-1" })).toHaveLength(1);
  });
});
