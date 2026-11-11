import { lazy, Suspense, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { Components } from "react-markdown";
import { AuthorAvatar } from "@/components/author-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n";
import { formatAge } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import type { LinearComment, LinearIssueDetail } from "@/types/git";
import { useLinearAccounts } from "./linear-queries";
import { PENDING, threads, useCommentAction, type CommentAction, type Thread } from "./use-comments";

const Markdown = lazy(() => import("@/features/agents/Markdown"));
const CommentEditor = lazy(() => import("./IssueDescriptionEditor").then((m) => ({ default: m.CommentEditor })));

type Props = { orgId: string | undefined; issue: LinearIssueDetail; markdown: Components };
type Act = (action: CommentAction) => Promise<unknown>;

/** Edit / delete of the user's own comment; delete asks a second click. */
function CommentMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const t = useT();
  const [armed, setArmed] = useState(false);
  return (
    <DropdownMenu onOpenChange={() => setArmed(false)}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("linear.comment.actions")}
          className="ml-auto size-6 rounded-md text-muted-foreground opacity-0 group-hover/comment:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal aria-hidden className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 rounded-xl p-1">
        <DropdownMenuItem onSelect={onEdit} className="px-2 py-1.5 text-[13px]">
          {t("linear.comment.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={(e) => {
            if (armed) return onDelete();
            e.preventDefault();
            setArmed(true);
          }}
          className="px-2 py-1.5 text-[13px]"
        >
          {t(armed ? "linear.comment.confirmDelete" : "linear.comment.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Comment({ comment, orgId, teamId, markdown, act, avatar }: {
  comment: LinearComment;
  orgId: string | undefined;
  teamId: string;
  markdown: Components;
  act: Act;
  /** Replies show their author's avatar in the card; a thread's first comment has it on the timeline. */
  avatar: boolean;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const who = comment.user ?? comment.botActor;
  const mine = comment.user?.isMe === true && !comment.id.startsWith(PENDING);
  if (editing)
    return (
      <Suspense fallback={null}>
        <CommentEditor
          orgId={orgId}
          teamId={teamId}
          initial={comment.body}
          empty={t("linear.comment.placeholder")}
          submitLabel={t("common.save")}
          autoFocus
          onCancel={() => setEditing(false)}
          onSubmit={(body) => {
            setEditing(false);
            return act({ kind: "update", id: comment.id, body });
          }}
        />
      </Suspense>
    );
  return (
    <div className="group/comment">
      <p className="mb-1 flex items-center gap-2 text-[12.5px] text-muted-foreground">
        {avatar && <AuthorAvatar name={who?.name ?? "Linear"} src={who?.avatarUrl ?? null} className="size-4" />}
        <span>
          <span className="font-medium text-foreground">{who?.name ?? "Linear"}</span> ·{" "}
          {formatAge(comment.createdAt, undefined, t.locale)}
        </span>
        {mine && (
          <CommentMenu onEdit={() => setEditing(true)} onDelete={() => void act({ kind: "delete", id: comment.id })} />
        )}
      </p>
      <Suspense fallback={<p className="text-[13px] whitespace-pre-wrap">{comment.body}</p>}>
        <Markdown text={comment.body} components={markdown} />
      </Suspense>
    </div>
  );
}

function CommentThread({ thread, orgId, teamId, markdown, act }: {
  thread: Thread;
  orgId: string | undefined;
  teamId: string;
  markdown: Components;
  act: Act;
}) {
  const t = useT();
  const [replying, setReplying] = useState(false);
  const who = thread.root.user ?? thread.root.botActor;
  const shared = { orgId, teamId, markdown, act };
  return (
    <li className="relative flex gap-3">
      <AuthorAvatar
        name={who?.name ?? "Linear"}
        src={who?.avatarUrl ?? null}
        className="z-10 size-5 shrink-0 ring-4 ring-background"
      />
      <div className="surface min-w-0 flex-1 divide-y divide-white/[0.05] rounded-lg">
        <div className="px-3.5 py-2.5">
          <Comment comment={thread.root} avatar={false} {...shared} />
        </div>
        {thread.replies.map((reply) => (
          <div key={reply.id} className="px-3.5 py-2.5">
            <Comment comment={reply} avatar {...shared} />
          </div>
        ))}
        <div className={cn("px-3.5 py-1.5", replying && "py-2.5")}>
          {replying ? (
            <Suspense fallback={null}>
              <CommentEditor
                orgId={orgId}
                teamId={teamId}
                empty={t("linear.comment.replyPlaceholder")}
                submitLabel={t("linear.comment.reply")}
                autoFocus
                onCancel={() => setReplying(false)}
                onSubmit={(body) => act({ kind: "create", body, parentId: thread.root.id })}
              />
            </Suspense>
          ) : (
            <button
              type="button"
              disabled={thread.root.id.startsWith(PENDING)}
              onClick={() => setReplying(true)}
              className="text-[12.5px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {t("linear.comment.replyPlaceholder")}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** The issue's timeline: creation, comment threads, and a box to comment. */
export function IssueActivity({ orgId, issue, markdown }: Props) {
  const t = useT();
  const account = useLinearAccounts().data?.find((a) => a.id === orgId);
  const me = { id: "me", name: account?.userName ?? "", avatarUrl: null, isMe: true };
  const action = useCommentAction(orgId, issue.id, me);
  const act: Act = (a) => action.mutateAsync(a);
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-[13px] font-medium">{t("linear.activity")}</h2>
      <ol className="relative space-y-5 before:absolute before:top-2 before:bottom-2 before:left-[9px] before:w-px before:bg-white/[0.07]">
        <li className="relative flex items-center gap-3 text-[12.5px] text-muted-foreground">
          <span className="z-10 grid size-5 place-items-center rounded-full bg-background">
            <span className="size-1.5 rounded-full bg-muted-foreground/60" />
          </span>
          <span>
            <span className="text-foreground">{issue.creator?.name ?? "Linear"}</span> {t("linear.createdIssue")} ·{" "}
            {formatAge(issue.createdAt, undefined, t.locale)}
          </span>
        </li>
        {threads(issue.comments.nodes).map((thread) => (
          <CommentThread
            key={thread.root.id}
            thread={thread}
            orgId={orgId}
            teamId={issue.team.id}
            markdown={markdown}
            act={act}
          />
        ))}
      </ol>
      <div className="mt-6">
        <Suspense fallback={<div className="surface h-[88px] rounded-lg" />}>
          <CommentEditor
            key={issue.id}
            orgId={orgId}
            teamId={issue.team.id}
            empty={t("linear.comment.placeholder")}
            submitLabel={t("linear.comment.send")}
            onSubmit={(body) => act({ kind: "create", body, parentId: null })}
          />
        </Suspense>
      </div>
    </section>
  );
}
