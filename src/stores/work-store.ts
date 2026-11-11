import { create } from "zustand";
import { persist } from "zustand/middleware";

const WORK_FILTERS = ["all", "mine", "pulls", "cleanup"] as const;

/** Which work the Work page lists: everything, the user's own branches, open pull requests, or what to clean up. */
export type WorkFilter = (typeof WORK_FILTERS)[number];

const isWorkFilter = (value: unknown): value is WorkFilter => WORK_FILTERS.some((f) => f === value);

type WorkUi = {
  filter: WorkFilter;
  setFilter: (filter: WorkFilter) => void;
  /** Branch whose detail is open; null shows the list. */
  selected: string | null;
  select: (branch: string | null) => void;
};

export const useWorkStore = create<WorkUi>()(
  persist(
    (set) => ({
      filter: "all",
      setFilter: (filter) => set({ filter, selected: null }),
      selected: null,
      select: (selected) => set({ selected }),
    }),
    // The open detail isn't kept: its pull request lives in the workspace store, which starts empty.
    {
      name: "gitflow.work",
      partialize: ({ filter }) => ({ filter }),
      // A filter that no longer exists (the old "inbox") falls back to all work.
      merge: (persisted, current) => {
        const filter = (persisted as { filter?: unknown } | undefined)?.filter;
        return { ...current, filter: isWorkFilter(filter) ? filter : "all" };
      },
    },
  ),
);
