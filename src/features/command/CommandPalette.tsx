import { useShallow } from "zustand/react/shallow";
import { useEffect, useState, type ReactNode } from "react";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import {
  Archive,
  Undo2,
  ArrowDown,
  ArrowUp,
  Bot,
  FileText,
  FolderGit2,
  GitCommitHorizontal,
  GitPullRequest,
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
import { fuzzyFilter } from "@/features/editor/fuzzy";
import { StateDot } from "@/features/linear/LinearList";
import { useLinearAccounts, useWorkspaceIssues, type WorkspaceIssue } from "@/features/linear/linear-queries";
import { STATUS } from "@/features/work/work-status";
import { useWorkItems } from "@/features/work/use-work-items";
import { useT } from "@/i18n";
import { useHistorySearchStore } from "@/features/history/history-search-store";
import { usePullRequests } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { useAgentsStore } from "@/stores/agents-store";
import { useEditorStore } from "@/stores/editor-store";
import { useLinearStore } from "@/stores/linear-store";
import { checkForUpdate } from "@/features/updates/updater";
import { useUiStore } from "@/stores/ui-store";
import { useWorkStore } from "@/stores/work-store";
import { useStashStore } from "@/features/stash/stash-store";
import { useUndo } from "@/features/undo/use-undo";
import { useWorkspaceStore, type View } from "@/stores/workspace-store";
import type { RepositoryInfo } from "@/types/git";
import { groupLimit, mergeUnique, parsePaletteQuery, rankByText, type PaletteScope } from "./palette-search";

/** ⌘K: search everything (files, commits, pull requests, issues, conversations…) or run an action, by keyboard. */
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
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t("palette.title")}
      description={t("palette.hint")}
      shouldFilter={false}
    >
      {/* Mounted only while open: nothing is queried for a closed palette. */}
      {open && <Commands repo={repo} close={() => setOpen(false)} />}
    </CommandDialog>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** What a result group gets: the search, and `run`, which closes the palette before acting. */
type GroupProps = { repoPath: string; term: string; limit: number; run: (fn: () => void) => () => void };

type Action = { id: string; label: string; icon: ReactNode; shortcut?: string; act: () => void };

function useActions(repoPath: string): Action[] {
  const t = useT();
  const setView = useWorkspaceStore((s) => s.setView);
  const undo = useUndo(repoPath);
  const sync = (run: () => Promise<unknown>, success: string, failure: string, pending: string) => ({
    run,
    success,
    failure,
    pending,
  });
  const fetch = useGitAction(
    repoPath,
    sync(() => gitBackend.fetch(repoPath), t("sync.fetched"), t("sync.fetchFailed"), t("sync.fetching")),
  );
  const pull = useGitAction(
    repoPath,
    sync(() => gitBackend.pull(repoPath), t("sync.pulled"), t("sync.pullFailed"), t("sync.pulling")),
  );
  const push = useGitAction(
    repoPath,
    sync(() => gitBackend.push(repoPath), t("sync.pushed"), t("sync.pushFailed"), t("sync.pushing")),
  );
  const ui = useUiStore.getState;
  return [
    {
      id: "search-history",
      label: t("palette.searchHistory"),
      icon: <Search />,
      act: () => {
        useHistorySearchStore.getState().requestFocus();
        setView("history");
      },
    },
    {
      id: "inbox",
      label: t("work.filter.inbox"),
      icon: <Inbox />,
      act: () => {
        useWorkStore.getState().setFilter("inbox");
        setView("work");
      },
    },
    {
      id: "new-agent",
      label: t("agents.new"),
      icon: <Plus />,
      act: () => {
        useAgentsStore.getState().select({ type: "new" });
        setView("agents");
      },
    },
    { id: "fetch", label: "Fetch", icon: <RefreshCw />, act: () => fetch.mutate() },
    { id: "pull", label: "Pull", icon: <ArrowDown />, act: () => pull.mutate() },
    { id: "push", label: "Push", icon: <ArrowUp />, act: () => push.mutate() },
    { id: "undo", label: t("undo.action"), icon: <Undo2 />, shortcut: "⌘Z", act: () => void undo() },
    { id: "stash", label: t("stash.open"), icon: <Archive />, act: () => useStashStore.getState().show() },
    {
      id: "terminal",
      label: t("terminal.toggle"),
      icon: <SquareTerminal />,
      shortcut: "⌃`",
      act: () => ui().setTerminalOpen(!ui().terminalOpen),
    },
    {
      id: "shortcuts",
      label: t("shortcuts.title"),
      icon: <Keyboard />,
      shortcut: "⌘/",
      act: () => ui().setShortcutsOpen(true),
    },
    { id: "update", label: t("update.check"), icon: <Download />, act: () => void checkForUpdate(true) },
    {
      id: "settings",
      label: t("palette.settings"),
      icon: <Settings />,
      shortcut: "⌘,",
      act: () => ui().setSettingsOpen(true),
    },
  ];
}

function Commands({ repo, close }: { repo: RepositoryInfo; close: () => void }) {
  const t = useT();
  const { setView, switchRepo, repos } = useWorkspaceStore(
    useShallow((s) => ({ setView: s.setView, switchRepo: s.switchRepo, repos: s.repos })),
  );
  const [input, setInput] = useState("");
  const { scope, term } = parsePaletteQuery(input);
  // Remote searches (git log, Linear) wait for typing to pause.
  const remoteTerm = useDebounced(term, 200);
  const searching = scope !== "all" || term !== "";
  const limit = groupLimit(scope);
  const shows = (group: PaletteScope) => scope === "all" || scope === group;
  const actions = useActions(repo.path);
  // Every command closes the palette first, then acts.
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  const label = (view: View) => {
    const key = VIEW_LABELS[view];
    return key === "Linear" || key === "CI" ? key : t(key);
  };
  const cap = searching ? limit : Infinity;
  const shownActions = rankByText(term, actions, (a) => a.label, cap);
  const pages = scope === "all" ? rankByText(term, VIEWS, label, cap) : [];
  const otherRepos =
    scope === "all"
      ? rankByText(
          term,
          repos.filter((r) => r.path !== repo.path),
          (r) => `${r.name} ${r.path}`,
          cap,
        )
      : [];
  const group = { repoPath: repo.path, limit, run };
  return (
    <>
      <CommandInput placeholder={t("palette.placeholder")} value={input} onValueChange={setInput} />
      <CommandList>
        <CommandEmpty>{t("palette.empty")}</CommandEmpty>
        {!searching && (
          <p className="px-2 pt-1 pb-1.5 text-[11.5px] text-muted-foreground">{t("palette.prefixHint")}</p>
        )}
        {shows("actions") && shownActions.length > 0 && (
          <CommandGroup heading={t("palette.actions")}>
            {shownActions.map((a) => (
              <CommandItem key={a.id} value={`action:${a.id}`} onSelect={run(a.act)}>
                {a.icon}
                {a.label}
                {a.shortcut && <CommandShortcut>{a.shortcut}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {pages.length > 0 && (
          <CommandGroup heading={t("palette.pages")}>
            {pages.map((view) => {
              const Icon = VIEW_ICONS[view];
              return (
                <CommandItem key={view} value={`page:${view}`} onSelect={run(() => setView(view))}>
                  <Icon className="size-4 text-muted-foreground" />
                  {label(view)}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {searching && shows("files") && <FileResults {...group} term={term} />}
        {searching && scope === "all" && term && <CommitResults {...group} term={remoteTerm} />}
        {searching && shows("prs") && <PullRequestResults {...group} term={term} />}
        {searching && shows("issues") && <IssueResults {...group} term={term} remoteTerm={remoteTerm} />}
        {searching && scope === "all" && <ConversationResults {...group} term={term} />}
        {searching && scope === "all" && <WorkResults {...group} term={term} />}
        {otherRepos.length > 0 && (
          <CommandGroup heading={t("palette.repos")}>
            {otherRepos.map((r) => (
              <CommandItem key={r.path} value={`repo:${r.path}`} onSelect={run(() => switchRepo(r.path))}>
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

function FileResults({ repoPath, term, limit, run }: GroupProps) {
  const t = useT();
  const setView = useWorkspaceStore((s) => s.setView);
  // Same cache as the composer's @-mentions and the editor's file tree.
  const files = useQuery({
    queryKey: ["files", repoPath],
    queryFn: () => gitBackend.listFiles(repoPath),
    staleTime: 30_000,
  });
  const matches = fuzzyFilter(term, files.data ?? [], limit);
  if (matches.length === 0) return null;
  return (
    <CommandGroup heading={t("palette.files")}>
      {matches.map((path) => {
        const slash = path.lastIndexOf("/");
        return (
          <CommandItem
            key={path}
            value={`file:${path}`}
            onSelect={run(() => {
              useEditorStore.getState().open(repoPath, path);
              setView("editor");
            })}
          >
            <FileText />
            <span className="shrink-0">{path.slice(slash + 1)}</span>
            <span className="min-w-0 truncate font-mono text-[11.5px] text-muted-foreground">
              {path.slice(0, Math.max(slash, 0))}
            </span>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

/** Commit messages matching the (debounced) term, through the History search's `git log`. */
function CommitResults({ repoPath, term, limit, run }: GroupProps) {
  const t = useT();
  const { showHistoryOf, selectCommit } = useWorkspaceStore(
    useShallow((s) => ({ showHistoryOf: s.showHistoryOf, selectCommit: s.selectCommit })),
  );
  const commits = useQuery({
    queryKey: ["palette", "commits", repoPath, term],
    queryFn: () =>
      gitBackend.listCommits(repoPath, {
        rev: null,
        skip: 0,
        limit,
        filters: { message: term, firstParent: false, noMerges: false },
      }),
    enabled: term !== "",
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const list = commits.data ?? [];
  if (list.length === 0) return null;
  return (
    <CommandGroup heading={t("palette.commits")}>
      {list.map((c) => (
        <CommandItem
          key={c.hash}
          value={`commit:${c.hash}`}
          onSelect={run(() => {
            // The History list runs the same search, so the picked commit is in it.
            useHistorySearchStore.getState().setQuery(term, true);
            showHistoryOf(null);
            selectCommit(c.hash);
          })}
        >
          <GitCommitHorizontal />
          <span className="min-w-0 flex-1 truncate">{c.subject}</span>
          <span className="font-mono text-[11.5px] text-muted-foreground">{c.hash.slice(0, 7)}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function PullRequestResults({ repoPath, term, limit, run }: GroupProps) {
  const t = useT();
  const prs = usePullRequests(repoPath).data ?? [];
  const { open } = useOpenPullRequest(repoPath);
  const matches = rankByText(
    term,
    prs,
    (pr) => `#${pr.number} ${pr.title} ${pr.headRefName} ${pr.author.login}`,
    limit,
  );
  if (matches.length === 0) return null;
  return (
    <CommandGroup heading={t("view.github")}>
      {matches.map((pr) => (
        <CommandItem key={pr.number} value={`pr:${pr.number}`} onSelect={run(() => void open(pr))}>
          <GitPullRequest />
          <span className="min-w-0 flex-1 truncate">{pr.title}</span>
          <span className="font-mono text-[11.5px] text-muted-foreground">#{pr.number}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

/** The cached issues first, then Linear's own search of every connected workspace. */
function IssueResults({ term, remoteTerm, limit, run }: GroupProps & { remoteTerm: string }) {
  const t = useT();
  const setView = useWorkspaceStore((s) => s.setView);
  const cached = useWorkspaceIssues().data ?? [];
  const accounts = useLinearAccounts().data ?? [];
  const searchable = remoteTerm.length >= 2 && remoteTerm.length <= 200;
  const remote = useQueries({
    queries: accounts.map((a) => ({
      queryKey: ["linear", "search", a.id, remoteTerm],
      queryFn: () => gitBackend.linearSearchIssues(a.id, remoteTerm),
      enabled: searchable,
      staleTime: 60_000,
      placeholderData: keepPreviousData,
    })),
  });
  const found: WorkspaceIssue[] = searchable
    ? remote.flatMap((r, i) =>
        (r.data ?? []).map((issue) => ({ ...issue, orgId: accounts[i].id, orgName: accounts[i].name })),
      )
    : [];
  const key = (i: WorkspaceIssue) => `${i.orgId}:${i.id}`;
  const issues = mergeUnique(
    rankByText(term, cached, (i) => `${i.identifier} ${i.title}`, limit),
    found,
    key,
    limit,
  );
  if (issues.length === 0) return null;
  return (
    <CommandGroup heading={t("palette.issues")}>
      {issues.map((issue) => (
        <CommandItem
          key={key(issue)}
          value={`issue:${key(issue)}`}
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
  );
}

/** Agent runs started here, then saved Claude Code sessions not already among them. */
function ConversationResults({ repoPath, term, limit, run }: GroupProps) {
  const t = useT();
  const setView = useWorkspaceStore((s) => s.setView);
  const runs = useAgentsStore((s) => s.runs).filter((r) => r.repoPath === repoPath && r.thread === r.id);
  // Same cache as the Agents list.
  const sessions = useQuery({
    queryKey: ["agent-sessions", repoPath],
    queryFn: () => gitBackend.listAgentSessions(repoPath),
    staleTime: 30_000,
  });
  const fromApp = new Set(runs.map((r) => r.sessionId));
  const all = [
    ...runs.map((r) => ({ id: r.id, title: r.title, detail: "", type: "run" as const })),
    ...(sessions.data ?? [])
      .filter((s) => !fromApp.has(s.id))
      .map((s) => ({ id: s.id, title: s.title, detail: s.gitBranch ?? "", type: "session" as const })),
  ];
  const matches = rankByText(term, all, (c) => `${c.title} ${c.detail}`, limit);
  if (matches.length === 0) return null;
  return (
    <CommandGroup heading={t("palette.conversations")}>
      {matches.map((c) => (
        <CommandItem
          key={`${c.type}:${c.id}`}
          value={`${c.type}:${c.id}`}
          onSelect={run(() => {
            useAgentsStore.getState().select({ type: c.type, id: c.id });
            setView("agents");
          })}
        >
          <Bot />
          <span className="min-w-0 flex-1 truncate">{c.title}</span>
          {c.detail && (
            <span className="max-w-48 truncate font-mono text-[11.5px] text-muted-foreground">{c.detail}</span>
          )}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function WorkResults({ repoPath, term, limit, run }: GroupProps) {
  const t = useT();
  const setView = useWorkspaceStore((s) => s.setView);
  const work = useWorkItems(repoPath).data ?? [];
  const { open } = useOpenPullRequest(repoPath);
  // Searchable by title, branch, issue id and PR number.
  const text = (item: (typeof work)[number]) =>
    `${item.title} ${item.branch} ${item.issueId ?? ""} ${item.pr ? `#${item.pr.number}` : ""}`;
  const matches = rankByText(term, work, text, limit);
  if (matches.length === 0) return null;
  return (
    <CommandGroup heading={t("view.work")}>
      {matches.map((item) => {
        const { icon: Icon, className } = STATUS[item.status];
        return (
          <CommandItem
            key={item.key}
            value={`work:${item.key}`}
            onSelect={run(() => {
              useWorkStore.getState().select(item.branch);
              if (item.pr) void open(item.pr, "work");
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
  );
}
