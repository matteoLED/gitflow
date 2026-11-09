import { DataUnavailable } from "@/components/states";
import { useState } from "react";
import { Check, ChevronRight, GitMerge, GitPullRequest, GitPullRequestDraft, Layers, X } from "lucide-react";
import { AuthorAvatar } from "@/components/author-avatar";
import { BrailleLoader } from "@/components/braille-loader";
import { PanelLoading, PanelMessage } from "@/components/layout/panel";
import { usePullRequests } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { toGitError } from "@/lib/errors";
import { formatAge } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { useNoticesStore } from "@/stores/notices-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { PullRequest } from "@/types/git";
import { buildStacks } from "./stacks";
import { useT, type MessageKey } from "@/i18n";

type GroupId = "ready" | "open" | "draft" | "merged";

const GROUPS: { id: GroupId; label: MessageKey; collapsed: boolean }[] = [
  { id: "ready", label: "github.groupReady", collapsed: false },
  { id: "open", label: "github.groupOpen", collapsed: false },
  { id: "draft", label: "github.groupDraft", collapsed: false },
  { id: "merged", label: "github.groupMerged", collapsed: true },
];

/** Like Linear: approved PRs are ready to merge, drafts apart, merged ones folded at the bottom. */
export function groupOf(pr: PullRequest): GroupId {
  if (pr.state === "MERGED") return "merged";
  if (pr.isDraft) return "draft";
  return pr.reviewDecision === "APPROVED" ? "ready" : "open";
}

const avatarOf = (login: string) => `https://avatars.githubusercontent.com/${login}?s=48`;

function matches(pr: PullRequest, query: string): boolean {
  const haystack = `#${pr.number} ${pr.title} ${pr.author.login} ${pr.headRefName}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function StateIcon({ pr }: { pr: PullRequest }) {
  const t = useT();
  const className = "size-3.5 shrink-0";
  if (pr.state === "MERGED")
    return <GitMerge aria-label={t("github.merged")} className={cn(className, "text-[#a48ff0]")} />;
  if (pr.isDraft)
    return <GitPullRequestDraft aria-label={t("github.draft")} className={cn(className, "text-muted-foreground")} />;
  return <GitPullRequest aria-label={t("github.open")} className={cn(className, "text-added-foreground")} />;
}

export function ReviewBadge({ pr }: { pr: PullRequest }) {
  const t = useT();
  if (pr.state !== "OPEN") return null;
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    return (
      <span
        title={t("github.changesRequested")}
        className="grid size-4 shrink-0 place-items-center rounded bg-removed/25 text-removed-foreground"
      >
        <X aria-label={t("github.changesRequested")} className="size-3" />
      </span>
    );
  }
  if (pr.reviewDecision === "APPROVED") {
    return (
      <span
        title={t("github.approved")}
        className="grid size-4 shrink-0 place-items-center rounded bg-added/25 text-added-foreground"
      >
        <Check aria-label={t("github.approved")} className="size-3" />
      </span>
    );
  }
  return null;
}

/** Fetches a pull request's commits (no branch is touched) and opens it on its whole diff. */
export function useOpenPullRequest(repoPath: string) {
  const t = useT();
  const openPullRequest = useWorkspaceStore((s) => s.openPullRequest);
  const notify = useNoticesStore((s) => s.notify);
  const [loading, setLoading] = useState<number | null>(null);
  const open = async (pr: PullRequest) => {
    setLoading(pr.number);
    try {
      const { range, mergeBase, head } = await gitBackend.fetchPullRequest(repoPath, pr);
      openPullRequest(
        { number: pr.number, title: pr.title, author: pr.author.login, base: mergeBase, head, url: pr.url },
        range,
      );
    } catch (error) {
      const { message, detail } = toGitError(error);
      notify({ tone: "error", title: t("github.openError", { number: pr.number, message }), detail });
    } finally {
      setLoading(null);
    }
  };
  return { open, loading };
}

type RowProps = { repoPath: string; repoName: string; pr: PullRequest; nested?: boolean };

function PullRequestRow({ repoPath, repoName, pr, nested = false }: RowProps) {
  const t = useT();
  const selected = useWorkspaceStore((s) => s.pullRequest?.number === pr.number);
  const { open: openPr, loading: loadingPr } = useOpenPullRequest(repoPath);
  const loading = loadingPr === pr.number;
  const open = () => void openPr(pr);
  return (
    <li className={cn(nested && "relative ml-3 border-l border-white/10 pl-2")}>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={open}
        className={cn(
          "grid w-full grid-cols-[14px_1fr_auto] items-center gap-x-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring",
          selected && "bg-white/[0.08]",
        )}
      >
        {loading ? <BrailleLoader className="text-primary" /> : <StateIcon pr={pr} />}
        <span className="truncate text-[12.5px] text-foreground">{pr.title}</span>
        <span className="flex items-center gap-1.5">
          <ReviewBadge pr={pr} />
          <AuthorAvatar name={pr.author.login} src={avatarOf(pr.author.login)} className="size-4" />
          <span className="min-w-7 text-right text-[11.5px] whitespace-nowrap text-muted-foreground">
            {formatAge(pr.updatedAt, undefined, t.locale)}
          </span>
        </span>
        <span className="col-start-2 truncate text-[11.5px] text-muted-foreground">
          {repoName}#{pr.number}
        </span>
      </button>
    </li>
  );
}

function Group({
  label,
  count,
  defaultCollapsed,
  children,
}: {
  label: string;
  count: number;
  defaultCollapsed: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <li className="mb-1">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
        className="mt-1 flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium text-muted-foreground outline-none hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="font-medium">{label}</span>
        <span>{count}</span>
        <ChevronRight aria-hidden className={cn("size-3 transition-transform", !collapsed && "rotate-90")} />
      </button>
      {!collapsed && <ul className="mt-0.5">{children}</ul>}
    </li>
  );
}

/** A stack, like Linear: the bottom PR's title, its size, and its PRs indented beneath. */
function StackGroup({ repoPath, repoName, stack }: { repoPath: string; repoName: string; stack: PullRequest[] }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const top = [...stack].reverse();
  return (
    <li className="mb-0.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid w-full grid-cols-[14px_1fr_auto] items-center gap-x-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Layers aria-label={t("github.stack")} className="size-3.5 text-added-foreground" />
        <span className="truncate text-[12.5px] text-foreground">{stack[0].title}</span>
        <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
          <span className="rounded bg-white/[0.08] px-1.5 tabular-nums">{stack.length}</span>
          <ChevronRight aria-hidden className={cn("size-3 transition-transform", open && "rotate-90")} />
        </span>
        <span className="col-start-2 truncate text-[11.5px] text-muted-foreground">{repoName}</span>
      </button>
      {open && (
        <ul>
          {top.map((pr) => (
            <PullRequestRow key={pr.number} repoPath={repoPath} repoName={repoName} pr={pr} nested />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Pull requests of the repository's GitHub remote, grouped by status, via the user's `gh` login. */
export function PullRequestList({ repoPath, query }: { repoPath: string; query: string }) {
  const t = useT();
  const prs = usePullRequests(repoPath);
  const repoName = useWorkspaceStore((s) => s.repo?.name ?? "");
  if (prs.isError) {
    return <DataUnavailable title={t("github.loadError")} error={prs.error} onRetry={() => void prs.refetch()} />;
  }
  if (!prs.data) return <PanelLoading title={t("github.loading")} variant="grid-importing" />;
  const visible = query ? prs.data.filter((pr) => matches(pr, query)) : prs.data;
  if (visible.length === 0) return <PanelMessage title={query ? t("github.noMatch") : t("github.none")} />;
  const stacks = query ? [] : buildStacks(visible);
  const stacked = new Set(stacks.flat().map((pr) => pr.number));
  return (
    <nav aria-label={t("github.list")} className="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      <ul>
        {GROUPS.map(({ id, label, collapsed }) => {
          // A stack lives in its bottom PR's group; its PRs aren't repeated on their own.
          const groupStacks = stacks.filter((stack) => groupOf(stack[0]) === id);
          const members = visible.filter((pr) => groupOf(pr) === id && !stacked.has(pr.number));
          const count = members.length + groupStacks.reduce((n, s) => n + s.length, 0);
          if (count === 0) return null;
          return (
            <Group key={id} label={t(label)} count={count} defaultCollapsed={collapsed && !query}>
              {groupStacks.map((stack) => (
                <StackGroup key={stack[0].number} repoPath={repoPath} repoName={repoName} stack={stack} />
              ))}
              {members.map((pr) => (
                <PullRequestRow key={pr.number} repoPath={repoPath} repoName={repoName} pr={pr} />
              ))}
            </Group>
          );
        })}
      </ul>
    </nav>
  );
}
