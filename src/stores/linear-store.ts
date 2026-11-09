import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Shows every connected workspace at once. */
export const ALL_WORKSPACES = "all";

type LinearUi = {
  /** Linear organization shown, ALL_WORKSPACES for all of them; null means the first connected one. */
  account: string | null;
  issue: string | null;
  /** Organization of the open issue (they differ per issue in the all-workspaces view). */
  issueOrg: string | null;
  setAccount: (id: string | null) => void;
  setIssue: (id: string | null, orgId?: string | null) => void;
};

export const useLinearStore = create<LinearUi>()(
  persist(
    (set) => ({
      account: null,
      issue: null,
      issueOrg: null,
      setAccount: (account) => set({ account, issue: null, issueOrg: null }),
      setIssue: (issue, issueOrg = null) => set({ issue, issueOrg }),
    }),
    { name: "gitflow.linear" },
  ),
);
