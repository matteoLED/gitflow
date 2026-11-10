import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RepositoryInfo, WorkingSide } from "@/types/git";

/** history: branches + commits; github: pull requests + their commits; changes: working tree; agents: AI runs. */
export type View =
  "home" | "work" | "history" | "github" | "changes" | "ci" | "agents" | "preview" | "linear" | "browser" | "graph" | "editor";

/** The pull request being reviewed: `base` is its merge-base, so `base..head` is its whole diff. */
export type ActivePullRequest = {
  number: number;
  title: string;
  author: string;
  base: string | null;
  head: string;
  url: string;
};

export type SelectedChange = { path: string; previousPath: string | null; side: WorkingSide };

type WorkspaceState = {
  repo: RepositoryInfo | null;
  /** Open repositories, in the order they were opened (⌘1…⌘9 follow it). The active one is `repo`. */
  repos: RepositoryInfo[];
  /** Every repository opened before, newest first, closed ones included (capped). */
  recentRepos: RepositoryInfo[];
  /** Selections of the inactive repositories, restored when switching back. */
  sessions: Record<string, Session>;
  view: View;
  /** Revision (or range) whose history is shown; null means HEAD. */
  historyRev: string | null;
  /** Human title for historyRev when it isn't a ref name (e.g. a pull request). */
  historyLabel: string | null;
  selectedCommitHash: string | null;
  /** When set, the selected commit is compared with this base instead of its parent (a PR's whole diff). */
  compareBase: string | null;
  pullRequest: ActivePullRequest | null;
  selectedFilePath: string | null;
  selectedChange: SelectedChange | null;
  /** Files of the selected commit whose diff card is collapsed. */
  collapsedDiffs: ReadonlySet<string>;
  openRepo: (repo: RepositoryInfo) => void;
  switchRepo: (path: string) => void;
  closeRepo: (path: string) => void;
  forgetRecent: (path: string) => void;
  setView: (view: View) => void;
  showHistoryOf: (rev: string | null, label?: string) => void;
  /** Opens a pull request in the GitHub view, or in `view` (the Work page shows it in place). */
  openPullRequest: (pr: ActivePullRequest, range: string, view?: View) => void;
  /** Selects the active pull request's whole diff. */
  showPullRequestChanges: () => void;
  selectCommit: (hash: string) => void;
  selectFile: (path: string) => void;
  selectChange: (change: SelectedChange | null) => void;
  toggleDiff: (path: string) => void;
  setCollapsedDiffs: (paths: ReadonlySet<string>) => void;
};

const cleared = () => ({
  historyRev: null,
  historyLabel: null,
  selectedCommitHash: null,
  compareBase: null,
  pullRequest: null,
  selectedFilePath: null,
  selectedChange: null,
  collapsedDiffs: new Set<string>(),
});

const MAX_RECENT = 12;

type Session = Pick<
  WorkspaceState,
  | "view"
  | "historyRev"
  | "historyLabel"
  | "selectedCommitHash"
  | "compareBase"
  | "pullRequest"
  | "selectedFilePath"
  | "selectedChange"
  | "collapsedDiffs"
>;

const freshSession = (): Session => ({ view: "home", ...cleared() });

const sessionOf = (s: Session): Session => ({
  view: s.view,
  historyRev: s.historyRev,
  historyLabel: s.historyLabel,
  selectedCommitHash: s.selectedCommitHash,
  compareBase: s.compareBase,
  pullRequest: s.pullRequest,
  selectedFilePath: s.selectedFilePath,
  selectedChange: s.selectedChange,
  collapsedDiffs: s.collapsedDiffs,
});

/** Saves the active repository's selections, then restores the target's (or starts fresh). */
function activate(state: WorkspaceState, repo: RepositoryInfo) {
  const sessions = state.repo ? { ...state.sessions, [state.repo.path]: sessionOf(state) } : state.sessions;
  return { repo, sessions, ...(sessions[repo.path] ?? freshSession()) };
}

/** Selections cascade: a new repo clears everything, a new revision clears the commit, a new commit the file. */
export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      repo: null,
      repos: [],
      recentRepos: [],
      sessions: {},
      ...freshSession(),
      openRepo: (repo) =>
        set((state) => ({
          repos: state.repos.some((r) => r.path === repo.path)
            ? state.repos.map((r) => (r.path === repo.path ? repo : r))
            : [...state.repos, repo],
          recentRepos: [repo, ...state.recentRepos.filter((r) => r.path !== repo.path)].slice(0, MAX_RECENT),
          ...activate(state, repo),
        })),
      switchRepo: (path) =>
        set((state) => {
          const target = state.repos.find((r) => r.path === path);
          return target && target.path !== state.repo?.path ? activate(state, target) : {};
        }),
      forgetRecent: (path) => set(({ recentRepos }) => ({ recentRepos: recentRepos.filter((r) => r.path !== path) })),
      // Closing the active repository moves to its right-hand neighbour, else the left one.
      closeRepo: (path) =>
        set((state) => {
          const index = state.repos.findIndex((r) => r.path === path);
          const repos = state.repos.filter((r) => r.path !== path);
          const sessions = Object.fromEntries(Object.entries(state.sessions).filter(([key]) => key !== path));
          if (state.repo?.path !== path) return { repos, sessions };
          const next = repos[index] ?? repos[index - 1];
          if (!next) return { repos, sessions, repo: null, ...freshSession() };
          return { repos, ...activate({ ...state, repo: null, sessions }, next) };
        }),
      // A pull request is reviewed in the GitHub view: the History page always shows the branch again,
      // never a PR opened earlier (whose commits aren't the ones just made).
      setView: (view) =>
        set(({ pullRequest }) =>
          view === "history" && pullRequest
            ? {
                view,
                historyRev: null,
                historyLabel: null,
                pullRequest: null,
                selectedCommitHash: null,
                compareBase: null,
                selectedFilePath: null,
              }
            : { view },
        ),
      // Keeps the GitHub view when opening a pull request's commits; anything else shows branch history.
      showHistoryOf: (rev, label) =>
        set(({ view }) => ({
          view: view === "github" && label ? "github" : "history",
          historyRev: rev,
          historyLabel: label ?? null,
          selectedCommitHash: null,
          compareBase: null,
          pullRequest: null,
          selectedFilePath: null,
        })),
      // Opening a pull request lands on its whole diff, ready to review; its commits stay one click away.
      openPullRequest: (pr, range, view = "github") =>
        set({
          view,
          historyRev: range,
          historyLabel: `#${pr.number} ${pr.title}`,
          pullRequest: pr,
          selectedCommitHash: pr.head,
          compareBase: pr.base,
          selectedFilePath: null,
          collapsedDiffs: new Set(),
        }),
      showPullRequestChanges: () =>
        set(({ pullRequest }) =>
          pullRequest
            ? {
                selectedCommitHash: pullRequest.head,
                compareBase: pullRequest.base,
                selectedFilePath: null,
                collapsedDiffs: new Set(),
              }
            : {},
        ),
      selectCommit: (hash) =>
        set({ selectedCommitHash: hash, compareBase: null, selectedFilePath: null, collapsedDiffs: new Set() }),
      // Picking a file in the tree always reveals its diff, even if its card was collapsed.
      selectFile: (path) =>
        set(({ collapsedDiffs }) => ({
          selectedFilePath: path,
          collapsedDiffs: new Set([...collapsedDiffs].filter((p) => p !== path)),
        })),
      selectChange: (change) => set({ selectedChange: change }),
      toggleDiff: (path) =>
        set(({ collapsedDiffs }) => {
          const next = new Set(collapsedDiffs);
          if (!next.delete(path)) next.add(path);
          return { collapsedDiffs: next };
        }),
      setCollapsedDiffs: (paths) => set({ collapsedDiffs: paths }),
    }),
    // Open repositories survive a restart; selections are per session.
    {
      name: "gitflow.workspace",
      version: 2,
      partialize: ({ repo, repos, recentRepos }) => ({ repo, repos, recentRepos }),
      // v0 had only a recent list, v1 only the open list: both seed the history.
      migrate: (persisted) => {
        const old = persisted as {
          repo?: RepositoryInfo | null;
          repos?: RepositoryInfo[];
          recentRepos?: RepositoryInfo[];
        };
        const current = old.repo ? [old.repo] : [];
        return {
          repo: old.repo ?? null,
          repos: old.repos ?? current,
          recentRepos: old.recentRepos ?? old.repos ?? current,
        };
      },
    },
  ),
);
