import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { useGithubUser, usePullRequests, useRefs, workflowRunsQuery } from "@/lib/git-queries";
import { useWorkspaceIssues } from "@/features/linear/linear-queries";
import { useAgentsStore, type AgentRun } from "@/stores/agents-store";
import { useWorkStore, type WorkFilter } from "@/stores/work-store";
import { inboxItems, unread } from "./inbox";
import { workItems, type WorkItem } from "./work-items";

/** Branches, pull requests, CI and Linear issues of the repository, as one list of work. */
export function useWorkItems(repoPath: string) {
  const refs = useRefs(repoPath);
  const prs = usePullRequests(repoPath);
  // The one poller of the workflow runs (see workflowRunsQuery): faster while something is running.
  const runs = useQuery({
    ...workflowRunsQuery(repoPath),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status !== "completed") ? 10_000 : 60_000),
  });
  const issues = useWorkspaceIssues().data;
  const data = useMemo(
    () =>
      refs.data &&
      workItems({
        branches: refs.data.branches,
        remotes: refs.data.remotes,
        // GitHub or Linear unreachable: the branches still show, without what they would add.
        pullRequests: prs.data ?? [],
        runs: runs.data ?? [],
        issues: issues ?? [],
        head: refs.data.head.branch,
      }),
    [refs.data, prs.data, runs.data, issues],
  );
  return { data, error: refs.error, prsError: prs.error, loadingPrs: prs.isPending, refetch: refs.refetch };
}

export function filterWork(items: WorkItem[], filter: WorkFilter): WorkItem[] {
  if (filter === "mine") return items.filter((i) => i.local);
  if (filter === "pulls") return items.filter((i) => i.pr?.state === "OPEN");
  if (filter === "cleanup")
    return items.filter((i) => !i.current && (i.local || i.remote) && (i.status === "merged" || i.status === "stale"));
  return items;
}

/**
 * The latest run of each conversation of the repository, when it has finished: the only runs the inbox shows.
 * Steps streaming into a running run leave this list (and every component reading the inbox) untouched.
 */
function finishedThreads(runs: AgentRun[], repoPath: string) {
  const seen = new Set<string>();
  return runs.filter((r) => {
    if (r.repoPath !== repoPath || seen.has(r.thread)) return false;
    seen.add(r.thread);
    return r.status === "done" || r.status === "failed";
  });
}

/** The inbox of the repository: what needs the user, minus what they marked done. */
export function useInbox(repoPath: string) {
  const work = useWorkItems(repoPath).data;
  const me = useGithubUser(repoPath).data?.login ?? null;
  const issues = useWorkspaceIssues().data;
  const runs = useAgentsStore(useShallow((s) => finishedThreads(s.runs, repoPath)));
  const dismissed = useWorkStore((s) => s.dismissed);
  return useMemo(() => {
    if (!work) return undefined;
    return unread(inboxItems({ work, me, issues: issues ?? [], runs }), dismissed);
  }, [work, me, issues, runs, dismissed]);
}
