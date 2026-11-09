import { describe, expect, it } from "vitest";
import { boardColumns } from "./board-columns";

const state = (id: string, name: string, type: "backlog" | "started" | "completed" | "triage", position: number) => ({
  id,
  name,
  type,
  color: "#fff",
  position,
});
const teams = [
  {
    id: "t1",
    key: "MNT",
    name: "Mntal",
    states: {
      nodes: [
        state("a", "Done", "completed", 0),
        state("b", "In Review", "started", 2),
        state("c", "In Progress", "started", 1),
        state("d", "Backlog", "backlog", 0),
        state("e", "Triage", "triage", 0),
      ],
    },
  },
];
const issue = (s: ReturnType<typeof state>) => ({ state: s, team: { id: "t1" } });

describe("boardColumns", () => {
  it("lists every state of the team in Linear's order", () => {
    expect(boardColumns([], teams, ["t1"]).map((c) => c.name)).toEqual(["Backlog", "In Progress", "In Review", "Done"]);
  });
  it("puts an issue in its own state's column", () => {
    const columns = boardColumns([issue(state("b", "In Review", "started", 2))], teams);
    expect(columns.find((c) => c.name === "In Review")?.items).toHaveLength(1);
  });
  it("shows Triage once it holds an issue", () => {
    expect(boardColumns([issue(state("e", "Triage", "triage", 0))], teams)[0].name).toBe("Triage");
  });
});
