import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOpenPullRequest } from "@/features/github/PullRequestList";
import { useLinearAccounts } from "@/features/linear/linear-queries";
import { getT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { usePullRequests, workflowRunsQuery } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { useAgentsStore } from "@/stores/agents-store";
import { useCiStore } from "@/stores/ci-store";
import { useInboxStore } from "@/stores/inbox-store";
import { useLinearStore } from "@/stores/linear-store";
import { useNoticesStore } from "@/stores/notices-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { applyMarks, fromAgentRuns, fromGithub, fromLinear, fromWorkflowRuns, type InboxItem } from "./inbox-items";

const POLL = { staleTime: 60_000, refetchInterval: 90_000 };

/** Every source merged, the user's marks applied, newest first; `items` is undefined until GitHub answers. */
export function useInbox(repoPath: string) {
  const github = useQuery({
    queryKey: ["inbox", "github"],
    queryFn: () => gitBackend.githubNotifications(repoPath),
    ...POLL,
  });
  const accounts = useLinearAccounts().data ?? [];
  const linear = useQueries({
    queries: accounts.map((a) => ({
      queryKey: ["inbox", "linear", a.id],
      queryFn: () => gitBackend.linearNotifications(a.id),
      ...POLL,
    })),
  });
  const ci = useQuery({ ...workflowRunsQuery(repoPath), ...POLL });
  // Running conversations are left out: their streaming steps would re-render whoever shows the count.
  const runs = useAgentsStore(
    useShallow((s) => s.runs.filter((r) => r.repoPath === repoPath && r.status !== "running")),
  );
  const marks = useInboxStore((s) => s.marks);
  const [now] = useState(() => Date.now());
  const settled = github.data !== undefined || github.isError;
  const items = settled
    ? applyMarks(
        [
          ...fromGithub(github.data ?? []),
          ...linear.flatMap((q, i) => (q.data && accounts[i] ? fromLinear(accounts[i].id, q.data) : [])),
          ...fromAgentRuns(runs, repoPath, now),
          ...fromWorkflowRuns(ci.data ?? [], now),
        ],
        marks,
      )
    : undefined;
  const errors = [
    github.error && { source: "GitHub", error: github.error },
    ...linear.map((q, i) => q.error && { source: accounts[i]?.name ?? "Linear", error: q.error }),
  ].filter((e) => !!e);
  return { items, errors };
}

/** Read, unread and done: marked here at once, then on GitHub or Linear (undone if that fails). */
export function useInboxActions(repoPath: string) {
  const client = useQueryClient();
  const { mark, unmark } = useInboxStore(useShallow((s) => ({ mark: s.mark, unmark: s.unmark })));
  const notify = useNoticesStore((s) => s.notify);
  const remote = (item: InboxItem, call: Promise<unknown>) =>
    call
      .then(() => {
        if (item.target.kind === "linear")
          void client.invalidateQueries({ queryKey: ["inbox", "linear", item.target.orgId] });
      })
      .catch((error: unknown) => {
        unmark(item.key);
        const { message, detail } = toGitError(error);
        notify({ tone: "error", title: getT()("inbox.syncError", { message }), detail });
      });
  const markRead = (item: InboxItem, state: "read" | "done") => {
    mark(item, state);
    const { target } = item;
    if (target.kind === "github" && item.unread)
      void remote(item, gitBackend.githubMarkNotificationRead(repoPath, target.threadId));
    if (target.kind === "linear" && state === "done")
      void remote(item, gitBackend.linearArchiveNotification(target.orgId, target.notificationId));
    else if (target.kind === "linear" && item.unread)
      void remote(
        item,
        gitBackend.linearSetNotificationRead(target.orgId, target.notificationId, new Date().toISOString()),
      );
  };
  return {
    read: (item: InboxItem) => item.unread && markRead(item, "read"),
    done: (item: InboxItem) => markRead(item, "done"),
    // GitHub can't mark a thread unread: that one stays a local mark.
    toggleUnread: (item: InboxItem) => {
      if (item.unread) return markRead(item, "read");
      mark(item, "unread");
      if (item.target.kind === "linear")
        void remote(item, gitBackend.linearSetNotificationRead(item.target.orgId, item.target.notificationId, null));
    },
  };
}

/**
 * `show` puts an item on the right (marking it read); `open` takes it further: a pull request opens in place
 * (fetching it), the rest on its own page, and anything the app can't show on github.com.
 */
export function useOpenInboxItem(repoPath: string) {
  const { read } = useInboxActions(repoPath);
  const select = useInboxStore((s) => s.select);
  const setView = useWorkspaceStore((s) => s.setView);
  const prs = usePullRequests(repoPath).data;
  const { open: openPr } = useOpenPullRequest(repoPath);
  const show = (item: InboxItem) => {
    select(item.key);
    read(item);
    const { target } = item;
    if (target.kind === "linear") useLinearStore.getState().setIssue(target.issueId, target.orgId);
    else if (target.kind === "agent") useAgentsStore.getState().select({ type: "run", id: target.runId });
    else if (target.kind === "ci") useCiStore.getState().openRun(target.runId);
  };
  const open = (item: InboxItem) => {
    show(item);
    const { target } = item;
    if (target.kind === "linear") setView("linear");
    else if (target.kind === "agent") setView("agents");
    else if (target.kind === "ci") setView("ci");
    else {
      const pr = prs?.find((p) => p.url === target.url);
      if (pr) void openPr(pr, "inbox");
      else void gitBackend.openGithubUrl(target.url);
    }
  };
  return {
    show,
    open,
    canOpenInApp: ({ target }: InboxItem) => target.kind !== "github" || !!prs?.some((p) => p.url === target.url),
  };
}
