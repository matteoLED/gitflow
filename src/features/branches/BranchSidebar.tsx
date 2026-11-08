import { useState, type ReactNode } from "react";
import { ArrowRightLeft, ChevronDown, ChevronRight, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FilterInput, PanelHeader, PanelMessage } from "@/components/layout/panel";
import { useRefs } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { toGitError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useGitAction } from "@/features/operations/use-git-action";
import type { LocalBranch, RefsSnapshot, RepositoryInfo } from "@/types/git";
import { SyncBar } from "./SyncBar";
import { ViewTabs } from "./ViewTabs";
import { AppMenu } from "./AppMenu";
import { PullRequestList } from "@/features/github/PullRequestList";
import { RepoSwitcher } from "@/features/repositories/RepoSwitcher";
import { useT } from "@/i18n";

const ROW =
  "flex h-6 w-full items-center gap-2 rounded-md px-2.5 text-left text-[11px] outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring";
const SUMMARY = "cursor-default list-none [&::-webkit-details-marker]:hidden";

function groupByPrefix(branches: LocalBranch[]): [string | null, LocalBranch[]][] {
  const groups = new Map<string | null, LocalBranch[]>();
  for (const branch of branches) {
    const slash = branch.name.indexOf("/");
    const key = slash > 0 ? branch.name.slice(0, slash) : null;
    groups.set(key, [...(groups.get(key) ?? []), branch]);
  }
  return [...groups].sort(([a], [b]) => Number(a !== null) - Number(b !== null));
}

function Counts({ ahead, behind, pill = false }: { ahead: number; behind: number; pill?: boolean }) {
  const t = useT();
  if (!ahead && !behind) return null;
  return (
    <span
      className={cn(
        "ml-auto flex shrink-0 gap-1.5 text-[10px] opacity-80",
        pill && "rounded bg-black/25 px-1.5 py-px opacity-100",
      )}
    >
      {ahead > 0 && <span aria-label={t("branches.ahead", { count: ahead })}>↑{ahead}</span>}
      {behind > 0 && <span aria-label={t("branches.behind", { count: behind })}>↓{behind}</span>}
    </span>
  );
}

type BranchRowProps = { repoPath: string; branch: LocalBranch; label?: string; indent?: boolean };

function BranchRow({ repoPath, branch, label = branch.name, indent = false }: BranchRowProps) {
  const t = useT();
  const { historyRev, showHistoryOf } = useWorkspaceStore();
  const switchTo = useGitAction(repoPath, {
    run: () => gitBackend.switchBranch(repoPath, branch.name),
    success: t("branches.switched", { name: branch.name }),
    failure: t("branches.switchFailed", { name: branch.name }),
  });
  const viewing = historyRev === branch.name;
  return (
    <li className="group/row relative">
      <button
        type="button"
        aria-current={viewing ? "true" : undefined}
        onClick={() => showHistoryOf(branch.name)}
        onDoubleClick={() => switchTo.mutate()}
        title={t("branches.doubleClick", { name: branch.name })}
        className={cn(ROW, "pr-8 text-sidebar-foreground", indent && "pl-6", viewing && "bg-white/8 text-foreground")}
      >
        <span className="truncate">{label}</span>
        {branch.upstreamGone && (
          <TriangleAlert aria-label={t("branches.upstreamGone")} className="size-3 shrink-0 text-muted-foreground/70" />
        )}
        <Counts ahead={branch.ahead} behind={branch.behind} />
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t("branches.switchTo", { name: branch.name })}
        disabled={switchTo.isPending}
        onClick={() => switchTo.mutate()}
        className="absolute top-px right-1 opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100"
      >
        <ArrowRightLeft />
      </Button>
    </li>
  );
}

function HeadRow({ refs }: { refs: RefsSnapshot }) {
  const t = useT();
  const { historyRev, showHistoryOf } = useWorkspaceStore();
  const branch = refs.branches.find((b) => b.name === refs.head.branch);
  return (
    <button
      type="button"
      aria-current={historyRev === null ? "true" : undefined}
      onClick={() => showHistoryOf(null)}
      className={cn(
        ROW,
        "mb-2.5 h-6 bg-primary/40 font-semibold text-white hover:bg-primary/50",
        historyRev === null && "bg-primary/45",
      )}
    >
      <span className="truncate">{refs.head.branch ?? t("branches.detached")}</span>
      {branch && <Counts ahead={branch.ahead} behind={branch.behind} pill />}
    </button>
  );
}

function NewBranchForm({ repoPath, onDone }: { repoPath: string; onDone: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const create = useGitAction(repoPath, {
    run: () => gitBackend.createBranch(repoPath, name, true),
    success: t("branches.created", { name: name.trim() }),
    failure: t("branches.createFailed"),
  });
  return (
    <form
      className="mb-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) create.mutate(undefined, { onSuccess: onDone });
      }}
    >
      <Input
        autoFocus
        aria-label={t("branches.newName")}
        placeholder="new-branch-name ↵"
        value={name}
        disabled={create.isPending}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
        onBlur={() => !name && onDone()}
        className="h-6 text-[11px] md:text-[11px]"
      />
    </form>
  );
}

function BranchGroup({ repoPath, prefix, branches }: { repoPath: string; prefix: string; branches: LocalBranch[] }) {
  return (
    <li>
      <details open className="group">
        <summary className={cn(ROW, SUMMARY, "gap-1 text-sidebar-foreground")}>
          {prefix}
          <ChevronDown aria-hidden className="size-3 -rotate-90 opacity-60 transition-transform group-open:rotate-0" />
        </summary>
        <ul>
          {branches.map((b) => (
            <BranchRow key={b.name} repoPath={repoPath} branch={b} label={b.name.slice(prefix.length + 1)} indent />
          ))}
        </ul>
      </details>
    </li>
  );
}

function LocalBranches({ repoPath, refs, query }: { repoPath: string; refs: RefsSnapshot; query: string }) {
  const t = useT();
  const others = refs.branches.filter((b) => b.name !== refs.head.branch);
  const visible = query ? others.filter((b) => b.name.toLowerCase().includes(query.toLowerCase())) : others;
  if (visible.length === 0) {
    const text = query ? t("branches.noMatch") : t("branches.noOther");
    return <p className="px-2.5 py-1 text-[11px] text-muted-foreground">{text}</p>;
  }
  const row = (b: LocalBranch) => <BranchRow key={b.name} repoPath={repoPath} branch={b} />;
  if (query) return <ul>{visible.map(row)}</ul>;
  return (
    <ul>
      {groupByPrefix(visible).map(([prefix, branches]) =>
        prefix === null ? (
          branches.map(row)
        ) : (
          <BranchGroup key={prefix} repoPath={repoPath} prefix={prefix} branches={branches} />
        ),
      )}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className={cn(ROW, SUMMARY, "gap-1.5 font-semibold text-foreground/90")}>
        <ChevronRight aria-hidden className="size-3 opacity-60 transition-transform group-open:rotate-90" />
        {title}
      </summary>
      <ul className="max-h-48 overflow-y-auto pb-1 pl-3">{children}</ul>
    </details>
  );
}

function RevButton({ rev }: { rev: string }) {
  const { historyRev, showHistoryOf } = useWorkspaceStore();
  return (
    <li>
      <button
        type="button"
        title={rev}
        aria-current={historyRev === rev ? "true" : undefined}
        onClick={() => showHistoryOf(rev)}
        className={cn(ROW, "text-sidebar-foreground", historyRev === rev && "bg-white/8")}
      >
        <span className="truncate">{rev}</span>
      </button>
    </li>
  );
}

function Empty() {
  const t = useT();
  return <li className="px-2.5 py-1 text-[11px] text-muted-foreground">{t("common.none")}</li>;
}

function OtherRefs({ refs }: { refs: RefsSnapshot }) {
  const t = useT();
  return (
    <div className="border-t border-white/5 bg-white/[0.05] px-2 py-1.5">
      <Section title={t("branches.remotes")}>
        {refs.remotes.length === 0 && <Empty />}
        {refs.remotes.map((r) => (
          <RevButton key={`${r.remote}/${r.name}`} rev={`${r.remote}/${r.name}`} />
        ))}
      </Section>
      <Section title={t("branches.tags")}>
        {refs.tags.length === 0 && <Empty />}
        {refs.tags.map((tag) => (
          <RevButton key={tag} rev={tag} />
        ))}
      </Section>
      <Section title={t("branches.stashes")}>
        {refs.stashes.length === 0 && <Empty />}
        {refs.stashes.map((s) => (
          <li key={s.index} className="truncate px-2.5 py-1 text-[11px] text-sidebar-foreground" title={s.message}>
            {s.message}
          </li>
        ))}
      </Section>
    </div>
  );
}

export function BranchSidebar({ repo }: { repo: RepositoryInfo }) {
  const t = useT();
  const refs = useRefs(repo.path);
  const view = useWorkspaceStore((s) => s.view);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  return (
    <aside aria-label={t("branches.sidebar")} className="flex h-full flex-col bg-sidebar">
      <PanelHeader className="pr-2 pl-[88px]">
        <ViewTabs repoPath={repo.path} />
        <AppMenu repo={repo} />
      </PanelHeader>
      {refs.data && <SyncBar repoPath={repo.path} refs={refs.data} />}
      {refs.isError ? (
        <PanelMessage icon={<TriangleAlert />} title={t("branches.readError")} hint={toGitError(refs.error).message} />
      ) : view === "github" ? (
        <PullRequestList repoPath={repo.path} query={query} />
      ) : refs.data ? (
        <>
          <nav aria-label={t("branches.nav")} className="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            <HeadRow refs={refs.data} />
            {creating && <NewBranchForm repoPath={repo.path} onDone={() => setCreating(false)} />}
            <LocalBranches repoPath={repo.path} refs={refs.data} query={query} />
          </nav>
          <OtherRefs refs={refs.data} />
        </>
      ) : (
        <PanelMessage title={t("branches.loading")} />
      )}
      <div className="border-t border-white/5 px-2 pt-1.5">
        <RepoSwitcher repo={repo} />
      </div>
      <div className="flex items-center gap-1.5 p-2 pt-1">
        <FilterInput
          label={view === "github" ? t("github.filter") : t("branches.filter")}
          value={query}
          onValueChange={setQuery}
          className="flex-1"
        />
        {view !== "github" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("branches.new")}
                onClick={() => setCreating(true)}
                className="size-[22px] text-muted-foreground [&_svg]:size-3.5"
              >
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("branches.newHint")}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </aside>
  );
}
