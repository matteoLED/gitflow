import { create } from "zustand";

/** What the Releases page shows: a release, a tag, or the new-release form (prefilled with a tag). */
export type ReleasesSelection =
  { kind: "release"; id: number } | { kind: "tag"; name: string } | { kind: "new"; tag: string | null } | null;

export const useReleasesStore = create<{
  selection: ReleasesSelection;
  select: (selection: ReleasesSelection) => void;
}>()((set) => ({ selection: null, select: (selection) => set({ selection }) }));
