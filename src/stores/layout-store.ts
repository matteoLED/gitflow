import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Which pages have their list column folded away (remembered per page). */
type LayoutState = {
  collapsedLists: Record<string, boolean>;
  toggleList: (page: string) => void;
};

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      collapsedLists: {},
      toggleList: (page) =>
        set(({ collapsedLists }) => ({ collapsedLists: { ...collapsedLists, [page]: !collapsedLists[page] } })),
    }),
    { name: "gitflow.layout" },
  ),
);
