import { DataUnavailable } from "@/components/states";
import { useState } from "react";
import {
  Check,
  ChevronRight,
  GitBranch,
  GitPullRequest,
  GitMerge,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Plus,
  Waypoints,
  X,
} from "lucide-react";
import { AuthorAvatar } from "@/components/author-avatar";
import { BrailleLoader } from "@/components/braille-loader";
import { PanelLoading, PanelMessage } from "@/components/layout/panel";
import { usePullRequests } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { toGitError } from "@/lib/errors";
import { formatAge } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { useNoticesStore } from "@/stores/notices-store";
import { useWorkspaceStore, type View } from "@/stores/workspace-store";
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

export function StateIcon({ pr }: { pr: Pick<PullRequest, "state" | "isDraft"> }) {
  const t = useT();
  const className = "size-3.5 shrink-0";
  if (pr.state === "MERGED")
    return <GitMerge aria-label={t("github.merged")} className={cn(className, "text-merged")} />;
  if (pr.state === "CLOSED")
    return (
      <GitPullRequestClosed aria-label={t("github.closed")} className={cn(className, "text-removed-foreground")} />
    );
  if (pr.isDraft)
    return <GitPullRequestDraft aria-label={t("github.draft")} className={cn(className, "text-muted-foreground")} />;
  return <GitPullRequest aria-label={t("github.open")} className={cn(className, "text-added-foreground")} />;
}

/** The pull request opened from a branch: the open one first, else the latest merged or closed. */
export function pullRequestOf(prs: PullRequest[] | undefined, branch: string | null | undefined) {
  if (!prs || !branch) return null;
  const mine = prs.filter((p) => p.headRefName === branch);
  return mine.find((p) => p.state === "OPEN") ?? mine[0] ?? null;
}

/** A branch shows where its work stands: its PR's state (open, draft, merged, closed), or a plain branch. */
export function BranchStateIcon({ pr }: { pr: PullRequest | null }) {
  if (pr) return <StateIcon pr={pr} />;
  return <GitBranch aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
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
  const open = async (pr: PullRequest, view?: View) => {
    setLoading(pr.number);
    try {
      const { range, mergeBase, head } = await gitBackend.fetchPullRequest(repoPath, pr);
      openPullRequest(
        { number: pr.number, title: pr.title, author: pr.author.login, base: mergeBase, head, url: pr.url },
        range,
        view,
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
    <li
      className={cn(
        nested &&
          // Tree lines, as in Linear: an elbow into each PR, the trunk running on past all but the last.
          "relative pl-5 before:absolute before:top-0 before:left-[15px] before:h-1/2 before:w-2.5 before:rounded-bl-md before:border-b before:border-l before:border-white/15 after:absolute after:top-1/2 after:bottom-0 after:left-[15px] after:border-l after:border-white/15 last:after:hidden",
      )}
    >
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

/** Rows shown before "Show N more" in a long group. */
const GROUP_LIMIT = 10;

function Group({
  label,
  count,
  defaultCollapsed,
  items,
  sizeOf,
}: {
  label: string;
  count: number;
  defaultCollapsed: boolean;
  items: React.ReactNode[];
  /** How many pull requests each item holds (a stack holds several), for the "more" count. */
  sizeOf: (index: number) => number;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, GROUP_LIMIT);
  const hidden = items.slice(shown.length).reduce<number>((n, _, i) => n + sizeOf(shown.length + i), 0);
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
      {!collapsed && (
        <ul className="mt-0.5">
          {shown}
          {hidden > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setAll(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
              >
                <Plus aria-hidden className="size-3.5" />
                {t.plural("github.showMore", hidden)}
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/** A stack, like Linear: the bottom PR's title, its size, its author and age; its PRs hang beneath. */
function StackGroup({ repoPath, repoName, stack }: { repoPath: string; repoName: string; stack: PullRequest[] }) {
  const t = useT();
  const bottom = stack[0];
  // Open stacks start unfolded; merged ones are history, folded.
  const [open, setOpen] = useState(bottom.state === "OPEN");
  const selected = useWorkspaceStore((s) => stack.some((pr) => pr.number === s.pullRequest?.number));
  const top = [...stack].reverse();
  const updated = stack.reduce((a, pr) => (pr.updatedAt > a ? pr.updatedAt : a), bottom.updatedAt);
  const tone =
    bottom.state === "MERGED"
      ? "text-merged"
      : bottom.state === "CLOSED"
        ? "text-removed-foreground"
        : "text-added-foreground";
  return (
    <li className="mb-0.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "grid w-full grid-cols-[14px_1fr_auto] items-center gap-x-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring",
          (open || selected) && "bg-white/[0.04]",
        )}
      >
        <Waypoints aria-label={t("github.stack")} className={cn("size-3.5", tone)} />
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[12.5px] text-foreground">{bottom.title}</span>
          <span className="shrink-0 rounded bg-white/[0.08] px-1.5 text-[11px] text-muted-foreground tabular-nums">
            {stack.length}
          </span>
          <ChevronRight
            aria-hidden
            className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          />
        </span>
        <span className="flex items-center gap-1.5">
          <AuthorAvatar name={bottom.author.login} src={avatarOf(bottom.author.login)} className="size-4" />
          <span className="min-w-7 text-right text-[11.5px] whitespace-nowrap text-muted-foreground">
            {formatAge(updated, undefined, t.locale)}
          </span>
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
  // Stacks of open PRs and of merged ones; a stack lives in its bottom PR's group, where that PR would sit.
  const stacks = query ? [] : [...buildStacks(visible, "OPEN"), ...buildStacks(visible, "MERGED")];
  const stackOfPr = new Map(stacks.flatMap((stack) => stack.map((pr) => [pr.number, stack] as const)));
  return (
    <nav aria-label={t("github.list")} className="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      <ul>
        {GROUPS.map(({ id, label, collapsed }) => {
          const items: { key: number; size: number; node: React.ReactNode }[] = [];
          const placed = new Set<PullRequest[]>();
          for (const pr of visible) {
            const stack = stackOfPr.get(pr.number);
            if (stack) {
              // At its most recent PR's place, once; in the group of its bottom PR.
              if (placed.has(stack) || groupOf(stack[0]) !== id) continue;
              placed.add(stack);
              items.push({
                key: stack[0].number,
                size: stack.length,
                node: <StackGroup key={stack[0].number} repoPath={repoPath} repoName={repoName} stack={stack} />,
              });
            } else if (groupOf(pr) === id) {
              items.push({
                key: pr.number,
                size: 1,
                node: <PullRequestRow key={pr.number} repoPath={repoPath} repoName={repoName} pr={pr} />,
              });
            }
          }
          const count = items.reduce((n, item) => n + item.size, 0);
          if (count === 0) return null;
          return (
            <Group
              key={id}
              label={t(label)}
              count={count}
              defaultCollapsed={collapsed && !query}
              items={items.map((item) => item.node)}
              sizeOf={(i) => items[i].size}
            />
          );
        })}
      </ul>
    </nav>
  );
}
