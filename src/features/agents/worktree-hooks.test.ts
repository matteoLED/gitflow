import { describe, expect, it } from "vitest";
import { isHookFailure } from "./use-worktree-actions";

describe("isHookFailure", () => {
  it("recognizes husky refusing a commit", () => {
    expect(isHookFailure("husky - pre-commit script failed (code 1)")).toBe(true);
  });

  it("leaves other git errors alone", () => {
    expect(isHookFailure("Your local changes would be overwritten by merge")).toBe(false);
  });
});
