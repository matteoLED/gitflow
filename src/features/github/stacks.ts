import type { PullRequest } from "@/types/git";

/**
 * Stacked pull requests: a PR whose base branch is another PR's head (in the same state, open by default) sits
 * on top of it.
 * A stack is listed bottom → top, the bottom one being based on a real branch (main…).
 */
export function buildStacks(prs: PullRequest[], state: PullRequest["state"] = "OPEN"): PullRequest[][] {
  const open = prs.filter((pr) => pr.state === state);
  // A branch name can come back (a merged branch reused): the latest PR on it is the one stacked on.
  const byHead = new Map<string, PullRequest>();
  for (const pr of open) {
    const known = byHead.get(pr.headRefName);
    if (!known || known.updatedAt < pr.updatedAt) byHead.set(pr.headRefName, pr);
  }
  const childrenOf = new Map<number, PullRequest[]>();
  for (const pr of open) {
    const parent = byHead.get(pr.baseRefName);
    if (parent && parent !== pr) childrenOf.set(parent.number, [...(childrenOf.get(parent.number) ?? []), pr]);
  }
  const stacks: PullRequest[][] = [];
  for (const root of open.filter((pr) => !byHead.has(pr.baseRefName))) {
    // Depth-first: a branchy stack still reads bottom → top.
    const chain: PullRequest[] = [];
    const walk = (pr: PullRequest) => {
      chain.push(pr);
      (childrenOf.get(pr.number) ?? []).forEach(walk);
    };
    walk(root);
    if (chain.length > 1) stacks.push(chain);
  }
  return stacks;
}

/** The stack a PR belongs to, top first (as Linear shows it), or null when it stands alone. */
export function stackOf(prs: PullRequest[], number: number): PullRequest[] | null {
  const stack = buildStacks(prs).find((s) => s.some((pr) => pr.number === number));
  return stack ? [...stack].reverse() : null;
}
