import { useCommits, usePullRequests } from "@/lib/git-queries";
import { useWorkspaceIssues } from "@/features/linear/linear-queries";
import type { KnownRefs } from "./ref-links";

/** What free text may link to: listed pull requests, teams of the user's issues, the loaded HEAD history. */
export function useKnownRefs(repoPath: string) {
  const prs = usePullRequests(repoPath).data ?? [];
  const issues = useWorkspaceIssues().data ?? [];
  const commits = useCommits(repoPath, null).data?.pages.flat() ?? [];
  const known: KnownRefs = {
    prs: new Set(prs.map((p) => p.number)),
    teams: new Set(issues.map((i) => i.team.key)),
    commits: commits.map((c) => c.hash),
  };
  return { known, prs, issues, commits };
}
