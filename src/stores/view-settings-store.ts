import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DiffLayout = "unified" | "split";
export type FileListMode = "tree" | "list";
export type FileGrouping = "none" | "status";

export type ViewSettings = {
  layout: DiffLayout;
  syntaxHighlighting: boolean;
  wrapLines: boolean;
  showLineCounts: boolean;
  fileList: FileListMode;
  grouping: FileGrouping;
  hideGenerated: boolean;
  firstParentOnly: boolean;
  hideMerges: boolean;
};

const DEFAULTS: ViewSettings = {
  layout: "unified",
  syntaxHighlighting: true,
  wrapLines: true,
  showLineCounts: true,
  fileList: "tree",
  grouping: "none",
  hideGenerated: false,
  firstParentOnly: false,
  hideMerges: false,
};

type ViewSettingsState = ViewSettings & {
  set: <K extends keyof ViewSettings>(key: K, value: ViewSettings[K]) => void;
};

/** Diff, file-list and history display preferences, remembered across launches. */
export const useViewSettings = create<ViewSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (key, value) => set({ [key]: value } as Pick<ViewSettings, typeof key>),
    }),
    { name: "gitflow.view-settings" },
  ),
);
