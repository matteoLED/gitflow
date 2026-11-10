import { describe, expect, it } from "vitest";
import { parseAnsi, stripAnsi } from "./ansi";

describe("parseAnsi", () => {
  it("styles each run with its colors until a reset", () => {
    expect(parseAnsi("\x1b[41;1m FAIL \x1b[0m src/a.test.ts \x1b[32m2ms\x1b[39m")).toEqual([
      { text: " FAIL ", bg: 1, bold: true },
      { text: " src/a.test.ts " },
      { text: "2ms", fg: 2 },
    ]);
  });

  it("skips 256-color parameters instead of reading them as codes", () => {
    expect(parseAnsi("\x1b[38;5;31mx")).toEqual([{ text: "x" }]);
  });

  it("strips every escape for copying", () => {
    expect(stripAnsi("\x1b[2K\x1b[36;1mok\x1b[0m")).toBe("ok");
  });
});
