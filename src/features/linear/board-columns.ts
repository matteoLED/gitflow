import type { LinearState, LinearTeamStates } from "@/types/git";

const TYPE_ORDER: LinearState["type"][] = ["triage", "backlog", "unstarted", "started", "completed", "canceled"];

export type ColumnKey = { type: LinearState["type"]; name: string };
export type BoardColumn<T> = ColumnKey & { key: string; color: string; items: T[] };

export const columnKey = (s: ColumnKey) => `${s.type}:${s.name.toLowerCase()}`;

type BoardIssue = { state: LinearState; team: { id: string } };

/**
 * Linear's columns: every workflow state of the teams on the board (Triage only when it holds something),
 * merged by name across teams, in Linear's order. States the teams don't list still get a column.
 */
export function boardColumns<T extends BoardIssue>(
  issues: T[],
  teams: LinearTeamStates[] | undefined,
  extraTeams: string[] = [],
): BoardColumn<T>[] {
  const teamIds = new Set([...issues.map((i) => i.team.id), ...extraTeams]);
  const states: LinearState[] = [
    ...(teams ?? []).filter((t) => teamIds.has(t.id)).flatMap((t) => t.states.nodes),
    ...issues.map((i) => i.state),
  ];
  const columns = new Map<string, BoardColumn<T> & { position: number }>();
  for (const s of states) {
    const key = columnKey(s);
    const known = columns.get(key);
    if (!known)
      columns.set(key, { key, type: s.type, name: s.name, color: s.color, items: [], position: s.position ?? 99 });
    else known.position = Math.min(known.position, s.position ?? 99);
  }
  for (const issue of issues) columns.get(columnKey(issue.state))?.items.push(issue);
  return [...columns.values()]
    .filter((c) => c.type !== "triage" || c.items.length > 0)
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.position - b.position)
    .map(({ key, type, name, color, items }) => ({ key, type, name, color, items }));
}
