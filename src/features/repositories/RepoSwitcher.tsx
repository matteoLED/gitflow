import { useShallow } from "zustand/react/shallow";
import { Fragment, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, ChevronsUpDown, FolderOpen, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MiddleTruncate } from "@/components/middle-truncate";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { RepositoryInfo } from "@/types/git";
import { useOpenRepository } from "./use-open-repository";

/** Letter tile with a hue derived from the name, so each repository is recognisable at a glance. */
export function RepoTile({ name, className }: { name: string; className?: string }) {
  const hue = [...name].reduce((sum, char) => sum + char.charCodeAt(0) * 7, 0) % 360;
  return (
    <span
      aria-hidden
      style={{ backgroundColor: `hsl(${hue} 35% 32%)`, color: `hsl(${hue} 70% 85%)` }}
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-md text-[11px] font-semibold uppercase",
        className,
      )}
    >
      {name.charAt(0)}
    </span>
  );
}

/** ⌘P opens the switcher, ⌘1…⌘9 jump straight to the nth open repository. */
function useRepoShortcuts(openSwitcher: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.shiftKey || event.altKey) return;
      const { repos, switchRepo } = useWorkspaceStore.getState();
      if (event.key.toLowerCase() === "p") openSwitcher();
      else if (/^[1-9]$/.test(event.key) && repos[Number(event.key) - 1]) switchRepo(repos[Number(event.key) - 1].path);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSwitcher]);
}

const KBD = "font-sans text-[11.5px] text-muted-foreground";
const SECTION = "px-2 pt-1.5 pb-0.5 text-[10.5px] font-medium tracking-wider text-muted-foreground uppercase";

type Entry = { repo: RepositoryInfo; open: boolean };

type RowProps = {
  entry: Entry;
  shortcut: number | null;
  current: boolean;
  highlighted: boolean;
  onPick: () => void;
  onRemove: () => void;
};

function RepoRow({ entry: { repo, open }, shortcut, current, highlighted, onPick, onRemove }: RowProps) {
  const t = useT();
  return (
    <li
      role="option"
      aria-selected={highlighted}
      className={cn("group/repo flex items-center gap-2 rounded-md px-2 py-1", highlighted && "bg-white/8")}
    >
      <button type="button" tabIndex={-1} onClick={onPick} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <RepoTile name={repo.name} className={cn(!open && "opacity-60")} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 truncate text-[13px] font-medium">
            {repo.name}
            {current && <Check aria-hidden className="size-3 text-primary" />}
          </span>
          <MiddleTruncate text={repo.path} tail={20} className="text-[11px] text-muted-foreground" />
        </span>
      </button>
      {shortcut !== null && <kbd className={cn(KBD, "group-hover/repo:hidden")}>⌘{shortcut}</kbd>}
      <button
        type="button"
        tabIndex={-1}
        aria-label={t(open ? "repos.close" : "repos.forget", { name: repo.name })}
        onClick={onRemove}
        className="hidden size-4 place-items-center rounded text-muted-foreground group-hover/repo:grid hover:bg-white/[0.14] hover:text-foreground"
      >
        <X aria-hidden className="size-3" />
      </button>
    </li>
  );
}

/** Open repositories first (⌘1…⌘9), then the history of closed ones; both filtered by name or path. */
function useEntries(query: string): Entry[] {
  const { repos, recentRepos } = useWorkspaceStore(useShallow((s) => ({ repos: s.repos, recentRepos: s.recentRepos })));
  const needle = query.trim().toLowerCase();
  const matches = (r: RepositoryInfo) => `${r.name} ${r.path}`.toLowerCase().includes(needle);
  const openPaths = new Set(repos.map((r) => r.path));
  return [
    ...repos.filter(matches).map((repo) => ({ repo, open: true })),
    ...recentRepos.filter((r) => !openPaths.has(r.path) && matches(r)).map((repo) => ({ repo, open: false })),
  ];
}

function RepoList({ current, onDone }: { current: RepositoryInfo; onDone: () => void }) {
  const t = useT();
  const { repos, switchRepo, closeRepo, forgetRecent } = useWorkspaceStore(
    useShallow((s) => ({
      repos: s.repos,
      switchRepo: s.switchRepo,
      closeRepo: s.closeRepo,
      forgetRecent: s.forgetRecent,
    })),
  );
  const { pick, reopen } = useOpenRepository();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const entries = useEntries(query);
  const firstRecent = entries.findIndex((e) => !e.open);

  const choose = (entry: Entry | undefined) => {
    if (!entry) return;
    if (entry.open) switchRepo(entry.repo.path);
    else void reopen(entry.repo.path);
    onDone();
  };
  const onKeyDown = (event: ReactKeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) setHighlight((i) => (i + step + entries.length) % Math.max(entries.length, 1));
    else if (event.key === "Enter") choose(entries[highlight]);
    else return;
    event.preventDefault();
  };

  return (
    <>
      <input
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded
        aria-controls="repo-switcher-list"
        aria-label={t("repos.filter")}
        placeholder={t("repos.filter")}
        className="h-8 w-full border-b border-white/[0.07] bg-transparent px-3 text-[13px] outline-none placeholder:text-muted-foreground"
      />
      <ul id="repo-switcher-list" role="listbox" aria-label={t("repos.title")} className="max-h-80 overflow-y-auto p-1">
        {entries.map((entry, index) => {
          const position = repos.indexOf(entry.repo);
          return (
            <Fragment key={entry.repo.path}>
              {index === 0 && entry.open && firstRecent !== -1 && (
                <li role="presentation" className={SECTION}>
                  {t("repos.open")}
                </li>
              )}
              {index === firstRecent && (
                <li role="presentation" className={SECTION}>
                  {t("repos.recent")}
                </li>
              )}
              <RepoRow
                entry={entry}
                shortcut={entry.open && position < 9 ? position + 1 : null}
                current={entry.repo.path === current.path}
                highlighted={index === highlight}
                onPick={() => choose(entry)}
                onRemove={() => (entry.open ? closeRepo : forgetRecent)(entry.repo.path)}
              />
            </Fragment>
          );
        })}
        {entries.length === 0 && (
          <li className="px-2 py-2 text-[12.5px] text-muted-foreground">{t("repos.noMatch")}</li>
        )}
      </ul>
      <button
        type="button"
        onClick={() => {
          onDone();
          void pick();
        }}
        className="flex h-8 w-full items-center gap-2 border-t border-white/[0.07] px-3 text-[13px] text-foreground/90 hover:bg-white/[0.08]"
      >
        <FolderOpen aria-hidden className="size-3.5 text-muted-foreground" />
        {t("menu.open")}
        <kbd className={cn(KBD, "ml-auto")}>⌘O</kbd>
      </button>
    </>
  );
}

/** Active repository at the top of the sidebar; opens a filterable list of every open repository. */
export function RepoSwitcher({ repo }: { repo: RepositoryInfo }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  useRepoShortcuts(() => setOpen(true));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("repos.switch", { name: repo.name })}
          title="⌘P"
          className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-[13.5px] font-semibold outline-none hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-white/8"
        >
          <RepoTile name={repo.name} />
          <span className="truncate">{repo.name}</span>
          <ChevronsUpDown aria-hidden className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-72 overflow-hidden rounded-xl p-0 shadow-xl"
      >
        <RepoList current={repo} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
