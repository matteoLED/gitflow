import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Cloud,
  CircleAlert,
  CircleCheck,
  Clock,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestDraft,
  type LucideIcon,
} from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { PanelHeader, PanelLoading } from "@/components/layout/panel";
import { DataUnavailable, EmptyState } from "@/components/states";
import { useOpenPullRequest } from "@/features/github/PullRequestList";
import { useCheckout } from "@/features/branches/use-checkout";
import { useT, type MessageKey } from "@/i18n";
import { formatAge } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { useLinearStore } from "@/stores/linear-store";
import { useWorkStore } from "@/stores/work-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { WORK_STATUSES, type CiState, type WorkItem, type WorkStatus } from "./work-items";
import { filterWork, useWorkItems } from "./use-work-items";
import { WorkDetail } from "./WorkDetail";
import { DeleteBranchesButton } from "./DeleteBranches";
import { cleanable, deletable } from "./use-delete-branches";
import { InboxPage } from "./InboxPage";

export const STATUS: Record<WorkStatus, { icon: LucideIcon; label: MessageKey; className: string }> = {
  changes: { icon: CircleAlert, label: "work.status.changes", className: "text-removed-foreground" },
  review: { icon: GitPullRequest, label: "work.status.review", className: "text-primary" },
  approved: { icon: CircleCheck, label: "work.status.approved", className: "text-added-foreground" },
  draft: { icon: GitPullRequestDraft, label: "work.status.draft", className: "text-muted-foreground" },
  progress: { icon: GitBranch, label: "work.status.progress", className: "text-renamed" },
  stale: { icon: Clock, label: "work.status.stale", className: "text-muted-foreground" },
  merged: { icon: GitMerge, label: "work.status.merged", className: "text-merged" },
};

const CI_DOT: Record<CiState, string> = {
  success: "bg-added-foreground",
  failure: "bg-removed-foreground",
  running: "bg-renamed animate-pulse",
};

/** The buttons shown on a hovered row: one look for all of them. */
const ROW_ACTION =
  "flex h-6 items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 text-[12px] font-normal text-muted-foreground shadow-none hover:bg-white/[0.09] hover:text-foreground [&_svg]:size-3";

/** One branch of work, as a dense Linear row: status, issue, title and branch, then CI, PR, sync and age. */
function WorkRow({ item, repoPath }: { item: WorkItem; repoPath: string }) {
  const t = useT();
  const { open: openPr, loading } = useOpenPullRequest(repoPath);
  const setView = useWorkspaceStore((s) => s.setView);
  const setIssue = useLinearStore((s) => s.setIssue);
  const checkout = useCheckout(repoPath);
  const { icon: Icon, className } = STATUS[item.status];
  // The pull request when there is one (its whole diff, ready to review), else the branch's commits.
  const select = useWorkStore((s) => s.select);
  // Opens in place: the pull request page (its whole diff, ready to review), or the branch's own page.
  const open = () => {
    select(item.branch);
    if (item.pr) void openPr(item.pr, "work");
  };
  const canCheckout = !item.current && (item.local || item.pr?.state === "OPEN");
  return (
    <li className="group/row relative">
      <button
        type="button"
        onClick={open}
        className="grid h-11 w-full grid-cols-[16px_64px_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/[0.04] pr-5 pl-5 text-left text-[13px] outline-none hover:bg-white/[0.035] focus-visible:bg-white/[0.05]"
      >
        {loading === item.pr?.number ? (
          <BrailleLoader className="text-primary" />
        ) : (
          <Icon aria-label={t(STATUS[item.status].label)} className={cn("size-4", className)} />
        )}
        <span className="truncate font-mono text-[11.5px] text-muted-foreground">{item.issueId ?? ""}</span>
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate">{item.title}</span>
          {!item.local && item.remote && !item.pr && (
            <Cloud
              aria-label={t("branches.onGithub")}
              className="size-3.5 shrink-0 self-center text-muted-foreground"
            />
          )}
          {item.title !== item.branch && (
            <span className="truncate font-mono text-[11.5px] text-muted-foreground">{item.branch}</span>
          )}
          {item.current && (
            <span className="shrink-0 rounded bg-primary/15 px-1.5 text-[11px] font-medium text-primary">
              {t("work.current")}
            </span>
          )}
        </span>
        <span className="flex items-center gap-3 text-[12px] text-muted-foreground tabular-nums group-hover/row:invisible">
          {item.ci && <span title={t(`work.ci.${item.ci}`)} className={cn("size-2 rounded-full", CI_DOT[item.ci])} />}
          {item.local && (item.local.ahead > 0 || item.local.behind > 0) && (
            <span className="flex items-center gap-1">
              {item.local.ahead > 0 && (
                <span className="flex items-center">
                  <ArrowUp aria-hidden className="size-3" />
                  {item.local.ahead}
                </span>
              )}
              {item.local.behind > 0 && (
                <span className="flex items-center">
                  <ArrowDown aria-hidden className="size-3" />
                  {item.local.behind}
                </span>
              )}
            </span>
          )}
          {item.pr && <span>#{item.pr.number}</span>}
          {item.pr && !item.local && <span className="max-w-24 truncate">{item.pr.author.login}</span>}
          <span className="w-14 text-right whitespace-nowrap">
            {item.updatedAt && formatAge(item.updatedAt, undefined, t.locale)}
          </span>
        </span>
      </button>
      {/* Row actions, on hover: they cover the end of the row, fading the text out instead of overlapping it. */}
      <span className="pointer-events-none absolute inset-y-px right-0 hidden items-center gap-1 bg-linear-to-l from-background from-75% to-transparent pr-4 pl-16 group-hover/row:flex [&>*]:pointer-events-auto">
        {item.issue && (
          <button
            type="button"
            onClick={() => {
              setIssue(item.issue?.id ?? null);
              setView("linear");
            }}
            className={ROW_ACTION}
          >
            {t("work.openIssue")}
          </button>
        )}
        {deletable(item) && (item.status === "merged" || item.status === "stale") && (
          <DeleteBranchesButton
            repoPath={repoPath}
            items={[item]}
            label={t("branches.delete")}
            className={ROW_ACTION}
          />
        )}
        {canCheckout && (
          <button
            type="button"
            disabled={checkout.isPending}
            onClick={() =>
              checkout.mutate({
                kind: item.local ? "local" : "remote",
                name: item.local ? item.branch : `origin/${item.branch}`,
              })
            }
            className={ROW_ACTION}
          >
            {t("work.checkout")}
          </button>
        )}
      </span>
    </li>
  );
}

function Section({ status, items, repoPath }: { status: WorkStatus; items: WorkItem[]; repoPath: string }) {
  const t = useT();
  // Finished work is folded by default, as Linear folds its Done column.
  const [open, setOpen] = useState(status !== "merged" && status !== "stale");
  const { icon: Icon, className, label } = STATUS[status];
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="sticky top-0 z-10 flex h-9 w-full items-center gap-2 border-b border-white/[0.05] bg-background px-5 text-left text-[12.5px] font-medium"
      >
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 text-muted-foreground transition-transform", !open && "-rotate-90")}
        />
        <Icon aria-hidden className={cn("size-3.5", className)} />
        {t(label)}
        <span className="text-muted-foreground">{items.length}</span>
      </button>
      {open && (
        <ul>
          {items.map((item) => (
            <WorkRow key={item.key} item={item} repoPath={repoPath} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Git work as Linear shows issues: every branch and pull request in one list, by where it stands. */
export function WorkPage({ repoPath }: { repoPath: string }) {
  const t = useT();
  const filter = useWorkStore((s) => s.filter);
  const selected = useWorkStore((s) => s.selected);
  const work = useWorkItems(repoPath);
  const item = selected ? work.data?.find((i) => i.branch === selected) : undefined;
  if (item) return <WorkDetail repoPath={repoPath} item={item} />;
  if (filter === "inbox") return <InboxPage repoPath={repoPath} />;
  const header = (
    <PanelHeader className="gap-1.5 text-[13px]">
      <span className="font-medium">{t(`work.filter.${filter}`)}</span>
      {work.data && <span className="text-muted-foreground">{filterWork(work.data, filter).length}</span>}
      {work.loadingPrs && <BrailleLoader className="ml-2 text-muted-foreground" label={t("work.loadingPrs")} />}
      {work.data && (
        <DeleteBranchesButton
          repoPath={repoPath}
          items={cleanable(filterWork(work.data, filter))}
          label={t.plural("branches.cleanUp", cleanable(filterWork(work.data, filter)).length)}
          className="ml-auto"
        />
      )}
    </PanelHeader>
  );
  if (work.error)
    return <DataUnavailable title={t("work.loadError")} error={work.error} onRetry={() => void work.refetch()} />;
  if (!work.data) return <PanelLoading title={t("common.loading")} variant="grid-wave" />;
  const items = filterWork(work.data, filter);
  return (
    <section aria-label={t("view.work")} className="flex h-full flex-col">
      {header}
      {items.length === 0 ? (
        <EmptyState icon={<GitBranch />} title={t("work.empty")} description={t("work.emptyHint")} />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {WORK_STATUSES.map((status) => {
            const group = items.filter((i) => i.status === status);
            return group.length > 0 && <Section key={status} status={status} items={group} repoPath={repoPath} />;
          })}
        </ul>
      )}
    </section>
  );
}
