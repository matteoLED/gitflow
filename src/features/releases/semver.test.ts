import { describe, expect, it } from "vitest";
import { bumpVersion, latestVersionTag, nextVersions } from "./semver";

describe("bumpVersion", () => {
  it("bumps the patch", () => expect(bumpVersion("v1.2.3", "patch")).toBe("v1.2.4"));
  it("resets the patch on a minor bump", () => expect(bumpVersion("v1.2.3", "minor")).toBe("v1.3.0"));
  it("resets minor and patch on a major bump", () => expect(bumpVersion("1.2.3", "major")).toBe("2.0.0"));
  it("releases a prerelease on a patch bump", () => expect(bumpVersion("v1.3.0-rc.1", "patch")).toBe("v1.3.0"));
  it("reads a missing patch as 0", () => expect(bumpVersion("v2.1", "patch")).toBe("v2.1.1"));
  it("refuses non-semver tags", () => expect(bumpVersion("release-2024", "patch")).toBeNull());
});

describe("latestVersionTag", () => {
  it("compares numerically, not as text", () => expect(latestVersionTag(["v1.9.0", "v1.10.0"])).toBe("v1.10.0"));
  it("prefers a release over its prerelease", () => expect(latestVersionTag(["v2.0.0-rc.1", "v2.0.0"])).toBe("v2.0.0"));
  it("ignores non-semver tags", () => expect(latestVersionTag(["nightly", "v0.3.0"])).toBe("v0.3.0"));
  it("is null without a version tag", () => expect(latestVersionTag(["nightly"])).toBeNull());
});

describe("nextVersions", () => {
  it("starts from v0.0.0 without tags", () =>
    expect(nextVersions([])).toEqual({ patch: "v0.0.1", minor: "v0.1.0", major: "v1.0.0" }));
});
