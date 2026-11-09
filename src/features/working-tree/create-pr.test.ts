import { describe, expect, it } from "vitest";
import { titleFromBranch } from "./CreatePullRequest";

describe("titleFromBranch", () => {
  it("drops the owner prefix and turns dashes into words", () => {
    expect(titleFromBranch("mat/fix-email-failed-count")).toBe("Fix email failed count");
  });
});
