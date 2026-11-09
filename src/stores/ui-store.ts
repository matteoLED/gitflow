import { create } from "zustand";

type UiState = {
  settingsOpen: boolean;
  /** Settings page to open on; null is the first one. */
  settingsPage: string | null;
  terminalOpen: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  /** AI side panel (⌘I), next to whatever view is open. */
  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
  setTerminalOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean, page?: string | null) => void;
  /** Review popover of the active pull request, opened from its button or from a file's menu. */
  reviewOpen: boolean;
  reviewDraft: string;
  setReviewOpen: (open: boolean) => void;
  setReviewDraft: (draft: string) => void;
  /** Opens the review with a reference to a file, so a comment can be about it. */
  commentOnFile: (path: string) => void;
};

export const useUiStore = create<UiState>()((set) => ({
  settingsOpen: false,
  settingsPage: null,
  terminalOpen: false,
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  assistantOpen: false,
  setAssistantOpen: (open) => set({ assistantOpen: open }),
  setTerminalOpen: (open) => set({ terminalOpen: open }),
  setSettingsOpen: (open, page = null) => set({ settingsOpen: open, settingsPage: page }),
  reviewOpen: false,
  reviewDraft: "",
  setReviewOpen: (open) => set({ reviewOpen: open }),
  setReviewDraft: (draft) => set({ reviewDraft: draft }),
  commentOnFile: (path) =>
    set(({ reviewDraft }) => ({
      reviewOpen: true,
      reviewDraft: `${reviewDraft}${reviewDraft && !reviewDraft.endsWith("\n") ? "\n\n" : ""}\`${path}\`: `,
    })),
}));
