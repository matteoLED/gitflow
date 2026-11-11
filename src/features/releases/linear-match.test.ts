import { describe, expect, it } from "vitest";
import { matchLinearRelease } from "./linear-match";

const releases = [{ id: 7, tag_name: "v1.2.0" }];
const tags = [{ name: "v1.2.0" }, { name: "1.3.0" }];

describe("matchLinearRelease", () => {
  it("prefers the GitHub release of the same version, ignoring the v prefix", () => {
    expect(matchLinearRelease({ version: "1.2.0", name: "Spring" }, releases, tags)).toEqual({
      kind: "release",
      id: 7,
    });
  });

  it("falls back to a tag when no GitHub release ships the version", () => {
    expect(matchLinearRelease({ version: "v1.3.0", name: "x" }, releases, tags)).toEqual({
      kind: "tag",
      name: "1.3.0",
    });
  });

  it("uses the name when the Linear release has no version", () => {
    expect(matchLinearRelease({ version: null, name: "V1.2.0" }, [], tags)).toEqual({ kind: "tag", name: "v1.2.0" });
  });

  it("matches nothing for another version", () => {
    expect(matchLinearRelease({ version: "1.2", name: "x" }, releases, tags)).toBeNull();
  });
});
