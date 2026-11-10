import type { LinearIssue, LocalBranch, PullRequest, RemoteBranch, WorkflowRun } from "@/types/git";

/** Where a piece of work stands, from first commit to merge — the sections of the Work page, in order. */
export type WorkStatus = "changes" | "review" | "approved" | "draft" | "progress" | "merged" | "stale";
export const WORK_STATUSES: WorkStatus[] = ["changes", "review", "approved", "draft", "progress", "stale", "merged"];

export type CiState = "success" | "failure" | "running";

/** One branch of work: the local branch, its pull request, its CI and its Linear issue — whichever exist. */
export type WorkItem = {
  key: string;
  branch: string;
  local: LocalBranch | null;
  /** The same branch on GitHub (`origin`), when it's there. */
  remote: RemoteBranch | null;
  pr: PullRequest | null;
  /** "MNT-936", read from the branch name. */
  issueId: string | null;
  issue: LinearIssue | null;
  ci: CiState | null;
  status: WorkStatus;
  current: boolean;
  updatedAt: string;
  title: string;
};

/** A branch without a commit for that long, and no open pull request, is stale. */
const STALE_MS = 30 * 86_400_000;

/** "mat/mnt-936-fix-coach" → "MNT-936" (Linear's branch names put the issue id first). */
export function issueIdOf(branch: string): string | null {
  // At the start of the name or of a path segment only: "backup/before-rebase-1106" isn't an issue.
  const match = /(?:^|\/)([a-z][a-z0-9]{1,9})-(\d{1,6})(?=$|[/_-])/i.exec(branch);
  return match ? `${match[1].toUpperCase()}-${match[2]}` : null;
}

/** The latest run of each branch (runs come newest first). */
function ciOf(runs: WorkflowRun[]): Map<string, CiState> {
  const states = new Map<string, CiState>();
  for (const run of runs) {
    if (states.has(run.headBranch)) continue;
    states.set(
      run.headBranch,
      run.status !== "completed"
        ? "running"
        : run.conclusion === "success" || run.conclusion === "skipped" || run.conclusion === "neutral"
          ? "success"
          : "failure",
    );
  }
  return states;
}

function statusOf(pr: PullRequest | null, local: LocalBranch | null, lastCommit: string, now: number): WorkStatus {
  if (pr?.state === "MERGED" || pr?.state === "CLOSED") return "merged";
  if (pr?.isDraft) return "draft";
  if (pr?.reviewDecision === "CHANGES_REQUESTED") return "changes";
  if (pr?.reviewDecision === "APPROVED") return "approved";
  if (pr) return "review";
  const old = lastCommit && now - new Date(lastCommit).getTime() > STALE_MS;
  return local?.upstreamGone || old ? "stale" : "progress";
}

type Sources = {
  branches: LocalBranch[];
  /** Branches on the remotes; only `origin`'s (or the only remote's) count. */
  remotes?: RemoteBranch[];
  pullRequests: PullRequest[];
  runs: WorkflowRun[];
  issues: LinearIssue[];
  head: string | null;
  now?: number;
};

/**
 * Every local branch, every branch on GitHub and every open pull request, merged by branch name. Merged pull
 * requests show only while a branch of theirs remains (to clean up). The default branch isn't work: it's left out.
 */
export function workItems({
  branches,
  remotes = [],
  pullRequests,
  runs,
  issues,
  head,
  now = Date.now(),
}: Sources): WorkItem[] {
  const ci = ciOf(runs);
  const byIssue = new Map(issues.map((i) => [i.identifier.toUpperCase(), i]));
  // An open pull request wins over an older merged one of the same branch.
  const prs = new Map<string, PullRequest>();
  for (const pr of pullRequests) {
    const known = prs.get(pr.headRefName);
    if (!known || (known.state !== "OPEN" && pr.state === "OPEN")) prs.set(pr.headRefName, pr);
  }
  const locals = new Map(branches.map((b) => [b.name, b]));
  const origin = remotes.some((r) => r.remote === "origin") ? "origin" : remotes[0]?.remote;
  const onGithub = new Map(remotes.filter((r) => r.remote === origin).map((r) => [r.name, r]));
  const names = new Set([
    ...branches.map((b) => b.name),
    ...onGithub.keys(),
    ...[...prs.values()].filter((pr) => pr.state === "OPEN").map((pr) => pr.headRefName),
  ]);
  const bases = new Set(pullRequests.map((pr) => pr.baseRefName));
  return [...names]
    .filter(
      (name) => !(["main", "master", "develop", "development"].includes(name) || (bases.has(name) && !prs.has(name))),
    )
    .map((name) => {
      const local = locals.get(name) ?? null;
      const remote = onGithub.get(name) ?? null;
      const pr = prs.get(name) ?? null;
      const lastCommit = [local?.committedAt, remote?.committedAt].filter(Boolean).sort().at(-1) ?? "";
      const issueId = issueIdOf(name);
      const issue = (issueId && byIssue.get(issueId)) || issues.find((i) => i.branchName === name) || null;
      const updatedAt = [pr?.updatedAt, lastCommit].filter(Boolean).sort().at(-1) ?? "";
      return {
        key: name,
        branch: name,
        local,
        remote,
        pr,
        issueId: issue?.identifier ?? issueId,
        issue,
        ci: ci.get(name) ?? null,
        status: statusOf(pr, local, lastCommit, now),
        current: name === head,
        updatedAt,
        title: pr?.title ?? issue?.title ?? local?.subject ?? name,
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
