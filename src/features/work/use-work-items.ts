import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGithubUser, usePullRequests, useRefs } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { useWorkspaceIssues } from "@/features/linear/linear-queries";
import { useAgentsStore } from "@/stores/agents-store";
import { useWorkStore, type WorkFilter } from "@/stores/work-store";
import { inboxItems, unread } from "./inbox";
import { workItems, type WorkItem } from "./work-items";

/** Branches, pull requests, CI and Linear issues of the repository, as one list of work. */
export function useWorkItems(repoPath: string) {
  const refs = useRefs(repoPath);
  const prs = usePullRequests(repoPath);
  const runs = useQuery({
    queryKey: ["workflow-runs", repoPath],
    queryFn: () => gitBackend.listWorkflowRuns(repoPath),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status !== "completed") ? 10_000 : 60_000),
  });
  const issues = useWorkspaceIssues().data;
  const data = useMemo(
    () =>
      refs.data &&
      workItems({
        branches: refs.data.branches,
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
  if (filter === "cleanup") return items.filter((i) => i.local && (i.status === "merged" || i.status === "stale"));
  return items;
}

/** The inbox of the repository: what needs the user, minus what they marked done. */
export function useInbox(repoPath: string) {
  const work = useWorkItems(repoPath).data;
  const me = useGithubUser(repoPath).data?.login ?? null;
  const issues = useWorkspaceIssues().data;
  const runs = useAgentsStore((s) => s.runs);
  const dismissed = useWorkStore((s) => s.dismissed);
  return useMemo(() => {
    if (!work) return undefined;
    const mine = runs.filter((r) => r.repoPath === repoPath);
    return unread(inboxItems({ work, me, issues: issues ?? [], runs: mine }), dismissed);
  }, [work, me, issues, runs, repoPath, dismissed]);
}
