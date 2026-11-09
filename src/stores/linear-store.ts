import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Shows every connected workspace at once. */
export const ALL_WORKSPACES = "all";

export type LinearPage = "mine" | "cycle" | "projects";

type LinearUi = {
  /** Linear organization shown, ALL_WORKSPACES for all of them; null means the first connected one. */
  account: string | null;
  issue: string | null;
  /** Organization of the open issue (they differ per issue in the all-workspaces view). */
  issueOrg: string | null;
  /** Page of the Linear view: the user's issues, the current cycle, or the projects (one when `project` is set). */
  page: LinearPage;
  /** Project shown on the board instead of the user's issues. */
  project: string | null;
  setPage: (page: LinearPage) => void;
  setProject: (id: string | null) => void;
  /** Issues as Linear's board or as its list. */
  layout: "board" | "list";
  setLayout: (layout: "board" | "list") => void;
  /** Team of the last issue created here, preselected for the next one. */
  lastTeam: string | null;
  setAccount: (id: string | null) => void;
  setIssue: (id: string | null, orgId?: string | null) => void;
};

export const useLinearStore = create<LinearUi>()(
  persist(
    (set) => ({
      account: null,
      issue: null,
      issueOrg: null,
      lastTeam: null,
      page: "mine",
      project: null,
      setPage: (page) => set({ page, project: null, issue: null, issueOrg: null }),
      setProject: (project) => set({ page: "projects", project, issue: null, issueOrg: null }),
      layout: "board",
      setLayout: (layout) => set({ layout }),
      setAccount: (account) =>
        set((s) => ({
          account,
          issue: null,
          issueOrg: null,
          project: null,
          page: s.page,
        })),
      setIssue: (issue, issueOrg = null) => set({ issue, issueOrg }),
    }),
    { name: "gitflow.linear" },
  ),
);
