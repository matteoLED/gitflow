import { describe, expect, it } from "vitest";
import { areaOf, layoutGraph } from "./layout";

const nodes = ["a", "b", "c", "d"].map((id) => ({ id, group: id < "c" ? "x" : "y", size: 1 }));
const links = [{ source: "a", target: "b", weight: 5 }];

describe("layoutGraph", () => {
  it("keeps every file in the box", () => {
    const placed = layoutGraph(nodes, links, 1000, 640);
    expect(placed.every((p) => p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 640)).toBe(true);
  });
  it("draws linked files closer than unlinked ones", () => {
    const [a, b, c] = layoutGraph(nodes, links);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(Math.hypot(a.x - c.x, a.y - c.y));
  });
  it("gives the same picture twice", () => {
    expect(layoutGraph(nodes, links)).toEqual(layoutGraph(nodes, links));
  });
});

describe("areaOf", () => {
  it("groups a feature's files", () => {
    expect(areaOf("src/features/linear/LinearBoard.tsx")).toBe("features/linear");
  });
  it("groups a monorepo app's features", () => {
    expect(areaOf("apps/platform/src/features/home/HomePage.tsx")).toBe("platform/home");
  });
  it("groups Rust modules", () => {
    expect(areaOf("src-tauri/src/git/read.rs")).toBe("rust/git");
  });
});
