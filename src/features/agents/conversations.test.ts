import { describe, expect, it } from "vitest";
import type { AgentRun } from "@/stores/agents-store";
import { conversationsOf } from "./AssistantPanel";

const run = (r: Partial<AgentRun>): AgentRun => ({
  id: "x",
  repoPath: "/repo",
  agent: "claude",
  task: { kind: "custom", prompt: "hi" },
  title: "",
  status: "done",
  steps: [],
  startedAt: "2026-11-10T10:00:00Z",
  sessionId: null,
  thread: "x",
  ...r,
});

describe("conversationsOf", () => {
  it("lists one entry per thread of the repository, titled by its first message, latest first", () => {
    const list = conversationsOf(
      [
        run({ id: "a", thread: "a", title: "first", startedAt: "2026-11-10T09:00:00Z" }),
        run({ id: "a2", thread: "a", title: "follow-up", startedAt: "2026-11-10T12:00:00Z" }),
        run({ id: "b", thread: "b", title: "other", startedAt: "2026-11-10T11:00:00Z" }),
        run({ id: "c", thread: "c", repoPath: "/elsewhere" }),
      ],
      "/repo",
    );
    expect(list.map((c) => [c.thread, c.title])).toEqual([
      ["a", "first"],
      ["b", "other"],
    ]);
  });
});
