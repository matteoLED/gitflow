import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, CircleDashed, Copy, GitBranch, GitPullRequest, Repeat, UserRound, X } from "lucide-react";
import { AuthorAvatar } from "@/components/author-avatar";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useT } from "@/i18n";
import { splitSubject } from "@/lib/commit-subject";
import { formatAge } from "@/lib/format-date";
import { useAvatar, useCommitPullRequest, usePullRequests } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { checkOutcome } from "@/features/github/ChecksMenu";
import { StateIcon, useOpenPullRequest } from "@/features/github/PullRequestList";
import { PriorityIcon, StateDot } from "@/features/linear/LinearList";
import { ProjectIcon } from "@/features/linear/ProjectIcon";
import { useActiveAccount, useIssue, useWorkspaceIssues } from "@/features/linear/linear-queries";
import { useLinearStore } from "@/stores/linear-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Ref } from "./ref-links";
import { useKnownRefs } from "./use-known-refs";
import type { CommitSummary, LinearIssue, PullRequestDetails } from "@/types/git";

type Side = "top" | "right" | "bottom" | "left";
type CardProps = { children: ReactNode; side?: Side };

/** A Linear-style preview after a short hover or on keyboard focus; the trigger (the child) keeps its click. */
function Preview({ children, side = "bottom", body }: CardProps & { body: ReactNode }) {
  if (!body) return children;
  return (
    <HoverCard>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side={side} className="flex flex-col gap-2.5">
        {body}
      </HoverCardContent>
    </HoverCard>
  );
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex min-w-0 items-center gap-2 text-muted-foreground">
      <span className="grid size-4 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </p>
  );
}

const ghAvatar = (login: string) => `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=48`;

function Checks({ checks }: { checks: PullRequestDetails["statusCheckRollup"] }) {
  const t = useT();
  const count = { pass: 0, fail: 0, pending: 0, skip: 0 };
  for (const c of checks) count[checkOutcome(c)]++;
  const parts = [
    { n: count.fail, label: t("refs.checksFail"), icon: <X className="size-3" />, tone: "text-check-failed" },
    {
      n: count.pending,
      label: t("refs.checksPending"),
      icon: <CircleDashed className="size-3" />,
      tone: "text-amber-300",
    },
    { n: count.pass, label: t("refs.checksPass"), icon: <Check className="size-3" />, tone: "text-check-passed" },
  ].filter((p) => p.n > 0);
  if (parts.length === 0) return null;
  return (
    <span className="flex items-center gap-2.5">
      {parts.map((p) => (
        <span key={p.label} title={p.label} className={cn("flex items-center gap-0.5 tabular-nums", p.tone)}>
          {p.icon}
          <span className="sr-only">{p.label}</span>
          {p.n}
        </span>
      ))}
    </span>
  );
}

function ReviewState({ decision }: { decision: string | null | undefined }) {
  const t = useT();
  if (decision === "APPROVED") return <span className="text-check-passed">{t("github.approved")}</span>;
  if (decision === "CHANGES_REQUESTED")
    return <span className="text-check-failed">{t("github.changesRequested")}</span>;
  return <span>{t("github.reviewRequired")}</span>;
}

function PullRequestBody({ repoPath, number }: { repoPath: string; number: number }) {
  const t = useT();
  const listed = usePullRequests(repoPath).data?.find((p) => p.number === number);
  // Same key as the pull request page: whichever opens first fills the other.
  const details = useQuery({
    queryKey: ["pull-request", repoPath, number],
    queryFn: () => gitBackend.getPullRequestDetails(repoPath, number),
    staleTime: 30_000,
    retry: false,
  }).data;
  const pr = details ?? listed;
  if (!pr) return <p className="text-muted-foreground">#{number}</p>;
  const decision = listed?.reviewDecision;
  return (
    <>
      <div className="flex items-start gap-2">
        <span className="mt-0.5">
          <StateIcon pr={pr} />
        </span>
        <p className="min-w-0 flex-1 text-[13px] leading-snug font-medium text-foreground">
          {pr.title} <span className="font-normal text-muted-foreground">#{number}</span>
        </p>
      </div>
      <Row icon={<AuthorAvatar name={pr.author.login} src={ghAvatar(pr.author.login)} className="size-4" />}>
        <span className="text-foreground/90">{pr.author.login}</span>
        {listed && <> · {formatAge(listed.updatedAt, undefined, t.locale)}</>}
      </Row>
      <Row icon={<GitBranch aria-hidden className="size-3.5" />}>
        <span className="font-mono text-[11.5px]">
          {pr.headRefName} → {pr.baseRefName}
        </span>
      </Row>
      {pr.state === "OPEN" && (
        <div className="flex items-center justify-between gap-2 text-muted-foreground">
          <ReviewState decision={decision} />
          {details && <Checks checks={details.statusCheckRollup} />}
        </div>
      )}
      {details && (
        <p className="flex items-center gap-2 border-t border-white/[0.06] pt-2 text-[11.5px] text-muted-foreground tabular-nums">
          <span className="text-added-foreground">+{details.additions}</span>
          <span className="text-removed-foreground">−{details.deletions}</span>
          <span>{t.plural("refs.files", details.changedFiles)}</span>
        </p>
      )}
    </>
  );
}

/** `number` absent: the child alone, no card. */
export function PullRequestHoverCard({
  repoPath,
  number,
  ...props
}: CardProps & { repoPath: string; number: number | null | undefined }) {
  return <Preview {...props} body={number != null && <PullRequestBody repoPath={repoPath} number={number} />} />;
}

function CopyHash({ hash }: { hash: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard.writeText(hash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? t("status.copied") : t("refs.copyHash")}
      title={t("refs.copyHash")}
      className="grid size-5 place-items-center rounded text-muted-foreground outline-none hover:bg-white/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? <Check aria-hidden className="size-3 text-check-passed" /> : <Copy aria-hidden className="size-3" />}
    </button>
  );
}

/** What a commit card shows: a history row, a file history entry. */
type CommitPreview = Pick<CommitSummary, "hash" | "subject" | "author" | "authorEmail" | "authoredAt">;

function CommitBody({ repoPath, commit }: { repoPath: string; commit: CommitPreview }) {
  const t = useT();
  const avatar = useAvatar(repoPath, commit.hash, commit.authorEmail).data;
  const { title, pr: suffix } = splitSubject(commit.subject);
  const found = useCommitPullRequest(repoPath, suffix ? null : commit.hash).data;
  const pr = found ?? (suffix ? { number: Number(suffix), title: null } : null);
  return (
    <>
      <div className="flex items-center gap-2 text-muted-foreground">
        <AuthorAvatar name={commit.author} src={avatar} className="size-5" />
        <span className="min-w-0 truncate text-foreground/90">{commit.author}</span>
        <time dateTime={commit.authoredAt} className="ml-auto shrink-0 tabular-nums">
          {formatAge(commit.authoredAt, undefined, t.locale)}
        </time>
      </div>
      <p className="text-[13px] leading-snug font-medium text-foreground">{title}</p>
      {pr && (
        <Row icon={<GitPullRequest aria-hidden className="size-3.5" />}>
          {pr.title ? t("blame.pullRequest", { number: pr.number, title: pr.title }) : `#${pr.number}`}
        </Row>
      )}
      <div className="flex items-center gap-1.5 border-t border-white/[0.06] pt-2">
        <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground select-all">
          {commit.hash}
        </code>
        <CopyHash hash={commit.hash} />
      </div>
    </>
  );
}

export function CommitHoverCard({
  repoPath,
  commit,
  ...props
}: CardProps & { repoPath: string; commit: CommitPreview }) {
  return <Preview {...props} body={<CommitBody repoPath={repoPath} commit={commit} />} />;
}

function IssueBody({ id, issue: given }: { id: string; issue?: LinearIssue | null }) {
  const t = useT();
  const account = useActiveAccount();
  const cached = useWorkspaceIssues().data?.find((i) => i.identifier === id);
  const known = given ?? cached;
  // Linear's API takes an identifier as an id: one lazy fetch for issues outside the user's lists.
  const fetched = useIssue(account?.id, known ? null : id);
  const issue = known ?? fetched.data;
  const url = issue?.url ?? (account ? `https://linear.app/${account.urlKey}/issue/${id}` : null);
  if (!issue)
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11.5px] text-muted-foreground">{id}</span>
        {url && !fetched.isPending && (
          <button
            type="button"
            onClick={() => void gitBackend.openGithubUrl(url)}
            className="rounded px-1.5 py-0.5 text-primary outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("linear.openInLinear")}
          </button>
        )}
      </div>
    );
  return (
    <>
      <p className="flex items-center gap-1.5 text-muted-foreground">
        <StateDot state={issue.state} />
        <span>{issue.state.name}</span>
        <span aria-hidden>·</span>
        <span className="font-mono text-[11.5px]">{issue.identifier}</span>
      </p>
      <p className="text-[13px] leading-snug font-medium text-foreground">{issue.title}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <Row icon={<PriorityIcon priority={issue.priority} />}>{issue.priorityLabel}</Row>
        <Row
          icon={
            issue.assignee ? (
              <AuthorAvatar name={issue.assignee.name} src={issue.assignee.avatarUrl} className="size-4" />
            ) : (
              <UserRound aria-hidden className="size-3.5" />
            )
          }
        >
          {issue.assignee?.name ?? t("refs.unassigned")}
        </Row>
        {issue.project && <Row icon={<ProjectIcon project={issue.project} />}>{issue.project.name}</Row>}
        {issue.cycle && (
          <Row icon={<Repeat aria-hidden className="size-3.5" />}>
            {t("linear.cycleNumber", { number: issue.cycle.number })}
          </Row>
        )}
      </div>
    </>
  );
}

export function IssueHoverCard({
  id,
  issue,
  ...props
}: CardProps & { id: string | null | undefined; issue?: LinearIssue | null }) {
  return <Preview {...props} body={id && <IssueBody id={id} issue={issue} />} />;
}

const LINK =
  "rounded-sm text-[color-mix(in_oklab,var(--primary)_55%,white)] underline decoration-current/30 underline-offset-[3px] outline-none hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring";

/** A reference found in an agent's message: previews on hover, opens in the app on click. */
export function RefLink({ repoPath, target, children }: { repoPath: string; target: Ref; children: ReactNode }) {
  const { prs, issues, commits } = useKnownRefs(repoPath);
  const { open } = useOpenPullRequest(repoPath);
  const account = useActiveAccount();
  const ws = useWorkspaceStore.getState;
  const link = (onClick: () => void) => (
    <button type="button" onClick={onClick} className={cn(LINK, target.kind === "commit" && "font-mono text-[0.9em]")}>
      {children}
    </button>
  );
  if (target.kind === "pr") {
    const pr = prs.find((p) => p.number === target.number);
    return (
      <PullRequestHoverCard repoPath={repoPath} number={target.number}>
        {link(() => pr && void open(pr))}
      </PullRequestHoverCard>
    );
  }
  if (target.kind === "commit") {
    const commit = commits.find((c) => c.hash === target.hash);
    if (!commit) return <>{children}</>;
    return (
      <CommitHoverCard repoPath={repoPath} commit={commit}>
        {link(() => (ws().setView("history"), ws().selectCommit(commit.hash)))}
      </CommitHoverCard>
    );
  }
  const issue = issues.find((i) => i.identifier === target.id);
  const openIssue = () => {
    if (issue) {
      useLinearStore.getState().setIssue(issue.id, issue.orgId);
      ws().setView("linear");
    } else if (account) void gitBackend.openGithubUrl(`https://linear.app/${account.urlKey}/issue/${target.id}`);
  };
  return (
    <IssueHoverCard id={target.id} issue={issue}>
      {link(openIssue)}
    </IssueHoverCard>
  );
}
