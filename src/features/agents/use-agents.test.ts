import { beforeEach, describe, expect, it, vi } from "vitest";
import { gitBackend } from "@/lib/tauri-git";
import { useAgentsStore } from "@/stores/agents-store";
import { startAgentRun } from "./use-agents";

vi.mock("@/lib/tauri-git", () => ({ gitBackend: { startAgentRun: vi.fn().mockResolvedValue("run-1") } }));
const start = vi.mocked(gitBackend.startAgentRun);
const settingsOf = () => start.mock.calls[0][5];

describe("agent run settings", () => {
  beforeEach(() => {
    start.mockClear();
    useAgentsStore.setState({ runs: [], runSettings: { mode: "auto", model: "opus", effort: "high" } });
  });

  it("uses the composer's mode for a free request", async () => {
    await startAgentRun("/r", "claude", { kind: "custom", prompt: "fix it" }, "fix it");
    expect(settingsOf()).toEqual({ mode: "auto", model: "opus", effort: "high", images: [] });
  });

  it("sends the message's images with the run", async () => {
    await startAgentRun("/r", "claude", { kind: "custom", prompt: "see" }, "see", undefined, ["/a/x.png"]);
    expect(settingsOf()?.images).toEqual(["/a/x.png"]);
  });

  it("always reads for a ready-made task, whatever the composer says", async () => {
    await startAgentRun("/r", "claude", { kind: "commit-message" }, "msg");
    expect(settingsOf()?.mode).toBe("plan");
  });
});
