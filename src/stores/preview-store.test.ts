import { beforeEach, describe, expect, it } from "vitest";
import { runOf, usePreviewStore } from "./preview-store";

const state = () => usePreviewStore.getState();

describe("preview runs", () => {
  beforeEach(() => usePreviewStore.setState({ runs: {} }));

  it("marks an app that came up inside a monorepo run", () => {
    state().apply({ type: "ready", targetId: "apps/platform#web", url: "http://localhost:5040" });
    expect(runOf(state().runs, "apps/platform#web").inWorkspace).toBe(true);
  });

  it("keeps an app started on its own as ours", () => {
    state().start("apps/platform#web");
    state().apply({ type: "ready", targetId: "apps/platform#web", url: "http://localhost:5040" });
    expect(runOf(state().runs, "apps/platform#web").inWorkspace).toBe(false);
  });
});
