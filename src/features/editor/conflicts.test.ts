import { describe, expect, it } from "vitest";
import { parseConflicts, resolution } from "./conflicts";

const FILE = ["a", "<<<<<<< HEAD", "mine", "=======", "theirs 1", "theirs 2", ">>>>>>> feature", "z", ""].join("\n");

describe("parseConflicts", () => {
  it("reads both sides and their labels", () => {
    expect(parseConflicts(FILE)).toMatchObject([
      { ours: "mine", theirs: "theirs 1\ntheirs 2", oursLabel: "HEAD", theirsLabel: "feature", base: null },
    ]);
  });

  it("spans the markers exactly, so replacing the range resolves the conflict", () => {
    const [c] = parseConflicts(FILE);
    expect(FILE.slice(0, c.from) + resolution(c, "theirs") + FILE.slice(c.to)).toBe("a\ntheirs 1\ntheirs 2\nz\n");
  });

  it("keeps the base of a diff3 conflict apart", () => {
    const [c] = parseConflicts("<<<<<<< a\nx\n||||||| base\nb\n=======\ny\n>>>>>>> c\n");
    expect([c.ours, c.base, c.theirs]).toEqual(["x", "b", "y"]);
  });

  it("keeps both sides, ours first", () => {
    expect(resolution(parseConflicts(FILE)[0], "both")).toBe("mine\ntheirs 1\ntheirs 2\n");
  });
});
