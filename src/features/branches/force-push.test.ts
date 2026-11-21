import { describe, expect, it } from "vitest";
import { isRejectedPush } from "./force-push";

describe("isRejectedPush", () => {
  it("recognizes a push refused after a rebase", () => {
    expect(isRejectedPush(" ! [rejected]        feat -> feat (non-fast-forward)")).toBe(true);
  });

  it("ignores other failures", () => {
    expect(isRejectedPush("Could not resolve host: github.com")).toBe(false);
  });
});
