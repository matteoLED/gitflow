import { beforeEach, describe, expect, it } from "vitest";
import type { AgentStep } from "@/types/git";
import { finalAnswer, unsavedFollowUps, useAgentsStore, type AgentRun } from "./agents-store";

const state = () => useAgentsStore.getState();
const step = (kind: "message" | "result" | "tool", detail: string | null) => ({ kind, title: "", detail, at: null });

describe("agent runs", () => {
  beforeEach(() => useAgentsStore.setState({ runs: [] }));

  it("keeps steps that arrive before the run is registered", () => {
    state().applyEvent({ type: "step", runId: "run-1", step: step("tool", null) });
    state().addRun({
      id: "run-1",
      repoPath: "/r",
      agent: "claude",
      task: null,
      title: "Review",
      startedAt: "t",
      thread: "run-1",
    });
    expect(state().runs[0]).toMatchObject({ title: "Review", steps: [{ kind: "tool" }] });
  });

  it("records how a run ended", () => {
    state().addRun({
      id: "run-1",
      repoPath: "/r",
      agent: "claude",
      task: null,
      title: "x",
      startedAt: "t",
      thread: "run-1",
    });
    state().applyEvent({ type: "finished", runId: "run-1", status: "failed" });
    expect(state().runs[0].status).toBe("failed");
  });

  it("answers with the result text over earlier messages", () => {
    state().addRun({
      id: "run-1",
      repoPath: "/r",
      agent: "claude",
      task: null,
      title: "x",
      startedAt: "t",
      thread: "run-1",
    });
    state().applyEvent({ type: "step", runId: "run-1", step: step("message", "thinking aloud") });
    state().applyEvent({ type: "step", runId: "run-1", step: step("result", "feat: add login") });
    expect(finalAnswer(state().runs[0])).toBe("feat: add login");
  });

  it("keeps the end of a run that finished before it was added", () => {
    state().applyEvent({ type: "finished", runId: "run-2", status: "failed" });
    state().addRun({
      id: "run-2",
      repoPath: "/r",
      agent: "claude",
      task: null,
      startedAt: "t",
      thread: "run-2",
      title: "x",
    });
    expect(state().runs.find((r) => r.id === "run-2")?.status).toBe("failed");
  });

  it("never revives a finished run that had the same id", () => {
    const run = { id: "run-1", repoPath: "/r", agent: "claude" as const, task: null, startedAt: "t", thread: "run-1" };
    state().addRun({ ...run, title: "old" });
    state().applyEvent({ type: "finished", runId: "run-1", status: "done" });
    state().addRun({ ...run, title: "new" });
    expect(state().runs.map((r) => [r.title, r.status])).toEqual([["new", "running"]]);
  });
});

describe("unsavedFollowUps", () => {
  const run = (startedAt: string, status: "done" | "running" = "done") =>
    ({ id: startedAt, startedAt, status }) as unknown as AgentRun;
  const file = [{ kind: "message", title: "", detail: null, at: "2026-11-10T10:05:00Z" }] as AgentStep[];

  it("hides finished follow-ups the session file already holds", () => {
    const runs = [run("2026-11-10T10:00:00Z"), run("2026-11-10T10:10:00Z"), run("2026-11-10T09:00:00Z", "running")];
    expect(unsavedFollowUps(file, runs).map((r) => r.startedAt)).toEqual([
      "2026-11-10T10:10:00Z",
      "2026-11-10T09:00:00Z",
    ]);
  });
});
