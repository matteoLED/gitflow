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
  const { issue, issueOrg } = useLinearStore();
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
