import { useShallow } from "zustand/react/shallow";
import { useQueries, useQuery } from "@tanstack/react-query";
import { gitBackend } from "@/lib/tauri-git";
import { ALL_WORKSPACES, useLinearStore } from "@/stores/linear-store";
import type { LinearIssue } from "@/types/git";

export function useLinearAccounts() {
  return useQuery({ queryKey: ["linear", "accounts"], queryFn: gitBackend.linearAccounts, staleTime: Infinity });
}

/** The organization in view: the chosen one if still connected, else the first (also in the all view). */
export function useActiveAccount() {
  const chosen = useLinearStore((s) => s.account);
  const accounts = useLinearAccounts().data ?? [];
  return accounts.find((a) => a.id === chosen) ?? accounts[0] ?? null;
}

export function useAllWorkspaces() {
  return useLinearStore((s) => s.account === ALL_WORKSPACES);
}

const issuesQuery = (orgId: string) => ({
  queryKey: ["linear", "issues", orgId],
  queryFn: () => gitBackend.linearMyIssues(orgId),
  staleTime: 60_000,
  refetchInterval: 120_000,
});

export function useMyIssues(orgId: string | undefined) {
  return useQuery({ ...issuesQuery(orgId ?? ""), enabled: !!orgId });
}

export type WorkspaceIssue = LinearIssue & { orgId: string; orgName: string };

/** The user's open issues in the chosen workspace, or in every connected one; same cache as useMyIssues. */
export function useWorkspaceIssues() {
  const all = useAllWorkspaces();
  const accounts = useLinearAccounts().data ?? [];
  const active = useActiveAccount();
  const shown = all ? accounts : active ? [active] : [];
  return useQueries({
    queries: shown.map((a) => issuesQuery(a.id)),
    combine: (results) => ({
      // One unreachable workspace doesn't hide the others: data once each query has an answer or an error.
      data:
        results.length > 0 && results.every((r) => r.data || r.error) && results.some((r) => r.data)
          ? results.flatMap((r, i) =>
              (r.data ?? []).map((issue) => ({ ...issue, orgId: shown[i].id, orgName: shown[i].name })),
            )
          : undefined,
      error: results.find((r) => r.error)?.error ?? null,
      refetch: () => results.forEach((r) => void r.refetch()),
    }),
  });
}

export function useProjects(orgId: string | undefined) {
  return useQuery({
    queryKey: ["linear", "projects", orgId],
    queryFn: () => gitBackend.linearProjects(orgId ?? ""),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });
}

/** The current cycle of each team of the workspace that runs cycles. */
export function useActiveCycles(orgId: string | undefined) {
  return useQuery({
    queryKey: ["linear", "cycles", orgId],
    queryFn: () => gitBackend.linearActiveCycles(orgId ?? ""),
    enabled: !!orgId,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

/** Every open (or recently closed) issue of the workspace, anyone's. */
export function useAllIssues(orgId: string | undefined) {
  return useQuery({
    queryKey: ["linear", "all-issues", orgId],
    queryFn: () => gitBackend.linearAllIssues(orgId ?? ""),
    enabled: !!orgId,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

/** The project picked in the list, if any (in the active workspace). */
export function useOpenProject() {
  // Only on the Projects page: a project remembered from before doesn't leak into "My issues".
  const id = useLinearStore((s) => (s.page === "projects" ? s.project : null));
  const account = useActiveAccount();
  const project = useProjects(account?.id).data?.find((p) => p.id === id) ?? null;
  return id ? { id, project, orgId: account?.id } : null;
}

/** What the board shows: a project's issues (anyone's), or the user's own across workspaces. */
export function useBoardIssues() {
  const open = useOpenProject();
  const account = useActiveAccount();
  const mine = useWorkspaceIssues();
  const project = useQuery({
    queryKey: ["linear", "project-issues", open?.orgId, open?.id],
    queryFn: () => gitBackend.linearProjectIssues(open?.orgId ?? "", open?.id ?? ""),
    enabled: !!open?.orgId,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const page = useLinearStore((s) => s.page);
  const cycles = useActiveCycles(page === "cycle" ? account?.id : undefined);
  const everyone = useAllIssues(page === "all" ? account?.id : undefined);
  if (page === "all")
    return {
      data: everyone.data?.map((issue) => ({ ...issue, orgId: account?.id ?? "", orgName: account?.name ?? "" })),
      error: everyone.error,
      refetch: () => void everyone.refetch(),
    };
  if (page === "cycle")
    return {
      data: cycles.data?.flatMap((c) =>
        c.issues.map((issue) => ({ ...issue, orgId: account?.id ?? "", orgName: account?.name ?? "" })),
      ),
      error: cycles.error,
      refetch: () => void cycles.refetch(),
    };
  if (!open) return mine;
  return {
    data: project.data?.map((issue) => ({ ...issue, orgId: open.orgId ?? "", orgName: account?.name ?? "" })),
    error: project.error,
    refetch: () => void project.refetch(),
  };
}

export const teamStatesQuery = (orgId: string) => ({
  queryKey: ["linear", "states", orgId],
  queryFn: () => gitBackend.linearTeamStates(orgId),
  staleTime: 10 * 60_000,
});

export function useTeamStates(orgId: string | undefined) {
  return useQuery({ ...teamStatesQuery(orgId ?? ""), enabled: !!orgId });
}

export function useTeamMembers(orgId: string | undefined, teamId: string) {
  return useQuery({
    queryKey: ["linear", "members", orgId, teamId],
    queryFn: () => gitBackend.linearTeamMembers(orgId ?? "", teamId),
    enabled: !!orgId,
    staleTime: 10 * 60_000,
  });
}

export function useLabels(orgId: string | undefined, teamId: string) {
  return useQuery({
    queryKey: ["linear", "labels", orgId, teamId],
    queryFn: () => gitBackend.linearLabels(orgId ?? "", teamId),
    enabled: !!orgId,
    staleTime: 10 * 60_000,
  });
}

export function useIssue(orgId: string | undefined, id: string | null) {
  return useQuery({
    queryKey: ["linear", "issue", orgId, id],
    queryFn: () => gitBackend.linearIssue(orgId ?? "", id ?? ""),
    enabled: !!orgId && !!id,
    staleTime: 30_000,
  });
}

/** The open issue, read with its own workspace's key. */
export function useOpenIssue() {
  const { issue, issueOrg } = useLinearStore(useShallow((s) => ({ issue: s.issue, issueOrg: s.issueOrg })));
  const active = useActiveAccount();
  return { orgId: issueOrg ?? active?.id, ...useIssue(issueOrg ?? active?.id, issue) };
}

/** All the user's workspaces (from any connected key); empty when Linear refuses it to API keys. */
export function useLinearOrganizations(orgId: string | undefined) {
  return useQuery({
    queryKey: ["linear", "organizations", orgId],
    queryFn: () => gitBackend.linearOrganizations(orgId ?? "").catch(() => []),
    enabled: !!orgId,
    staleTime: 10 * 60_000,
  });
}

/** Linear uploads need the API key: loaded through the backend. */
export function useLinearImage(orgId: string | undefined, url: string) {
  return useQuery({
    queryKey: ["linear", "image", url],
    queryFn: () => gitBackend.linearImage(orgId ?? "", url),
    enabled: !!orgId && url.startsWith("https://uploads.linear.app/"),
    staleTime: Infinity,
    retry: false,
  });
}
