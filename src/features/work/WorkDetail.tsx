import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, GitCommitHorizontal, History, Upload } from "lucide-react";
import { AuthorAvatar } from "@/components/author-avatar";
import { BrailleLoader } from "@/components/braille-loader";
import { PanelLoading } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { useCheckout } from "@/features/branches/use-checkout";
import { PullRequestPage } from "@/features/github/PullRequestPage";
import { StateDot } from "@/features/linear/LinearList";
import { useGitAction } from "@/features/operations/use-git-action";
import { CreatePullRequestButton } from "@/features/working-tree/CreatePullRequest";
import { useT } from "@/i18n";
import { formatAge } from "@/lib/format-date";
import { repoKey, useCommits } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useLinearStore } from "@/stores/linear-store";
import { useWorkStore } from "@/stores/work-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { WorkItem } from "./work-items";
import { STATUS } from "./WorkPage";

/** "Work / MNT-936 · branch": the way back to the list, above any detail. */
function Breadcrumb({ item }: { item: WorkItem }) {
  const t = useT();
  const select = useWorkStore((s) => s.select);
  return (
    <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-white/[0.05] px-3 text-[12.5px]">
      <button
        type="button"
        onClick={() => select(null)}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        {t("view.work")}
      </button>
      <span className="text-muted-foreground/60">/</span>
      {item.issueId && <span className="font-mono text-[11.5px] text-muted-foreground">{item.issueId}</span>}
      <span className="truncate font-mono text-[11.5px]">{item.branch}</span>
      <kbd className="kbd ml-auto">Esc</kbd>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-white/[0.07] bg-card">
      <h3 className="border-b border-white/[0.05] px-4 py-2.5 text-[12px] font-medium text-muted-foreground">
        {title}
      </h3>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

/** A branch without pull request: its issue, its state against the base, its commits, and what to do next. */
function BranchDetail({ repoPath, item }: { repoPath: string; item: WorkItem }) {
  const t = useT();
  const checkout = useCheckout(repoPath);
  const showHistoryOf = useWorkspaceStore((s) => s.showHistoryOf);
  const setView = useWorkspaceStore((s) => s.setView);
  const setIssue = useLinearStore((s) => s.setIssue);
  const push = useGitAction(repoPath, {
    run: () => gitBackend.push(repoPath),
    success: t("sync.pushed"),
    failure: t("sync.pushFailed"),
  });
  // The default branch, to list this branch's own commits (`origin/main..branch`).
  const base =
    useQuery({
      queryKey: [...repoKey(repoPath), "compare-base", null],
      queryFn: () => gitBackend.compareWithBase(repoPath, null),
    }).data?.base ?? null;
  const range = base ? `${base}..${item.branch}` : null;
  const commits = useCommits(repoPath, range);
  // Without a known base, HEAD's history would be shown instead: nothing rather than the wrong commits.
  const list = range ? (commits.data?.pages.flat() ?? []) : [];
  const { icon: Icon, className, label } = STATUS[item.status];
  const local = item.local;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[860px] flex-col gap-4 px-8 pt-7 pb-12">
        <div>
          <p className={cn("flex items-center gap-1.5 text-[12.5px] font-medium", className)}>
            <Icon aria-hidden className="size-4" />
            {t(label)}
          </p>
          <h1 className="mt-2 text-[22px] font-semibold tracking-tight">{item.title}</h1>
          {item.title !== item.branch && (
            <p className="mt-1 font-mono text-[12px] text-muted-foreground">{item.branch}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!item.current && local && (
            <Button
              size="sm"
              variant="outline"
              disabled={checkout.isPending}
              onClick={() => checkout.mutate({ kind: "local", name: item.branch })}
            >
              {t("work.checkout")}
            </Button>
          )}
          {item.current && local && (local.ahead > 0 || !local.upstream) && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={push.isPending}
              onClick={() => push.mutate()}
            >
              {push.isPending ? <BrailleLoader /> : <Upload aria-hidden />}
              {t("work.push")}
            </Button>
          )}
          {item.current && local && base && list.length > 0 && (
            <CreatePullRequestButton
              repoPath={repoPath}
              branch={item.branch}
              published={!!local.upstream && !local.upstreamGone}
              base={base}
              ahead={list.length}
            />
          )}
          {range && (
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => showHistoryOf(range, item.branch)}>
              <History aria-hidden />
              {t("work.openHistory")}
            </Button>
          )}
        </div>
        {item.issue && (
          <Card title={t("work.issue")}>
            <button
              type="button"
              onClick={() => {
                setIssue(item.issue?.id ?? null);
                setView("linear");
              }}
              className="flex w-full items-center gap-2.5 text-left text-[13px] hover:text-primary"
            >
              <StateDot state={item.issue.state} />
              <span className="font-mono text-[12px] text-muted-foreground">{item.issue.identifier}</span>
              <span className="min-w-0 flex-1 truncate">{item.issue.title}</span>
              <span className="text-[12px] text-muted-foreground">{item.issue.state.name}</span>
            </button>
          </Card>
        )}
        <Card title={t("work.state")}>
          <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-[13px]">
            <dt className="text-muted-foreground">{t("work.upstream")}</dt>
            <dd className="font-mono text-[12px]">
              {local?.upstream ? (local.upstreamGone ? t("work.upstreamGone") : local.upstream) : t("work.notPushed")}
            </dd>
            {local && (local.ahead > 0 || local.behind > 0) && (
              <>
                <dt className="text-muted-foreground">{t("work.sync")}</dt>
                <dd className="flex items-center gap-3 tabular-nums">
                  <span className="flex items-center gap-1">
                    <ArrowUp aria-hidden className="size-3.5" />
                    {t("work.toPush", { count: local.ahead })}
                  </span>
                  <span className="flex items-center gap-1">
                    <ArrowDown aria-hidden className="size-3.5" />
                    {t("work.toPull", { count: local.behind })}
                  </span>
                </dd>
              </>
            )}
            {item.ci && (
              <>
                <dt className="text-muted-foreground">CI</dt>
                <dd>{t(`work.ci.${item.ci}`)}</dd>
              </>
            )}
            {base && (
              <>
                <dt className="text-muted-foreground">{t("work.base")}</dt>
                <dd className="font-mono text-[12px]">
                  {base} · {t.plural("work.commitsAhead", list.length)}
                </dd>
              </>
            )}
          </dl>
        </Card>
        <Card title={t("work.commits")}>
          {!range ? (
            <p className="text-[12.5px] text-muted-foreground">{t("work.noBase")}</p>
          ) : commits.isPending ? (
            <BrailleLoader className="text-primary" />
          ) : list.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">{t("work.noCommits")}</p>
          ) : (
            <ul className="-my-1">
              {list.slice(0, 50).map((c) => (
                <li key={c.hash} className="flex items-center gap-2.5 py-1.5 text-[13px]">
                  <GitCommitHorizontal aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{c.subject}</span>
                  <AuthorAvatar name={c.author} className="size-4 text-[8px]" />
                  <span className="font-mono text-[11.5px] text-muted-foreground">{c.hash.slice(0, 7)}</span>
                  <span className="w-16 text-right text-[12px] text-muted-foreground">
                    {formatAge(c.authoredAt, undefined, t.locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/** The detail of one piece of work: its pull request page when it has one, else the branch's own page. */
export function WorkDetail({ repoPath, item }: { repoPath: string; item: WorkItem }) {
  const select = useWorkStore((s) => s.select);
  const pullRequest = useWorkspaceStore((s) => s.pullRequest);
  // Esc goes back to the list, unless something else (a dialog, a field) has the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = e.target instanceof Element && e.target.closest("input, textarea, [role=dialog]");
      if (e.key !== "Escape" || e.defaultPrevented || inField) return;
      select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);
  const showsPr = item.pr && pullRequest?.number === item.pr.number;
  return (
    <section className="flex h-full flex-col">
      <Breadcrumb item={item} />
      {showsPr && pullRequest ? (
        <div className="min-h-0 flex-1">
          <PullRequestPage key={pullRequest.number} repoPath={repoPath} pr={pullRequest} />
        </div>
      ) : item.pr ? (
        <PanelLoading title="" variant="grid-wave" />
      ) : (
        <BranchDetail repoPath={repoPath} item={item} />
      )}
    </section>
  );
}
