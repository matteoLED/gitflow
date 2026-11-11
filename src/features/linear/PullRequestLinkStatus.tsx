import { useQuery } from "@tanstack/react-query";
import { CircleX, GitMerge, GitPullRequest, GitPullRequestDraft, ListChecks } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { checkOutcome } from "@/features/github/ChecksMenu";
import { useT } from "@/i18n";
import { useGithubWebUrl } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import type { PullRequestDetails } from "@/types/git";
import { pullNumberOf } from "./pr-links";

function StateLabel({ pr }: { pr: PullRequestDetails }) {
  const t = useT();
  const [Icon, color, label] =
    pr.state === "MERGED"
      ? [GitMerge, "text-merged", t("pr.merged")]
      : pr.state === "CLOSED"
        ? [CircleX, "text-removed-foreground", t("pr.closed")]
        : pr.isDraft
          ? [GitPullRequestDraft, "text-muted-foreground", t("pr.draft")]
          : [GitPullRequest, "text-added-foreground", t("pr.open")];
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground">
      <Icon aria-hidden className={cn("size-3.5", color)} />
      {label}
    </span>
  );
}

/** Live state and checks of a linked pull request, when it belongs to the open repository. */
export function PullRequestLinkStatus({ repoPath, url }: { repoPath: string; url: string }) {
  const t = useT();
  const number = pullNumberOf(url, useGithubWebUrl(repoPath).data);
  // Same cache as the pull request page.
  const pr = useQuery({
    queryKey: ["pull-request", repoPath, number],
    queryFn: () => gitBackend.getPullRequestDetails(repoPath, number ?? 0),
    enabled: number !== null,
    staleTime: 30_000,
  }).data;
  if (!pr) return null;
  const checks = pr.statusCheckRollup.filter((c) => checkOutcome(c) !== "skip");
  const passed = checks.filter((c) => checkOutcome(c) === "pass").length;
  const pending = checks.some((c) => checkOutcome(c) === "pending");
  return (
    <>
      {checks.length > 0 && (
        <span className="flex shrink-0 items-center gap-2 rounded-full px-2.5 py-1 text-[13px] tabular-nums">
          {pending ? (
            <BrailleLoader className="text-primary" />
          ) : (
            <ListChecks
              aria-hidden
              className={cn("size-4", passed === checks.length ? "text-check-passed" : "text-check-failed")}
            />
          )}
          {t("pr.checksPassed", { passed, total: checks.length })}
        </span>
      )}
      <StateLabel pr={pr} />
    </>
  );
}
