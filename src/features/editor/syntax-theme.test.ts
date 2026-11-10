import { describe, expect, it } from "vitest";
import { resolveScope } from "./syntax-theme";

describe("resolveScope", () => {
  const rules = [
    { scope: "keyword", settings: { foreground: "#111" } },
    { scope: ["keyword.control", "storage"], settings: { foreground: "#222" } },
    { scope: "meta.tag entity.name.tag", settings: { foreground: "#333" } },
  ];

  it("takes the most specific selector covering the scope", () => {
    expect(resolveScope(rules, "keyword.control.import")?.foreground).toBe("#222");
  });

  it("falls back to the parent scope", () => {
    expect(resolveScope(rules, "keyword.operator")?.foreground).toBe("#111");
  });

  it("matches descendant selectors on their last part", () => {
    expect(resolveScope(rules, "entity.name.tag")?.foreground).toBe("#333");
  });
});
