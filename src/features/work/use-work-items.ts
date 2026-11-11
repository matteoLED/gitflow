import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePullRequests, useRefs, workflowRunsQuery } from "@/lib/git-queries";
import { useWorkspaceIssues } from "@/features/linear/linear-queries";
import type { WorkFilter } from "@/stores/work-store";
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
