import { create } from "zustand";

/** CI page: the workflow in view (null = all) and the run opened in detail. */
type CiState = {
  workflow: string | null;
  run: number | null;
  setWorkflow: (workflow: string | null) => void;
  openRun: (run: number | null) => void;
};

export const useCiStore = create<CiState>()((set) => ({
  workflow: null,
  run: null,
  setWorkflow: (workflow) => set({ workflow, run: null }),
  openRun: (run) => set({ run }),
}));
