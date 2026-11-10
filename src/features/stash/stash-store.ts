import { create } from "zustand";

type StashState = {
  open: boolean;
  /** Hash of the stash shown; the first one when null or gone (indexes shift after a pop or drop). */
  selected: string | null;
  show: (hash?: string | null) => void;
  setOpen: (open: boolean) => void;
  select: (hash: string) => void;
};

/** The stash dialog, opened from the Changes view, the branch sidebar or ⌘K. */
export const useStashStore = create<StashState>()((set) => ({
  open: false,
  selected: null,
  show: (hash = null) => set({ open: true, selected: hash }),
  setOpen: (open) => set({ open }),
  select: (hash) => set({ selected: hash }),
}));
