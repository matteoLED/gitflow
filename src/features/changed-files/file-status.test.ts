import { describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { getT } from "@/i18n";
import { changeMark } from "./file-status";

const modified = (additions: number, deletions: number) => ({ status: "modified" as const, additions, deletions });

describe("changeMark", () => {
  it("is green when lines were only added", () => {
    expect(changeMark(modified(3, 0), getT()).className).toContain("bg-added-foreground");
  });

  it("is red when lines were only removed", () => {
    expect(changeMark(modified(0, 2), getT()).className).toContain("bg-removed-foreground");
  });

  it("is a red and green pill when lines were added and removed", () => {
    expect(changeMark(modified(1, 1), getT()).label).toBe("Modified: lines added and removed");
  });
});

describe("showHistoryOf", () => {
  it("stays in the GitHub view when opening a pull request", () => {
    useWorkspaceStore.setState({ view: "github" });
    useWorkspaceStore.getState().showHistoryOf("origin/main..abc1234", "#12 Fix it");
    expect(useWorkspaceStore.getState().view).toBe("github");
  });

  it("switches to branch history for a plain revision", () => {
    useWorkspaceStore.setState({ view: "github" });
    useWorkspaceStore.getState().showHistoryOf("main");
    expect(useWorkspaceStore.getState().view).toBe("history");
  });
});
