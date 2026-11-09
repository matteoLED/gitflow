import { describe, expect, it } from "vitest";
import type { PullRequest } from "@/types/git";
import { buildStacks, stackOf } from "./stacks";

const pr = (number: number, head: string, base: string): PullRequest => ({
  number,
  title: `PR ${number}`,
  author: { login: "a" },
  headRefName: head,
  baseRefName: base,
  headRefOid: "abc",
  isDraft: false,
  updatedAt: "2026-01-01T00:00:00Z",
  reviewDecision: null,
  state: "OPEN",
  url: "u",
});

const PRS = [pr(1731, "mnt-820", "mnt-819"), pr(1729, "mnt-819", "main"), pr(1671, "mnt-897", "main")];

describe("stacked pull requests", () => {
  it("chains a PR onto the PR whose branch it targets", () => {
    expect(buildStacks(PRS).map((s) => s.map((p) => p.number))).toEqual([[1729, 1731]]);
  });

  it("leaves standalone PRs out of stacks", () => {
    expect(stackOf(PRS, 1671)).toBeNull();
  });

  it("lists a stack top first", () => {
    expect(stackOf(PRS, 1729)?.map((p) => p.number)).toEqual([1731, 1729]);
  });
});
