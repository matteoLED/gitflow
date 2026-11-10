import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useWorkspaceStore } from "./workspace-store";

/** Per repository: the open tabs, the one in front, and the open folders of the tree. */
type RepoEditor = { tabs: string[]; active: string | null; folders: string[] };

/** A place to bring into view once its file is shown (from search, a diff, a comment). */
export type Reveal = { repo: string; path: string; line: number; column: number };

type EditorState = {
  repos: Record<string, RepoEditor>;
  sidebar: "files" | "search";
  reveal: Reveal | null;
  setSidebar: (sidebar: "files" | "search") => void;
  openAt: (repo: string, path: string, line: number, column?: number) => void;
  clearReveal: () => void;
  open: (repo: string, path: string) => void;
  close: (repo: string, path: string) => void;
  toggleFolder: (repo: string, folder: string, open?: boolean) => void;
};

const EMPTY: RepoEditor = { tabs: [], active: null, folders: [] };
export const editorOf = (s: EditorState, repo: string) => s.repos[repo] ?? EMPTY;

export const useEditorStore = create<EditorState>()(
  persist(
    (set) => {
      const update = (repo: string, change: (r: RepoEditor) => RepoEditor) =>
        set((s) => ({ repos: { ...s.repos, [repo]: change(editorOf(s, repo)) } }));
      return {
        repos: {},
        sidebar: "files",
        reveal: null,
        setSidebar: (sidebar) => set({ sidebar }),
        openAt: (repo, path, line, column = 1) => {
          update(repo, (r) => ({ ...r, tabs: r.tabs.includes(path) ? r.tabs : [...r.tabs, path], active: path }));
          set({ reveal: { repo, path, line, column } });
        },
        clearReveal: () => set({ reveal: null }),
        open: (repo, path) =>
          update(repo, (r) => ({ ...r, tabs: r.tabs.includes(path) ? r.tabs : [...r.tabs, path], active: path })),
        close: (repo, path) =>
          update(repo, (r) => {
            const index = r.tabs.indexOf(path);
            const tabs = r.tabs.filter((p) => p !== path);
            // Closing the front tab brings its neighbour forward, as in Zed.
            const active = r.active === path ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : r.active;
            return { ...r, tabs, active };
          }),
        toggleFolder: (repo, folder, open) =>
          update(repo, (r) => {
            const isOpen = r.folders.includes(folder);
            const next = open ?? !isOpen;
            if (next === isOpen) return r;
            return { ...r, folders: next ? [...r.folders, folder] : r.folders.filter((f) => f !== folder) };
          }),
      };
    },
    { name: "gitflow.editor", partialize: ({ repos, sidebar }) => ({ repos, sidebar }) },
  ),
);

/** Opens a file of the working tree in the editor, at a line when given, and switches to the editor. */
export function openInEditor(repo: string, path: string, line = 1, column = 1) {
  useEditorStore.getState().openAt(repo, path, line, column);
  useWorkspaceStore.getState().setView("editor");
}
