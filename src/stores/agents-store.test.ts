import { beforeEach, describe, expect, it } from "vitest";
import { finalAnswer, useAgentsStore } from "./agents-store";

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

  it("never revives a finished run that had the same id", () => {
    const run = { id: "run-1", repoPath: "/r", agent: "claude" as const, task: null, startedAt: "t", thread: "run-1" };
    state().addRun({ ...run, title: "old" });
    state().applyEvent({ type: "finished", runId: "run-1", status: "done" });
    state().addRun({ ...run, title: "new" });
    expect(state().runs.map((r) => [r.title, r.status])).toEqual([["new", "running"]]);
  });
});
