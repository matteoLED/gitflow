import { create } from "zustand";
import { persist } from "zustand/middleware";

export type BrowserTab = { id: string; url: string; title: string; loading?: boolean };

/** What the native tabs report (see `browser.rs`). */
export type BrowserEvent =
  | { type: "url"; id: string; url: string }
  | { type: "title"; id: string; title: string }
  | { type: "loading"; id: string; loading: boolean }
  | { type: "open"; url: string }
  | { type: "key"; id: string; action: string };

export type BrowserShortcut = "new" | "address" | "close" | "reload" | "back" | "forward";

type BrowserState = {
  tabs: BrowserTab[];
  active: string | null;
  /** Latest shortcut pressed inside a page, for the panel to act on. */
  shortcut: { action: BrowserShortcut; at: number } | null;
  open: (url: string) => void;
  close: (id: string) => void;
  /** null shows the new-tab page. */
  select: (id: string | null) => void;
  apply: (event: BrowserEvent) => void;
};

const isWebUrl = (url: string) => /^https?:\/\//.test(url);

const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Arc-style tabs, remembered across launches (each reopens on its last address). */
export const useBrowserStore = create<BrowserState>()(
  persist(
    (set) => ({
      tabs: [],
      active: null,
      shortcut: null,
      open: (url) =>
        set((s) => {
          const tab = { id: newId(), url, title: "" };
          return { tabs: [...s.tabs, tab], active: tab.id };
        }),
      close: (id) =>
        set((s) => {
          const i = s.tabs.findIndex((t) => t.id === id);
          const tabs = s.tabs.filter((t) => t.id !== id);
          const active = s.active === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : s.active;
          return { tabs, active };
        }),
      select: (id) => set({ active: id }),
      apply: (event) =>
        set((s) => {
          if (event.type === "key") return { shortcut: { action: event.action as BrowserShortcut, at: Date.now() } };
          if (event.type === "open") {
            const tab = { id: newId(), url: event.url, title: "" };
            return { tabs: [...s.tabs, tab], active: tab.id };
          }
          // Only web addresses: a tab saved on `about:blank` could never be reopened.
          if (event.type === "url" && !isWebUrl(event.url)) return {};
          const patch =
            event.type === "url"
              ? { url: event.url }
              : event.type === "title"
                ? { title: event.title }
                : { loading: event.loading };
          return { tabs: s.tabs.map((t) => (t.id === event.id ? { ...t, ...patch } : t)) };
        }),
    }),
    {
      name: "gitflow-browser",
      version: 1,
      // v0 could save a tab on `about:blank`: such tabs can't be reopened, so they are dropped.
      migrate: (persisted) => {
        const state = persisted as Pick<BrowserState, "tabs" | "active">;
        const tabs = state.tabs.filter((t) => isWebUrl(t.url));
        return { tabs, active: tabs.some((t) => t.id === state.active) ? state.active : (tabs[0]?.id ?? null) };
      },
      partialize: (s) => ({ tabs: s.tabs.map(({ id, url, title }) => ({ id, url, title })), active: s.active }),
    },
  ),
);
