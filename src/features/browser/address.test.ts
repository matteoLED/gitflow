import { describe, expect, it } from "vitest";
import { displayUrl, toWebAddress } from "./address";

describe("toWebAddress", () => {
  it("keeps a full address", () => {
    expect(toWebAddress("https://linear.app/x")).toBe("https://linear.app/x");
  });
  it("adds https to a bare domain", () => {
    expect(toWebAddress("github.com/matteoLED")).toBe("https://github.com/matteoLED");
  });
  it("uses http for a local server", () => {
    expect(toWebAddress("localhost:3006/page")).toBe("http://localhost:3006/page");
  });
  it("searches anything else", () => {
    expect(toWebAddress("tauri cef")).toBe("https://www.google.com/search?q=tauri%20cef");
  });
  it("shows addresses without scheme or www", () => {
    expect(displayUrl("https://www.alan.com/")).toBe("alan.com");
  });
});
