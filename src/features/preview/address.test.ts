import { describe, expect, it } from "vitest";
import { resolveAddress } from "./PreviewPanel";

describe("resolveAddress", () => {
  it("resolves a path against the running app", () => {
    expect(resolveAddress("/coach/page", "http://localhost:3006/")).toBe("http://localhost:3006/coach/page");
  });
  it("accepts an address typed without its scheme", () => {
    expect(resolveAddress("localhost:5173/x", "http://localhost:3006/")).toBe("http://localhost:5173/x");
  });
  it("ignores an empty address", () => {
    expect(resolveAddress("  ", "http://localhost:3006/")).toBeNull();
  });
});
