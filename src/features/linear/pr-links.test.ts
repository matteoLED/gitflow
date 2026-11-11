import { describe, expect, it } from "vitest";
import type { LinearWorkflowState } from "@/types/git";
import { forwardState, linkedIdentifiers, prTransitions, pullNumberOf } from "./pr-links";

describe("linkedIdentifiers", () => {
  it("finds the issue in a Linear branch name, case-insensitively", () => {
    expect(linkedIdentifiers(["mat/mnt-940-fix-login"], ["MNT"])).toEqual(["MNT-940"]);
  });
  it("finds issues in the title too, once each", () => {
    expect(linkedIdentifiers(["mnt-940-x", "MNT-940 and ENG-12: fix"], ["MNT", "ENG"])).toEqual(["MNT-940", "ENG-12"]);
  });
  it("ignores keys of teams that aren't connected", () => {
    expect(linkedIdentifiers(["utf-8 and abc-12"], ["MNT"])).toEqual([]);
  });
  it("doesn't match a key inside a longer word", () => {
    expect(linkedIdentifiers(["xmnt-940"], ["MNT"])).toEqual([]);
  });
});

describe("pullNumberOf", () => {
  it("reads a pull request of the repository", () => {
    expect(pullNumberOf("https://github.com/Acme/App/pull/42/files", "https://github.com/acme/app")).toBe(42);
  });
  it("ignores another repository", () => {
    expect(pullNumberOf("https://github.com/acme/other/pull/42", "https://github.com/acme/app")).toBeNull();
  });
});

describe("prTransitions", () => {
  const pr = (number: number, state: "OPEN" | "MERGED" | "CLOSED", isDraft = false) => ({ number, state, isDraft });
  it("reports a new ready pull request and a merge, not a draft", () => {
    const moves = prTransitions({ 2: "OPEN" }, [pr(1, "OPEN"), pr(2, "MERGED"), pr(3, "OPEN", true)]);
    expect(moves.map((m) => [m.pr.number, m.move])).toEqual([
      [1, "opened"],
      [2, "merged"],
    ]);
  });
  it("reports a draft marked ready", () => {
    expect(prTransitions({ 1: "DRAFT" }, [pr(1, "OPEN")]).map((m) => m.move)).toEqual(["opened"]);
  });
});

describe("forwardState", () => {
  const state = (id: string, name: string, type: LinearWorkflowState["type"], position: number) => ({
    id,
    name,
    type,
    position,
    color: "#000",
  });
  const states = [
    state("todo", "Todo", "unstarted", 1),
    state("prog", "In Progress", "started", 2),
    state("rev", "In Review", "started", 3),
    state("qa", "QA", "started", 4),
    state("done", "Done", "completed", 5),
    state("rel", "Released", "completed", 6),
    state("no", "Canceled", "canceled", 7),
  ];
  it("moves an issue in progress to review", () => {
    expect(forwardState(states[1], states, "opened")?.id).toBe("rev");
  });
  it("never moves an issue back from a later started state", () => {
    expect(forwardState(states[3], states, "opened")).toBeNull();
  });
  it("moves to the first completed state on merge", () => {
    expect(forwardState(states[2], states, "merged")?.id).toBe("done");
  });
  it("leaves completed and canceled issues alone", () => {
    expect([forwardState(states[4], states, "merged"), forwardState(states[6], states, "opened")]).toEqual([
      null,
      null,
    ]);
  });
  it("skips when the team has no review state", () => {
    expect(
      forwardState(
        states[0],
        states.filter((s) => s.id !== "rev"),
        "opened",
      ),
    ).toBeNull();
  });
});
