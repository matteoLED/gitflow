import { describe, expect, it } from "vitest";
import { worktreeHolding } from "./use-checkout";

describe("worktreeHolding", () => {
  it("reads the worktree from git's refusal", () => {
    expect(worktreeHolding("fatal: 'feat/x' is already used by worktree at '/Users/me/.gitflow/worktrees/r/abc'")).toBe(
      "/Users/me/.gitflow/worktrees/r/abc",
    );
  });
});
