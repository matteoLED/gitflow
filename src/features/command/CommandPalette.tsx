import { useEffect, useState } from "react";
import {
  Archive,
  Undo2,
  ArrowDown,
  ArrowUp,
  Bot,
  FolderGit2,
  Inbox,
  Download,
  Keyboard,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SquareTerminal,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { VIEW_ICONS, VIEW_LABELS } from "@/components/layout/TitleBar";
import { VIEWS } from "@/app/routes";
import { useGitAction } from "@/features/operations/use-git-action";
import { useOpenPullRequest } from "@/features/github/PullRequestList";
import { StateDot } from "@/features/linear/LinearList";
import { useWorkspaceIssues } from "@/features/linear/linear-queries";
import { STATUS } from "@/features/work/work-status";
import { useWorkItems } from "@/features/work/use-work-items";
import { useT } from "@/i18n";
import { useHistorySearchStore } from "@/features/history/history-search-store";
import { gitBackend } from "@/lib/tauri-git";
import { useAgentsStore } from "@/stores/agents-store";
import { useLinearStore } from "@/stores/linear-store";
import { checkForUpdate } from "@/features/updates/updater";
import { useUiStore } from "@/stores/ui-store";
import { useWorkStore } from "@/stores/work-store";
import { useStashStore } from "@/features/stash/stash-store";
import { useUndo } from "@/features/undo/use-undo";
import { useWorkspaceStore, type View } from "@/stores/workspace-store";
import type { RepositoryInfo } from "@/types/git";

/** ⌘K: go anywhere (pages, branches, pull requests, issues, agents, repositories) or run an action, by keyboard. */
export function CommandPalette({ repo }: { repo: RepositoryInfo }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const t = useT();
  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={t("palette.title")} description={t("palette.hint")}>
      {/* Mounted only while open: nothing is queried for a closed palette. */}
      {open && <Commands repo={repo} close={() => setOpen(false)} />}
    </CommandDialog>
  );
}

function Commands({ repo, close }: { repo: RepositoryInfo; close: () => void }) {
  const t = useT();
  const { setView, switchRepo, repos } = useWorkspaceStore();
  const work = useWorkItems(repo.path).data ?? [];
  const issues = useWorkspaceIssues().data ?? [];
  const runs = useAgentsStore((s) => s.runs).filter((r) => r.repoPath === repo.path && r.thread === r.id);
  const { open: openPr } = useOpenPullRequest(repo.path);
  const undo = useUndo(repo.path);
  const action = (run: () => Promise<unknown>, success: string, failure: string, pending: string) => ({
    run,
    success,
    failure,
    pending,
  });
  const fetch = useGitAction(
    repo.path,
    action(() => gitBackend.fetch(repo.path), t("sync.fetched"), t("sync.fetchFailed"), t("sync.fetching")),
  );
  const pull = useGitAction(
    repo.path,
    action(() => gitBackend.pull(repo.path), t("sync.pulled"), t("sync.pullFailed"), t("sync.pulling")),
  );
  const push = useGitAction(
    repo.path,
    action(() => gitBackend.push(repo.path), t("sync.pushed"), t("sync.pushFailed"), t("sync.pushing")),
  );
  // Every command closes the palette first, then acts.
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  const goTo = (view: View) => run(() => setView(view));
  const label = (view: View) => {
    const key = VIEW_LABELS[view];
    return key === "Linear" || key === "CI" ? key : t(key);
  };
  return (
    <>
      <CommandInput placeholder={t("palette.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("palette.empty")}</CommandEmpty>
        <CommandGroup heading={t("palette.actions")}>
          <CommandItem
            onSelect={run(() => {
              useHistorySearchStore.getState().requestFocus();
              setView("history");
            })}
          >
            <Search />
            {t("palette.searchHistory")}
          </CommandItem>
          <CommandItem
            onSelect={run(() => {
              useWorkStore.getState().setFilter("inbox");
              setView("work");
            })}
          >
            <Inbox />
            {t("work.filter.inbox")}
          </CommandItem>
          <CommandItem
            onSelect={run(() => {
              useAgentsStore.getState().select({ type: "new" });
              setView("agents");
            })}
          >
            <Plus />
            {t("agents.new")}
          </CommandItem>
          <CommandItem onSelect={run(() => fetch.mutate())}>
            <RefreshCw />
            Fetch
          </CommandItem>
          <CommandItem onSelect={run(() => pull.mutate())}>
            <ArrowDown />
            Pull
          </CommandItem>
          <CommandItem onSelect={run(() => push.mutate())}>
            <ArrowUp />
            Push
          </CommandItem>
          <CommandItem onSelect={run(() => void undo())}>
            <Undo2 />
            {t("undo.action")}
            <CommandShortcut>⌘Z</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => useStashStore.getState().show())}>
            <Archive />
            {t("stash.open")}
          </CommandItem>
          <CommandItem onSelect={run(() => useUiStore.getState().setTerminalOpen(!useUiStore.getState().terminalOpen))}>
            <SquareTerminal />
            {t("terminal.toggle")}
            <CommandShortcut>⌃`</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => useUiStore.getState().setShortcutsOpen(true))}>
            <Keyboard />
            {t("shortcuts.title")}
            <CommandShortcut>⌘/</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => void checkForUpdate(true))}>
            <Download />
            {t("update.check")}
          </CommandItem>
          <CommandItem onSelect={run(() => useUiStore.getState().setSettingsOpen(true))}>
            <Settings />
            {t("palette.settings")}
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading={t("palette.pages")}>
          {VIEWS.map((view) => {
            const Icon = VIEW_ICONS[view];
            return (
              <CommandItem key={view} value={`page ${label(view)}`} onSelect={goTo(view)}>
                <Icon className="size-4 text-muted-foreground" />
                {label(view)}
              </CommandItem>
            );
          })}
        </CommandGroup>
        {work.length > 0 && (
          <CommandGroup heading={t("view.work")}>
            {work.map((item) => {
              const { icon: Icon, className } = STATUS[item.status];
              return (
                <CommandItem
                  key={item.key}
                  // Searchable by title, branch, issue id and PR number.
                  value={`${item.title} ${item.branch} ${item.issueId ?? ""} ${item.pr ? `#${item.pr.number}` : ""}`}
                  onSelect={run(() => {
                    useWorkStore.getState().select(item.branch);
                    if (item.pr) void openPr(item.pr, "work");
                    else setView("work");
                  })}
                >
                  <Icon className={`size-4 ${className}`} />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="max-w-48 truncate font-mono text-[11.5px] text-muted-foreground">
                    {item.pr ? `#${item.pr.number}` : item.branch}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {issues.length > 0 && (
          <CommandGroup heading={t("linear.myIssues")}>
            {issues.map((issue) => (
              <CommandItem
                key={`${issue.orgId}:${issue.id}`}
                value={`${issue.identifier} ${issue.title}`}
                onSelect={run(() => {
                  useLinearStore.getState().setIssue(issue.id, issue.orgId);
                  setView("linear");
                })}
              >
                <StateDot state={issue.state} />
                <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                <span className="font-mono text-[11.5px] text-muted-foreground">{issue.identifier}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {runs.length > 0 && (
          <CommandGroup heading={t("agents.runs")}>
            {runs.slice(0, 15).map((r) => (
              <CommandItem
                key={r.id}
                value={`agent ${r.title}`}
                onSelect={run(() => {
                  useAgentsStore.getState().select({ type: "run", id: r.id });
                  setView("agents");
                })}
              >
                <Bot />
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {repos.length > 1 && (
          <CommandGroup heading={t("palette.repos")}>
            {repos
              .filter((r) => r.path !== repo.path)
              .map((r) => (
                <CommandItem key={r.path} value={`repo ${r.name} ${r.path}`} onSelect={run(() => switchRepo(r.path))}>
                  <FolderGit2 />
                  {r.name}
                  <span className="truncate text-[11.5px] text-muted-foreground">{r.path}</span>
                </CommandItem>
              ))}
          </CommandGroup>
        )}
      </CommandList>
    </>
  );
}
