import { describe, expect, it } from "vitest";
import type { LocalBranch, RefsSnapshot } from "@/types/git";
import { branchRows } from "./branch-rows";

const branch = (name: string): LocalBranch => ({ name, upstream: null, upstreamGone: false, ahead: 0, behind: 0, committedAt: "", subject: "" });
const refs = (names: string[], remotes = 0): RefsSnapshot =>
  ({
    head: { branch: "main" },
    branches: [branch("main"), ...names.map(branch)],
    remotes: Array.from({ length: remotes }, (_, i) => ({ remote: "origin", name: `r${i}` })),
    tags: [],
    stashes: [],
  }) as unknown as RefsSnapshot;

describe("branch list rows", () => {
  it("renders nothing of a closed section, however big", () => {
    const rows = branchRows(refs([], 5000), "", new Set());
    expect(rows.filter((r) => r.kind === "rev")).toHaveLength(0);
  });

  it("hides a folded prefix group's branches", () => {
    const rows = branchRows(refs(["mat/a", "mat/b"]), "", new Set(["group:mat"]));
    expect(rows.filter((r) => r.kind === "branch")).toHaveLength(0);
  });

  it("flattens matches when filtering", () => {
    const rows = branchRows(refs(["mat/login", "other"]), "log", new Set());
    expect(rows.filter((r) => r.kind === "branch").map((r) => r.key)).toEqual(["b:mat/login"]);
  });
});
