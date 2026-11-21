import { describe, expect, it } from "vitest";
import { parseProposal } from "./IssueProposal";

describe("parseProposal", () => {
  it("reads a proposed issue", () => {
    expect(parseProposal('{"title":" Fix login ","description":"Steps"}')).toEqual({
      title: "Fix login",
      description: "Steps",
    });
  });
  it("accepts a description written with real line breaks", () => {
    expect(parseProposal('{"title": "Bug", "description": "** Problème\n\nUn coach\tpublic"}')?.description).toBe(
      "** Problème\n\nUn coach\tpublic",
    );
  });
  it("waits for a block still streaming in", () => {
    expect(parseProposal('{"title":"Fix')).toBeNull();
  });
  it("needs a title", () => {
    expect(parseProposal('{"description":"x"}')).toBeNull();
  });
});
