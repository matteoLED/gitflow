import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ActivePullRequest, View } from "./workspace-store";

/** What a tab shows: a page, plus the pull request or Linear issue open in it. */
export type TabPlace = {
  /** Repository the tab belongs to: activating it switches there. */
  repoPath: string | null;
  view: View;
  pullRequest: ActivePullRequest | null;
  /** History range of the pull request, to reopen it. */
  range: string | null;
  issue: { id: string; orgId: string | null } | null;
  title: string;
};

export type Tab = TabPlace & { id: string };

const MAX_RECENT = 15;

type TabsState = {
  tabs: Tab[];
  active: string;
  /** Places left recently (navigated away from or closed), newest first. */
  recent: TabPlace[];
  /** The active tab now shows `place` (the app navigated). */
  follow: (place: TabPlace) => void;
  open: (place: TabPlace) => string;
  activate: (id: string) => void;
  close: (id: string) => void;
};

const HOME: TabPlace = { repoPath: null, view: "home", pullRequest: null, range: null, issue: null, title: "" };

export const placeKey = (p: TabPlace) => `${p.repoPath}:${p.view}:${p.pullRequest?.number ?? ""}:${p.issue?.id ?? ""}`;

const remember = (recent: TabPlace[], place: TabPlace) =>
  [place, ...recent.filter((r) => placeKey(r) !== placeKey(place))].slice(0, MAX_RECENT);

let counter = 0;
const newId = () => `tab-${Date.now().toString(36)}-${counter++}`;

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => {
      const first = { ...HOME, id: newId() };
      return {
        tabs: [first],
        active: first.id,
        recent: [],
        follow: (place) =>
          set(({ tabs, active, recent }) => {
            const current = tabs.find((t) => t.id === active);
            if (!current) return {};
            const moved = placeKey(current) !== placeKey(place);
            return {
              tabs: tabs.map((t) => (t.id === active ? { ...place, id: t.id } : t)),
              recent: moved && current.title ? remember(recent, current) : recent,
            };
          }),
        open: (place) => {
          const tab = { ...place, id: newId() };
          set(({ tabs }) => ({ tabs: [...tabs, tab], active: tab.id }));
          return tab.id;
        },
        activate: (id) => set({ active: id }),
        // Closing the last tab leaves a fresh Home tab, like a browser window that stays open.
        close: (id) => {
          const { tabs, active, recent } = get();
          const index = tabs.findIndex((t) => t.id === id);
          if (index < 0) return;
          const closed = tabs[index];
          const rest = tabs.filter((t) => t.id !== id);
          const next = rest.length ? rest : [{ ...HOME, id: newId() }];
          const nextActive = active === id ? (next[index] ?? next[index - 1] ?? next[0]).id : active;
          set({ tabs: next, active: nextActive, recent: closed.title ? remember(recent, closed) : recent });
        },
      };
    },
    { name: "gitflow.tabs", version: 1 },
  ),
);
