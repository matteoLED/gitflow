import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Which pages have their list column folded away (remembered per page). */
type LayoutState = {
  collapsedLists: Record<string, boolean>;
  toggleList: (page: string) => void;
  /** History and Changes with only what's needed to read a change: no sidebar, branch list or file column. */
  focus: boolean;
  toggleFocus: () => void;
};

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      collapsedLists: {},
      focus: false,
      toggleFocus: () => set(({ focus }) => ({ focus: !focus })),
      toggleList: (page) =>
        set(({ collapsedLists }) => ({ collapsedLists: { ...collapsedLists, [page]: !collapsedLists[page] } })),
    }),
    { name: "gitflow.layout" },
  ),
);
