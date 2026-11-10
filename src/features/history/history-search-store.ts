import { create } from "zustand";
import type { HistorySearch } from "@/types/git";
import { parseHistoryQuery } from "./search-query";

type HistorySearchState = {
  /** What the search box shows. */
  query: string;
  /** Parsed query, settled 300 ms after typing stops: each change runs `git log`. */
  search: HistorySearch;
  /** Set by ⌘K "Search history…", cleared once the box has focus. */
  focusRequested: boolean;
  setQuery: (query: string, immediate?: boolean) => void;
  requestFocus: () => void;
  focusHandled: () => void;
};

let timer: ReturnType<typeof setTimeout> | undefined;

/** Shared by the commit list and the commit details, which looks the selected commit up in the same results. */
export const useHistorySearchStore = create<HistorySearchState>()((set) => ({
  query: "",
  search: {},
  focusRequested: false,
  setQuery: (query, immediate = false) => {
    set({ query });
    clearTimeout(timer);
    const apply = () => set({ search: parseHistoryQuery(query) });
    if (immediate) apply();
    else timer = setTimeout(apply, 300);
  },
  requestFocus: () => set({ focusRequested: true }),
  focusHandled: () => set({ focusRequested: false }),
}));
