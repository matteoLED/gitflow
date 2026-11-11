import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { useNoticesStore } from "@/stores/notices-store";
import type { LinearComment, LinearIssueDetail } from "@/types/git";

export type CommentAction =
  | { kind: "create"; body: string; parentId: string | null }
  | { kind: "update"; id: string; body: string }
  | { kind: "delete"; id: string };

/** Comments not confirmed by Linear yet: no menu on them. */
export const PENDING = "pending-";

/** The comments as they'll be once Linear has done `action` (shown at once). */
export function applyComment(
  comments: LinearComment[],
  action: CommentAction,
  me: LinearComment["user"],
  now: string,
): LinearComment[] {
  if (action.kind === "update") return comments.map((c) => (c.id === action.id ? { ...c, body: action.body } : c));
  if (action.kind === "delete") return comments.filter((c) => c.id !== action.id && c.parent?.id !== action.id);
  const parent = action.parentId ? { id: action.parentId } : null;
  return [{ id: `${PENDING}${now}`, body: action.body, createdAt: now, parent, user: me, botActor: null }, ...comments];
}

export type Thread = { root: LinearComment; replies: LinearComment[] };

/** Oldest first; replies under their thread (a reply whose thread isn't loaded stands alone). */
export function threads(comments: LinearComment[]): Thread[] {
  const sorted = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ids = new Set(sorted.map((c) => c.id));
  return sorted
    .filter((c) => !c.parent || !ids.has(c.parent.id))
    .map((root) => ({ root, replies: sorted.filter((c) => c.parent?.id === root.id) }));
}

function send(orgId: string, issueId: string, action: CommentAction) {
  if (action.kind === "create") return gitBackend.linearCreateComment(orgId, issueId, action.body, action.parentId);
  if (action.kind === "update") return gitBackend.linearUpdateComment(orgId, action.id, action.body);
  return gitBackend.linearDeleteComment(orgId, action.id);
}

/** Posts, edits or deletes a comment: shown at once, undone with a toast if Linear refuses, then refetched. */
export function useCommentAction(orgId: string | undefined, issueId: string, me: LinearComment["user"]) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const key = ["linear", "issue", orgId, issueId];
  return useMutation({
    mutationFn: (action: CommentAction) => send(orgId ?? "", issueId, action),
    onMutate: async (action) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<LinearIssueDetail>(key);
      const now = new Date().toISOString();
      client.setQueryData<LinearIssueDetail>(
        key,
        (data) => data && { ...data, comments: { nodes: applyComment(data.comments.nodes, action, me, now) } },
      );
      return { before };
    },
    onError: (error, _, context) => {
      if (context?.before) client.setQueryData(key, context.before);
      notify({ tone: "error", title: t("linear.comment.failed"), detail: toGitError(error).message });
    },
    onSettled: () => void client.invalidateQueries({ queryKey: key }),
  });
}
