import { describe, expect, it } from "vitest";
import { formatSize, specialPatch } from "./special-patch";

const SUBMODULE = `diff --git a/lib b/lib
index 5af578a..4c37751 160000
--- a/lib
+++ b/lib
@@ -1 +1 @@
-Subproject commit 5af578ab4b210b76bc1e1ca2c33ab296e9626f83
+Subproject commit 4c37751e517446f03b189c2f41eecce0c4858110-dirty
`;

const LFS = `diff --git a/a.psd b/a.psd
--- a/a.psd
+++ b/a.psd
@@ -1,3 +1,3 @@
 version https://git-lfs.github.com/spec/v1
-oid sha256:aaa
-size 1024
+oid sha256:bbb
+size 2048
`;

describe("specialPatch", () => {
  it("reads a submodule commit change", () => {
    expect(specialPatch(SUBMODULE)).toEqual({
      kind: "submodule",
      from: "5af578ab4b210b76bc1e1ca2c33ab296e9626f83",
      to: "4c37751e517446f03b189c2f41eecce0c4858110",
      dirty: true,
    });
  });

  it("reads both sizes of an LFS pointer change", () => {
    expect(specialPatch(LFS)).toEqual({ kind: "lfs", oldSize: 1024, newSize: 2048 });
  });

  it("reads a new LFS pointer", () => {
    const added = "@@ -0,0 +1,3 @@\n+version https://git-lfs.github.com/spec/v1\n+oid sha256:a\n+size 5\n";
    expect(specialPatch(added)).toEqual({ kind: "lfs", oldSize: null, newSize: 5 });
  });

  it("leaves ordinary patches alone", () => {
    expect(specialPatch("@@ -1 +1 @@\n-a\n+b\n")).toBeNull();
  });
});

describe("formatSize", () => {
  it("picks a readable unit", () => {
    expect(formatSize(1536, "en")).toBe("1.5 kB");
  });
});
