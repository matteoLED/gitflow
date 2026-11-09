import { describe, expect, it } from "vitest";
import { resolveTheme, themeTokens } from "./themes";

describe("themes", () => {
  it("draws overlays in black ink on light themes", () => {
    expect(themeTokens("light", "standard")["--color-white"]).toBe("#000000");
  });
  it("follows the OS scheme for the system choice", () => {
    expect(resolveTheme("system", false)).toBe("light");
  });
  it("raises text contrast at max", () => {
    expect(themeTokens("dark", "max")["--foreground"]).toBe("#ffffff");
  });
});

describe("theme-specific standard", () => {
  it("keeps the theme's own border at standard contrast", () => {
    expect(themeTokens("noir", "standard")["--border"]).toBe("#232326");
  });
  it("lets other contrast levels override it", () => {
    expect(themeTokens("noir", "max")["--border"]).toBe("#4b4c55");
  });
});
