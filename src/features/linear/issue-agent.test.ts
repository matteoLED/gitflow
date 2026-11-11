import { describe, expect, it } from "vitest";
import { issuePrompt } from "./issue-agent";

const issue = {
  id: "i1",
  identifier: "ENG-1",
  title: "Fix login",
  description: "It breaks.",
  branchName: "mat/eng-1-fix-login",
  labels: { nodes: [{ name: "bug" }] },
};

describe("issuePrompt", () => {
  it("tells the agent to work on the issue's branch in its worktree", () => {
    expect(issuePrompt(issue)).toContain("isolated worktree, on a branch made for this issue");
  });

  it("names Linear's branch", () => {
    expect(issuePrompt(issue)).toContain("`mat/eng-1-fix-login`");
  });

  it("includes the description and labels", () => {
    expect(issuePrompt(issue)).toMatch(/It breaks\.[\s\S]*Labels: bug\./);
  });

  it("leaves out what Linear doesn't have", () => {
    expect(issuePrompt({ ...issue, description: null, labels: undefined })).not.toMatch(/Description|Labels/);
  });
});
