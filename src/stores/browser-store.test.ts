import { describe, expect, it } from "vitest";
import { useBrowserStore } from "./browser-store";

describe("browser store", () => {
  it("keeps a tab's address when the page reports about:blank", () => {
    useBrowserStore.setState({ tabs: [{ id: "a", url: "https://youtube.com/", title: "" }], active: "a" });
    useBrowserStore.getState().apply({ type: "url", id: "a", url: "about:blank" });
    expect(useBrowserStore.getState().tabs[0]?.url).toBe("https://youtube.com/");
  });
});
