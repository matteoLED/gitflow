import type { LinearState, LinearWorkflowState, PullRequest } from "@/types/git";

/** Issue identifiers ("MNT-940") named in a branch or a title, for the given team keys; case-insensitive. */
export function linkedIdentifiers(texts: string[], teamKeys: string[]): string[] {
  const keys = teamKeys.filter((k) => /^[a-z0-9]+$/i.test(k));
  if (keys.length === 0) return [];
  const pattern = new RegExp(`(?<![a-z0-9])(${keys.join("|")})-(\\d+)`, "gi");
  const found = texts.flatMap((text) => [...text.matchAll(pattern)].map((m) => `${m[1].toUpperCase()}-${m[2]}`));
  return [...new Set(found)];
}

/** The pull request number of a GitHub link, when it points into the repository at `webUrl`. */
export function pullNumberOf(url: string, webUrl: string | null | undefined): number | null {
  if (!webUrl) return null;
  const match = url.match(/^(https?:\/\/[^?#]+?)\/pull\/(\d+)(?:[/?#]|$)/i);
  const base = (s: string) =>
    s
      .toLowerCase()
      .replace(/^http:/, "https:")
      .replace(/(\.git)?\/*$/, "");
  return match && base(match[1]) === base(webUrl) ? Number(match[2]) : null;
}

export type PrStatus = "DRAFT" | "OPEN" | "MERGED" | "CLOSED";
export type PrMove = "opened" | "merged";

export const prStatus = (pr: Pick<PullRequest, "state" | "isDraft">): PrStatus =>
  pr.state === "OPEN" && pr.isDraft ? "DRAFT" : pr.state;

/** Pull requests that became ready for review or merged since the previous look at the list. */
export function prTransitions<T extends Pick<PullRequest, "number" | "state" | "isDraft">>(
  previous: Record<number, PrStatus>,
  prs: T[],
): { pr: T; move: PrMove }[] {
  return prs.flatMap<{ pr: T; move: PrMove }>((pr) => {
    const now = prStatus(pr);
    if (previous[pr.number] === now) return [];
    if (now === "OPEN") return [{ pr, move: "opened" }];
    if (now === "MERGED") return [{ pr, move: "merged" }];
    return [];
  });
}

const RANK: Record<LinearState["type"], number> = {
  triage: 0,
  backlog: 1,
  unstarted: 2,
  started: 3,
  completed: 4,
  canceled: 4,
};

/**
 * Where a pull request moves its issue: an opened one to the team's started "…Review…" state, a merged one to its
 * first completed state. Null when there is none, or when it would not be a step forward.
 */
export function forwardState(
  current: LinearState,
  states: LinearWorkflowState[],
  move: PrMove,
): LinearWorkflowState | null {
  if (current.type === "completed" || current.type === "canceled") return null;
  const sorted = [...states].sort((a, b) => a.position - b.position);
  const target =
    move === "merged"
      ? sorted.find((s) => s.type === "completed")
      : sorted.find((s) => s.type === "started" && /review/i.test(s.name));
  if (!target || target.id === current.id) return null;
  const rank = RANK[current.type] ?? 0;
  if (rank > RANK[target.type]) return null;
  if (rank === RANK[target.type] && (current.position ?? -Infinity) >= target.position) return null;
  return target;
}
