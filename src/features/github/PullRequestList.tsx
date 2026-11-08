import { useState } from "react";
import { CircleDot, GitPullRequestDraft, Loader2, TriangleAlert } from "lucide-react";
import { PanelMessage } from "@/components/layout/panel";
import { usePullRequests } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { toGitError } from "@/lib/errors";
import { formatCommitDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { useNoticesStore } from "@/stores/notices-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { PullRequest } from "@/types/git";
import { useT, type MessageKey } from "@/i18n";

const REVIEW_LABEL: Record<string, MessageKey> = {
  APPROVED: "github.approved",
  CHANGES_REQUESTED: "github.changesRequested",
  REVIEW_REQUIRED: "github.reviewRequired",
};

function matches(pr: PullRequest, query: string): boolean {
  const haystack = `#${pr.number} ${pr.title} ${pr.author.login} ${pr.headRefName}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function PullRequestRow({ repoPath, pr }: { repoPath: string; pr: PullRequest }) {
  const t = useT();
  const { historyLabel, showHistoryOf } = useWorkspaceStore();
  const notify = useNoticesStore((s) => s.notify);
  const [loading, setLoading] = useState(false);
  const label = `#${pr.number} ${pr.title}`;
  const selected = historyLabel === label;

  const open = async () => {
    setLoading(true);
    try {
      showHistoryOf(await gitBackend.fetchPullRequest(repoPath, pr), label);
    } catch (error) {
      const { message, detail } = toGitError(error);
      notify({ tone: "error", title: t("github.openError", { number: pr.number, message }), detail });
    } finally {
      setLoading(false);
    }
  };

  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={open}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring",
          selected && "bg-white/8",
        )}
      >
        <span className="flex items-center gap-1.5 text-[11px] text-foreground">
          {loading ? (
            <Loader2 aria-hidden className="size-3 shrink-0 animate-spin" />
          ) : pr.isDraft ? (
            <GitPullRequestDraft aria-label={t("github.draft")} className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <CircleDot aria-label={t("github.open")} className="size-3 shrink-0 text-added-foreground" />
          )}
          <span className="truncate">{pr.title}</span>
        </span>
        <span className="flex min-w-0 gap-1.5 pl-[18px] text-[10px] whitespace-nowrap text-muted-foreground">
          <span className="shrink-0">#{pr.number}</span>
          <span className="min-w-0 truncate">
            {pr.author.login}
            {pr.reviewDecision && REVIEW_LABEL[pr.reviewDecision] && ` · ${t(REVIEW_LABEL[pr.reviewDecision])}`}
          </span>
          <span className="ml-auto shrink-0">{formatCommitDate(pr.updatedAt, undefined, t.locale)}</span>
        </span>
      </button>
    </li>
  );
}

/** Open pull requests of the repository's GitHub remote, via the user's `gh` login. Read-only. */
export function PullRequestList({ repoPath, query }: { repoPath: string; query: string }) {
  const t = useT();
  const prs = usePullRequests(repoPath);
  if (prs.isError) {
    return <PanelMessage icon={<TriangleAlert />} title={t("github.loadError")} hint={toGitError(prs.error).message} />;
  }
  if (!prs.data) return <PanelMessage title={t("github.loading")} />;
  const visible = query ? prs.data.filter((pr) => matches(pr, query)) : prs.data;
  if (visible.length === 0) return <PanelMessage title={query ? t("github.noMatch") : t("github.none")} />;
  return (
    <nav aria-label={t("github.list")} className="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      <ul>
        {visible.map((pr) => (
          <PullRequestRow key={pr.number} repoPath={repoPath} pr={pr} />
        ))}
      </ul>
    </nav>
  );
}
