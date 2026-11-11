import { describe, expect, it } from "vitest";
import { findRefs, parseRefHref, refHref, rehypeRefs, type KnownRefs } from "./ref-links";

const HASH = "3f9a2c1e7b4d5a6f8e9c0b1a2d3e4f5a6b7c8d9e";
const known: KnownRefs = { prs: new Set([42, 1042]), teams: new Set(["MNT"]), commits: [HASH] };
const refs = (text: string) => findRefs(text, known).filter((s) => typeof s !== "string");

describe("findRefs", () => {
  it("links a known pull request", () => {
    expect(findRefs("see #42 now", known)).toEqual(["see ", { text: "#42", ref: { kind: "pr", number: 42 } }, " now"]);
  });

  it("finds an issue of a known team", () => {
    expect(refs("Fixes MNT-820.")).toEqual([{ text: "MNT-820", ref: { kind: "issue", id: "MNT-820" } }]);
  });

  it("finds a commit by a short or full hash", () => {
    expect(refs(`in 3f9a2c1 and ${HASH}`).map((s) => s.text)).toEqual(["3f9a2c1", HASH]);
  });

  it.each([
    ["UTF-8 and ISO-8601"],
    ["color: #fff; #a1b2c3"],
    ["#7 is not a known PR"],
    ["https://github.com/o/r/commit/3f9a2c1e7b"],
    ["https://example.com/?sha=3f9a2c1e7b#42"],
    ["path/to/MNT-820/file"],
    ["deadbeef1 unknown hash"],
    ["1234567 is a number"],
    ["x#42 or MNT-820x or 3f9a2c1-z"],
    ["&#42; entity"],
  ])("ignores look-alikes in %s", (text) => {
    expect(refs(text)).toEqual([]);
  });

  it("leaves text without references whole", () => {
    expect(findRefs("plain", known)).toEqual(["plain"]);
  });
});

describe("ref hrefs", () => {
  it("round-trips a reference", () => {
    expect(parseRefHref(refHref({ kind: "issue", id: "MNT-1" }))).toEqual({ kind: "issue", id: "MNT-1" });
  });

  it("rejects other links", () => {
    expect(parseRefHref("https://github.com")).toBeNull();
  });
});

describe("rehypeRefs", () => {
  it("skips code and existing links", () => {
    const tree = {
      type: "root",
      children: [
        { type: "element", tagName: "code", children: [{ type: "text", value: "#42" }] },
        { type: "element", tagName: "p", children: [{ type: "text", value: "#42" }] },
      ],
    };
    rehypeRefs(known)()(tree);
    expect(JSON.stringify(tree).match(/gitflow-ref:/g)).toHaveLength(1);
  });
});
