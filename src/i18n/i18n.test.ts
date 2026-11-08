import { describe, expect, it } from "vitest";
import { translate, translatePlural } from ".";

describe("i18n", () => {
  it("fills placeholders", () => {
    expect(translate("fr", "branches.switchTo", { name: "main" })).toBe("Basculer sur main");
  });

  it("uses the French singular for zero", () => {
    expect(translatePlural("fr", "files.count", 0)).toBe("0 fichier");
  });

  it("uses the English plural for zero", () => {
    expect(translatePlural("en", "files.count", 0)).toBe("0 Files");
  });
});
