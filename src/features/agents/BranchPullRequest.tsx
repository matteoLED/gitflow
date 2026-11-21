import { CircleX, GitMerge, GitPullRequest, GitPullRequestDraft } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { useOpenPullRequest } from "@/features/github/PullRequestList";
import { usePullRequests } from "@/lib/git-queries";
import { cn } from "@/lib/utils";

/** The pull request opened from an agent's branch, opened on its page in the app. */
export function BranchPullRequest({ repoPath, branch }: { repoPath: string; branch: string }) {
  const pr = usePullRequests(repoPath).data?.find((p) => p.headRefName === branch);
  const { open, loading } = useOpenPullRequest(repoPath);
  if (!pr) return null;
  const [Icon, color] =
    pr.state === "MERGED"
      ? [GitMerge, "text-merged"]
      : pr.state === "CLOSED"
        ? [CircleX, "text-removed-foreground"]
        : pr.isDraft
          ? [GitPullRequestDraft, "text-muted-foreground"]
          : [GitPullRequest, "text-added-foreground"];
  return (
    <button
      type="button"
      onClick={() => void open(pr)}
      title={`#${pr.number} ${pr.title}`}
      className="flex h-6 max-w-72 min-w-0 shrink items-center gap-1.5 rounded-md px-2 text-[12px] outline-none hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-ring"
    >
      {loading !== null ? (
        <BrailleLoader className="text-primary" />
      ) : (
        <Icon aria-hidden className={cn("size-3.5 shrink-0", color)} />
      )}
      <span className="shrink-0 text-muted-foreground tabular-nums">#{pr.number}</span>
      <span className="min-w-0 truncate">{pr.title}</span>
    </button>
  );
}
