import { useQuery } from "@tanstack/react-query";
import { CircleX, CornerDownRight, GitMerge, GitPullRequest, GitPullRequestDraft } from "lucide-react";
import { AuthorAvatar } from "@/components/author-avatar";
import { formatAge } from "@/lib/format-date";
import { BrailleLoader } from "@/components/braille-loader";
import { checkOutcome } from "@/features/github/ChecksMenu";
import { useT } from "@/i18n";
import { useGithubWebUrl } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import type { PullRequestDetails } from "@/types/git";
import { useOpenPullRequest } from "@/features/github/PullRequestList";
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

/**
 * The issue's pull request, Linear's "Diffs": its state and title, opened on its page in the app (in the
 * browser when it belongs to another repository).
 */
export function IssuePullRequest({ repoPath, url, title }: { repoPath: string; url: string; title: string }) {
  const number = pullNumberOf(url, useGithubWebUrl(repoPath).data);
  const { open, loading } = useOpenPullRequest(repoPath);
  const pr = useQuery({
    queryKey: ["pull-request", repoPath, number],
    queryFn: () => gitBackend.getPullRequestDetails(repoPath, number ?? 0),
    enabled: number !== null,
    staleTime: 30_000,
  }).data;
  const show = () => {
    if (!pr) return void gitBackend.openGithubUrl(url);
    void open({
      ...pr,
      author: { login: pr.author.login },
      headRefOid: pr.commits.at(-1)?.oid ?? "",
      updatedAt: pr.createdAt,
      reviewDecision: null,
    });
  };
  const [Icon, color] = !pr
    ? [GitPullRequest, "text-muted-foreground"]
    : pr.state === "MERGED"
      ? [GitMerge, "text-merged"]
      : pr.state === "CLOSED"
        ? [CircleX, "text-removed-foreground"]
        : pr.isDraft
          ? [GitPullRequestDraft, "text-muted-foreground"]
          : [GitPullRequest, "text-added-foreground"];
  return (
    <button
      type="button"
      onClick={show}
      title={pr ? `#${pr.number} ${pr.title}` : url}
      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] hover:bg-white/[0.05]"
    >
      {loading !== null ? (
        <BrailleLoader className="text-primary" />
      ) : (
        <Icon aria-hidden className={cn("size-3.5 shrink-0", color)} />
      )}
      <span className="min-w-0 flex-1 truncate">{pr?.title ?? title}</span>
      {pr && <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">#{pr.number}</span>}
    </button>
  );
}

/** A pull request's checks as one segmented bar: passed, failed, still running. */
function ChecksBar({ pr }: { pr: PullRequestDetails }) {
  const t = useT();
  const checks = pr.statusCheckRollup.filter((c) => checkOutcome(c) !== "skip");
  if (checks.length === 0) return <span className="text-[12px] text-muted-foreground">{t("linear.noChecks")}</span>;
  const count = (o: string) => checks.filter((c) => checkOutcome(c) === o).length;
  const [pass, fail, pending] = [count("pass"), count("fail"), count("pending")];
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      <span className="flex h-1.5 w-32 overflow-hidden rounded-full bg-white/[0.06]">
        <span className="bg-check-passed" style={{ width: `${(pass / checks.length) * 100}%` }} />
        <span className="bg-check-failed" style={{ width: `${(fail / checks.length) * 100}%` }} />
        <span className="animate-pulse bg-primary/70" style={{ width: `${(pending / checks.length) * 100}%` }} />
      </span>
      <span className="truncate text-[12px] text-muted-foreground tabular-nums">
        {t("pr.checksPassed", { passed: pass, total: checks.length })}
      </span>
    </span>
  );
}

/**
 * A linked pull request as a card: its state, title and number, who opened it and when, its size, and its checks;
 * a click opens it on its page in the app (in the browser when it belongs to another repository).
 */
export function PullRequestLinkCard({ repoPath, url, title }: { repoPath: string; url: string; title: string }) {
  const t = useT();
  const number = pullNumberOf(url, useGithubWebUrl(repoPath).data);
  const { open, loading } = useOpenPullRequest(repoPath);
  const pr = useQuery({
    queryKey: ["pull-request", repoPath, number],
    queryFn: () => gitBackend.getPullRequestDetails(repoPath, number ?? 0),
    enabled: number !== null,
    staleTime: 30_000,
  }).data;
  const show = () =>
    pr
      ? void open({
          ...pr,
          author: { login: pr.author.login },
          headRefOid: pr.commits.at(-1)?.oid ?? "",
          updatedAt: pr.createdAt,
          reviewDecision: null,
        })
      : void gitBackend.openGithubUrl(url);
  return (
    <button
      type="button"
      onClick={show}
      className="surface flex w-full flex-col text-left outline-none transition-colors hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex flex-col gap-1.5 px-4 pt-3.5 pb-3">
        <span className="flex items-center gap-2">
          {pr ? <StateLabel pr={pr} /> : <GitPullRequest aria-hidden className="size-3.5 text-muted-foreground" />}
          {loading !== null && <BrailleLoader className="text-primary" />}
          {pr && (
            <span className="ml-auto text-[12px] tabular-nums">
              <span className="text-added-foreground">+{pr.additions}</span>{" "}
              <span className="text-removed-foreground">−{pr.deletions}</span>
            </span>
          )}
        </span>
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-[14px] font-medium">{pr?.title ?? title}</span>
          {pr && <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">#{pr.number}</span>}
        </span>
        {pr && (
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
            <CornerDownRight aria-hidden className="size-3.5 shrink-0" />
            <AuthorAvatar
              name={pr.author.login}
              src={`https://avatars.githubusercontent.com/${encodeURIComponent(pr.author.login)}?s=32`}
              className="size-4"
            />
            <span className="text-foreground/90">{pr.author.login}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0">{formatAge(pr.createdAt, undefined, t.locale)}</span>
            <span aria-hidden>·</span>
            <span className="min-w-0 truncate font-mono text-[11.5px]">{pr.headRefName}</span>
          </span>
        )}
      </span>
      {pr && (
        <span className="flex items-center gap-3 border-t border-white/[0.06] bg-white/[0.015] px-4 py-2.5">
          <ChecksBar pr={pr} />
          <span className="shrink-0 text-[12px] text-muted-foreground">{t.plural("refs.files", pr.changedFiles)}</span>
        </span>
      )}
    </button>
  );
}
