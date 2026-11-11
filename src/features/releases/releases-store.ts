import { create } from "zustand";

/** What the Releases page shows: a GitHub or Linear release, a tag, or the new-release form (prefilled with a tag). */
export type ReleasesSelection =
  | { kind: "release"; id: number }
  | { kind: "linear"; id: string }
  | { kind: "tag"; name: string }
  | { kind: "new"; tag: string | null }
  | null;

export const useReleasesStore = create<{
  selection: ReleasesSelection;
  select: (selection: ReleasesSelection) => void;
}>()((set) => ({ selection: null, select: (selection) => set({ selection }) }));
