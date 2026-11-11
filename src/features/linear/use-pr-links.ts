import { useEffect } from "react";
import { type QueryClient, useQueries, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { useGithubUser, usePullRequests } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { useNoticesStore } from "@/stores/notices-store";
import type { LinearAccount, LinearIssueDetail, LinearTeamStates, PullRequest } from "@/types/git";
import { teamStatesQuery, useLinearAccounts } from "./linear-queries";
import { forwardState, linkedIdentifiers, type PrMove, type PrStatus, prStatus, prTransitions } from "./pr-links";

type Team = { orgId: string; team: LinearTeamStates };

const MAX_APPLIED = 500;

type Lifecycle = {
  /** Moves Linear issues along with their pull requests (In Review on open, Done on merge). */
  autoMove: boolean;
  setAutoMove: (on: boolean) => void;
  /** Status of each pull request at the last look, per repository: transitions are what changed since. */
  seen: Record<string, Record<number, PrStatus>>;
  /** Moves already made ("repo#12:merged:MNT-940"), so each fires once. */
  applied: string[];
};

export const usePrLifecycleStore = create<Lifecycle>()(
  persist(
    (set) => ({
      autoMove: true,
      setAutoMove: (autoMove) => set({ autoMove }),
      seen: {},
      applied: [],
    }),
    { name: "gitflow.pr-lifecycle" },
  ),
);

const byKey = (accounts: LinearAccount[], lists: (LinearTeamStates[] | undefined)[]) =>
  new Map<string, Team>(
    lists.flatMap((teams, i) => (teams ?? []).map((team) => [team.key.toUpperCase(), { orgId: accounts[i].id, team }])),
  );

/** Every team of the connected workspaces, by key ("MNT"). */
export function useTeamDirectory(): Map<string, Team> {
  const accounts = useLinearAccounts().data ?? [];
  return useQueries({
    queries: accounts.map((a) => teamStatesQuery(a.id)),
    combine: (results) =>
      byKey(
        accounts,
        results.map((r) => r.data),
      ),
  });
}

export type LinkedIssue = { identifier: string; orgId: string; issue: LinearIssueDetail | undefined };

/** The Linear issues a pull request names in its branch or title. */
export function useLinkedIssues(branch: string, title: string): LinkedIssue[] {
  const teams = useTeamDirectory();
  const linked = linkedIdentifiers([branch, title], [...teams.keys()]).flatMap((identifier) => {
    const team = teams.get(identifier.split("-")[0]);
    return team ? [{ identifier, orgId: team.orgId }] : [];
  });
  return useQueries({
    queries: linked.map(({ identifier, orgId }) => ({
      queryKey: ["linear", "issue", orgId, identifier],
      queryFn: () => gitBackend.linearIssue(orgId, identifier),
      staleTime: 30_000,
    })),
    combine: (results) => linked.map((l, i) => ({ ...l, issue: results[i]?.data })),
  });
}

async function teamDirectory(client: QueryClient) {
  const accounts = await client.fetchQuery({
    queryKey: ["linear", "accounts"],
    queryFn: gitBackend.linearAccounts,
    staleTime: Infinity,
  });
  return byKey(accounts, await Promise.all(accounts.map((a) => client.fetchQuery(teamStatesQuery(a.id)))));
}

/** Moves one issue a step forward, with an Undo back to where it was. */
async function moveIssue(client: QueryClient, teams: Map<string, Team>, identifier: string, move: PrMove) {
  const entry = teams.get(identifier.split("-")[0]);
  if (!entry) return;
  const issue = await gitBackend.linearIssue(entry.orgId, identifier);
  const states = (teams.get(issue.team.key.toUpperCase()) ?? entry).team.states.nodes;
  const target = forwardState(issue.state, states, move);
  const previous = issue.state.id;
  if (!target || !previous) return;
  const refresh = () => client.invalidateQueries({ queryKey: ["linear"] });
  await gitBackend.linearSetIssueState(entry.orgId, issue.id, target.id);
  void refresh();
  const t = getT();
  useNoticesStore.getState().notify({
    tone: "success",
    title: t("linear.autoMoved", { id: issue.identifier, state: target.name }),
    action: {
      label: t("undo.confirm"),
      run: () => void gitBackend.linearSetIssueState(entry.orgId, issue.id, previous).then(refresh),
    },
  });
}

async function syncPullRequests(client: QueryClient, repoPath: string, prs: PullRequest[], login: string) {
  const store = usePrLifecycleStore.getState();
  const before = store.seen[repoPath];
  const now = Object.fromEntries(prs.map((pr) => [pr.number, prStatus(pr)]));
  const save = () => usePrLifecycleStore.setState((s) => ({ seen: { ...s.seen, [repoPath]: now } }));
  // The first look at a repository is the baseline: what was already open or merged doesn't move anything.
  const moves = before && store.autoMove ? prTransitions(before, prs).filter((m) => m.pr.author.login === login) : [];
  if (moves.length === 0) return save();
  const teams = await teamDirectory(client); // Linear unreachable: no snapshot, retried at the next poll
  save();
  for (const { pr, move } of moves) {
    for (const identifier of linkedIdentifiers([pr.headRefName, pr.title], [...teams.keys()])) {
      const key = `${repoPath}#${pr.number}:${move}:${identifier}`;
      if (usePrLifecycleStore.getState().applied.includes(key)) continue;
      usePrLifecycleStore.setState((s) => ({ applied: [...s.applied, key].slice(-MAX_APPLIED) }));
      await moveIssue(client, teams, identifier, move).catch((error: unknown) =>
        useNoticesStore.getState().notify({
          tone: "error",
          title: getT()("linear.autoMoveFailed", { id: identifier }),
          detail: toGitError(error).message,
        }),
      );
    }
  }
}

/**
 * Follows the repository's pull requests and moves their Linear issues: In Review when one opens (also when
 * created here, the list being refreshed right after), Done when it merges. Only the user's own pull requests.
 */
export function usePrLifecycle(repoPath: string) {
  const client = useQueryClient();
  const autoMove = usePrLifecycleStore((s) => s.autoMove);
  const linear = (useLinearAccounts().data?.length ?? 0) > 0;
  const prs = usePullRequests(repoPath, autoMove && linear ? 120_000 : false).data;
  const login = useGithubUser(repoPath).data?.login;
  useEffect(() => {
    if (prs && login && linear) void syncPullRequests(client, repoPath, prs, login).catch(() => undefined);
  }, [client, repoPath, prs, login, linear]);
}
