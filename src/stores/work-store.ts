import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Which work the Work page lists: everything, the user's own branches, open pull requests, or what to clean up. */
export type WorkFilter = "inbox" | "all" | "mine" | "pulls" | "cleanup";

type WorkUi = {
  filter: WorkFilter;
  setFilter: (filter: WorkFilter) => void;
  /** Branch whose detail is open; null shows the list. */
  selected: string | null;
  select: (branch: string | null) => void;
  /** Inbox items marked done, with the version they had: one that changes since comes back. */
  dismissed: Record<string, string>;
  dismiss: (key: string, version: string) => void;
};

export const useWorkStore = create<WorkUi>()(
  persist(
    (set) => ({
      filter: "all",
      setFilter: (filter) => set({ filter, selected: null }),
      selected: null,
      select: (selected) => set({ selected }),
      dismissed: {},
      dismiss: (key, version) => set((s) => ({ dismissed: { ...s.dismissed, [key]: version } })),
    }),
    // The open detail isn't kept: its pull request lives in the workspace store, which starts empty.
    { name: "gitflow.work", partialize: ({ filter, dismissed }) => ({ filter, dismissed }) },
  ),
);
