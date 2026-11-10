import { describe, expect, it } from "vitest";
import type { RebaseStep } from "@/types/git";
import { isUnchanged, moveStep, stepsError, toBackend } from "./rebase-steps";

const step = (hash: string, action: RebaseStep["action"] = "pick", message: string | null = null): RebaseStep => ({
  hash,
  action,
  message,
});
const commit = (hash: string) => ({ hash, subject: hash, message: hash, author: "a", authoredAt: "" });

describe("rebase steps", () => {
  it("moves a step down", () => {
    expect(moveStep([step("a"), step("b"), step("c")], 0, 2).map((s) => s.hash)).toEqual(["b", "c", "a"]);
  });

  it("ignores moves past the ends", () => {
    const steps = [step("a"), step("b")];
    expect(moveStep(steps, 0, -1)).toBe(steps);
  });

  it("refuses squashing the first kept commit", () => {
    expect(stepsError([step("a", "drop"), step("b", "squash")])).toBe("rebase.errorFirstSquash");
  });

  it("refuses dropping everything", () => {
    expect(stepsError([step("a", "drop")])).toBe("rebase.errorAllDropped");
  });

  it("refuses an empty reword", () => {
    expect(stepsError([step("a", "reword", "  ")])).toBe("rebase.errorEmptyMessage");
  });

  it("accepts a squash after a pick", () => {
    expect(stepsError([step("a"), step("b", "squash")])).toBeNull();
  });

  it("sees a reorder as a change", () => {
    expect(isUnchanged([step("b"), step("a")], [commit("a"), commit("b")])).toBe(false);
  });

  it("only sends messages for rewords", () => {
    expect(toBackend([step("a", "pick", "kept from an earlier reword")])[0].message).toBeNull();
  });
});
