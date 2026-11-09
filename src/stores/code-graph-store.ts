import { create } from "zustand";
import { persist } from "zustand/middleware";

export type GraphSection = "impact" | "hotspots" | "map";
/** What changes the impact is measured on: uncommitted work, the last commit, or the whole branch. */
export type ImpactBase = "worktree" | "last-commit" | "branch";

type CodeGraphState = {
  section: GraphSection;
  base: ImpactBase;
  hideTests: boolean;
  set: (patch: Partial<Pick<CodeGraphState, "section" | "base" | "hideTests">>) => void;
};

export const useCodeGraphStore = create<CodeGraphState>()(
  persist((set) => ({ section: "impact", base: "branch", hideTests: true, set: (patch) => set(patch) }), {
    name: "gitflow-code-graph",
  }),
);
