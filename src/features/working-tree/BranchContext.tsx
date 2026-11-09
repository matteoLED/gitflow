import { ArrowDown, ArrowUp, Check, ChevronDown, CloudOff, Tag } from "lucide-react";
import { BranchStateIcon, pullRequestOf, useOpenPullRequest } from "@/features/github/PullRequestList";
import { AuthorAvatar } from "@/components/author-avatar";
import { BrailleLoader } from "@/components/braille-loader";
import { Button } from "@/components/ui/button";
import { useGitAction } from "@/features/operations/use-git-action";
import { useT } from "@/i18n";
import { formatAge } from "@/lib/format-date";
import { useAvatar, useCommits, usePullRequests, useRefs } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layout-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { CreatePullRequestButton, useBaseComparison } from "./CreatePullRequest";
import type { CommitSummary } from "@/types/git";

const RECENT = 8;
/** Folded state of the list, remembered across launches. */
const FOLD_KEY = "changes:recent-commits";

/** Where the branch stands against its remote: unpublished, ahead/behind, or in sync — with the fix one click away. */
export function BranchStatus({ repoPath }: { repoPath: string }) {
  const t = useT();
  const refs = useRefs(repoPath).data;
  const branch = refs?.branches.find((b) => b.name === refs.head.branch);
  const pr = pullRequestOf(usePullRequests(repoPath).data, refs?.head.branch);
  const comparison = useBaseComparison(repoPath).data;
  const openPr = useOpenPullRequest(repoPath);
  const push = useGitAction(repoPath, {
    run: () => gitBackend.push(repoPath),
    success: t("sync.pushed"),
    failure: t("sync.pushFailed"),
  });
  const pull = useGitAction(repoPath, {
    run: () => gitBackend.pull(repoPath),
    success: t("sync.pulled"),
    failure: t("sync.pullFailed"),
  });
  if (!refs) return null;
  const published = !!branch?.upstream && !branch.upstreamGone;
  const ahead = branch?.ahead ?? 0;
  const behind = branch?.behind ?? 0;
  return (
    <div className="mx-3 mt-3 rounded-lg border border-white/[0.07] bg-card px-3 py-2.5">
      <p className="flex min-w-0 items-center gap-2 text-[13px]">
        <BranchStateIcon pr={pr} />
        <span className="min-w-0 truncate font-mono text-[12.5px]">{refs.head.branch ?? t("changes.detached")}</span>
      </p>
      {branch && (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-muted-foreground">
          {!published ? (
            <>
              <CloudOff aria-hidden className="size-3.5 text-renamed" />
              <span className="flex-1">{branch.upstreamGone ? t("branch.upstreamGone") : t("branch.unpublished")}</span>
            </>
          ) : ahead === 0 && behind === 0 ? (
            <>
              <Check aria-hidden className="size-3.5 text-added-foreground" />
              <span className="min-w-0 flex-1 truncate">{t("branch.inSync", { upstream: branch.upstream ?? "" })}</span>
            </>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-2.5">
              {ahead > 0 && (
                <span className="shrink-0 whitespace-nowrap text-foreground">{t.plural("branch.toPush", ahead)}</span>
              )}
              {behind > 0 && (
                <span className="shrink-0 whitespace-nowrap text-foreground">{t.plural("branch.toPull", behind)}</span>
              )}
              <span className="min-w-0 truncate">{branch.upstream}</span>
            </span>
          )}
          {behind > 0 && published && (
            <Button
              size="xs"
              variant="outline"
              disabled={pull.isPending}
              onClick={() => pull.mutate()}
              className="gap-1"
            >
              {pull.isPending ? <BrailleLoader /> : <ArrowDown aria-hidden />}
              {t("sync.pull")}
            </Button>
          )}
          {(!published || ahead > 0) && (
            <Button
              size="xs"
              variant={published ? "outline" : "default"}
              disabled={push.isPending}
              onClick={() => push.mutate()}
              className="gap-1"
            >
              {push.isPending ? <BrailleLoader /> : <ArrowUp aria-hidden />}
              {published ? t("sync.push") : t("branch.publish")}
            </Button>
          )}
        </div>
      )}
      {pr ? (
        <button
          type="button"
          onClick={() => void openPr.open(pr)}
          className="mt-2 flex w-full min-w-0 items-center gap-2 rounded-md text-left text-[12px] text-muted-foreground hover:text-foreground"
        >
          <span className="shrink-0 font-mono">#{pr.number}</span>
          <span className="min-w-0 flex-1 truncate">{pr.title}</span>
          {openPr.loading === pr.number && <BrailleLoader />}
        </button>
      ) : (
        branch &&
        comparison &&
        comparison.ahead > 0 && (
          <div className="mt-2 flex items-center gap-2 border-t border-white/[0.06] pt-2 text-[12px] text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">
              {t.plural("createPr.aheadOf", comparison.ahead, { base: comparison.base })}
            </span>
            <CreatePullRequestButton
              repoPath={repoPath}
              branch={branch.name}
              published={published}
              base={comparison.base}
              ahead={comparison.ahead}
            />
          </div>
        )
      )}
    </div>
  );
}

function CommitItem({ repoPath, commit, local }: { repoPath: string; commit: CommitSummary; local: boolean }) {
  const t = useT();
  const avatar = useAvatar(repoPath, commit.hash, commit.authorEmail).data;
  const tags = commit.refs.filter((r) => r.kind === "tag");
  const open = () => {
    const store = useWorkspaceStore.getState();
    store.selectCommit(commit.hash);
    store.setView("history");
  };
  return (
    <li>
      <button
        type="button"
        onClick={open}
        title={`${commit.subject}\n${commit.hash.slice(0, 10)}`}
        className="flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[12.5px]">{commit.subject}</span>
          {tags.slice(0, 1).map((tag) => (
            <span
              key={tag.name}
              className="flex max-w-24 shrink-0 items-center gap-1 rounded border border-white/10 px-1 text-[10.5px] text-muted-foreground"
            >
              <Tag aria-hidden className="size-2.5 shrink-0" />
              <span className="truncate">{tag.name}</span>
            </span>
          ))}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <AuthorAvatar name={commit.author} src={avatar} className="size-4 text-[8px]" />
          <span className="truncate">{commit.author}</span>·
          <time dateTime={commit.authoredAt} className="shrink-0">
            {formatAge(commit.authoredAt, undefined, t.locale)}
          </time>
          ·<span className="shrink-0 font-mono">{commit.hash.slice(0, 7)}</span>
          {local && (
            <span
              title={t("branch.notPushed")}
              className={cn("ml-auto flex shrink-0 items-center gap-0.5 text-renamed")}
            >
              <ArrowUp aria-hidden className="size-3" />
              {t("branch.local")}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/** The last commits of the branch, unpushed ones flagged: what was already done stays in sight. */
export function RecentCommits({ repoPath }: { repoPath: string }) {
  const t = useT();
  const refs = useRefs(repoPath).data;
  const commits = useCommits(repoPath, null).data?.pages[0]?.slice(0, RECENT) ?? [];
  const branch = refs?.branches.find((b) => b.name === refs.head.branch);
  // Without an upstream every commit is local only to the extent it isn't on any remote: unknown, so don't flag.
  const unpushed = branch?.upstream && !branch.upstreamGone ? branch.ahead : 0;
  const collapsed = useLayoutStore((s) => !!s.collapsedLists[FOLD_KEY]);
  const toggle = useLayoutStore((s) => s.toggleList);
  if (commits.length === 0) return null;
  return (
    <section aria-label={t("branch.recentCommits")} className="mt-2 mb-3">
      <h3>
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => toggle(FOLD_KEY)}
          className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-[12px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("branch.recentCommits")}
          {collapsed && <span className="font-mono">{commits.length}</span>}
          <ChevronDown aria-hidden className={cn("size-3 transition-transform", collapsed && "-rotate-90")} />
        </button>
      </h3>
      {!collapsed && (
        <ul>
          {commits.map((commit, i) => (
            <CommitItem key={commit.hash} repoPath={repoPath} commit={commit} local={i < unpushed} />
          ))}
        </ul>
      )}
    </section>
  );
}
