import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  ArrowUp,
  Check,
  ChevronRight,
  Clipboard,
  Code2,
  ExternalLink,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  MousePointer2,
  Pencil,
  SmilePlus,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { AuthorAvatar } from "@/components/author-avatar";
import { BrailleLoader } from "@/components/braille-loader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Markdown } from "@/features/agents/Markdown";
import { startAgentWithNotice } from "@/features/agents/use-agents";
import { openInEditor } from "@/stores/editor-store";
import { CreateIssueDialog } from "@/features/linear/CreateIssue";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { formatAge } from "@/lib/format-date";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useNoticesStore } from "@/stores/notices-store";
import type { ActivePullRequest } from "@/stores/workspace-store";
import type { AgentKind, DiffLine, Reaction, ReviewThread, ThreadComment } from "@/types/git";

export type Side = "LEFT" | "RIGHT";
type Target = { side: Side; line: number };
const keyOf = ({ side, line }: Target) => `${side}:${line}`;

/** Where a comment on this diff line lands: the old version for a removal, the new one otherwise. */
export const targetOf = (line: DiffLine): Target | null => {
  const number = line.kind === "removed" ? line.oldLine : line.newLine;
  return number === null ? null : { side: line.kind === "removed" ? "LEFT" : "RIGHT", line: number };
};

type Ctx = {
  repoPath: string;
  pr: ActivePullRequest;
  path: string;
  threads: Map<string, ReviewThread[]>;
  composer: string | null;
  setComposer: (key: string | null) => void;
};

const LineCommentsContext = createContext<Ctx | null>(null);

const threadsKey = (repoPath: string, number: number) => ["review-threads", repoPath, number];

export function useReviewThreads(repoPath: string, number: number | null) {
  return useQuery({
    queryKey: threadsKey(repoPath, number ?? 0),
    queryFn: () => gitBackend.listReviewThreads(repoPath, number ?? 0),
    enabled: number !== null,
    staleTime: 30_000,
  });
}

/** One file's threads by line. Outdated ones (no line in the current diff) stay on GitHub. */
export function threadsOf(threads: ReviewThread[], path: string): Map<string, ReviewThread[]> {
  const byLine = new Map<string, ReviewThread[]>();
  for (const thread of threads) {
    if (thread.path !== path || thread.line === null) continue;
    const key = keyOf({ side: thread.diffSide, line: thread.line });
    byLine.set(key, [...(byLine.get(key) ?? []), thread]);
  }
  return byLine;
}

/** Turns line comments on for one file of the pull request being reviewed. */
export function LineCommentsProvider({
  repoPath,
  pr,
  path,
  children,
}: {
  repoPath: string;
  pr: ActivePullRequest;
  path: string;
  children: ReactNode;
}) {
  const data = useReviewThreads(repoPath, pr.number).data;
  const [composer, setComposer] = useState<string | null>(null);
  const threads = useMemo(() => threadsOf(data ?? [], path), [data, path]);
  const value = useMemo(
    () => ({ repoPath, pr, path, threads, composer, setComposer }),
    [repoPath, pr, path, threads, composer],
  );
  return <LineCommentsContext.Provider value={value}>{children}</LineCommentsContext.Provider>;
}

/** The bubble in a line's gutter, shown on hover when the diff accepts comments. */
export function CommentButton({ line }: { line: DiffLine }) {
  const t = useT();
  const ctx = useContext(LineCommentsContext);
  const target = targetOf(line);
  if (!ctx || !target) return null;
  return (
    <button
      type="button"
      aria-label={t("comments.add")}
      title={t("comments.add")}
      onClick={() => ctx.setComposer(keyOf(target))}
      className="absolute top-1/2 left-1 grid size-5 -translate-y-1/2 place-items-center rounded-full bg-primary text-primary-foreground opacity-0 shadow outline-none group-hover/line:opacity-100 focus-visible:opacity-100 [&_svg]:size-3"
    >
      <MessageSquarePlus aria-hidden />
    </button>
  );
}

/** The comment count of a file, for its header. */
export function FileCommentCount({ repoPath, number, path }: { repoPath: string; number: number; path: string }) {
  const threads = useReviewThreads(repoPath, number).data;
  const count =
    threads?.filter((th) => th.path === path && !th.isOutdated).reduce((n, th) => n + th.comments.nodes.length, 0) ?? 0;
  if (count === 0) return null;
  return (
    <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground tabular-nums">
      <MessageSquare aria-hidden className="size-3.5" />
      {count}
    </span>
  );
}

const BOX = "mx-3 my-2 overflow-hidden rounded-lg border border-white/10 bg-popover font-sans text-[13px]";
const ICON =
  "grid size-7 place-items-center rounded-full text-muted-foreground outline-none hover:bg-white/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-white/[0.1] data-[state=open]:text-foreground";

const EMOJI: Record<Reaction, string> = {
  THUMBS_UP: "👍",
  THUMBS_DOWN: "👎",
  LAUGH: "😄",
  HOORAY: "🎉",
  CONFUSED: "😕",
  HEART: "❤️",
  ROCKET: "🚀",
  EYES: "👀",
};

function Composer({
  placeholder,
  onSend,
  onCancel,
  agent,
  autoFocus = false,
}: {
  placeholder: string;
  onSend: (body: string, toAgent: boolean) => Promise<unknown>;
  onCancel?: () => void;
  agent?: boolean;
  autoFocus?: boolean;
}) {
  const t = useT();
  const [body, setBody] = useState("");
  const [toAgent, setToAgent] = useState(false);
  const send = useMutation({
    mutationFn: () => onSend(body, toAgent),
    onSuccess: () => setBody(""),
  });
  const submit = () => body.trim() && !send.isPending && send.mutate();
  return (
    <div className={cn("relative", !agent && "flex items-center pr-2.5")}>
      <textarea
        autoFocus={autoFocus}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === "Escape") onCancel?.();
        }}
        placeholder={placeholder}
        rows={agent ? 3 : 1}
        className="block min-w-0 flex-1 resize-none bg-transparent px-3.5 py-3 outline-none placeholder:text-muted-foreground"
      />
      {onCancel && (
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={onCancel}
          className="absolute top-2.5 right-2.5 grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
      <div className={cn("flex items-center justify-end gap-2", agent && "px-2.5 pb-2.5")}>
        {send.isError && (
          <span className="mr-auto truncate text-[12px] text-removed-foreground">{toGitError(send.error).message}</span>
        )}
        {agent && (
          <div className="flex rounded-lg border border-white/10 p-0.5 text-[12.5px]">
            {[true, false].map((value) => (
              <button
                key={String(value)}
                type="button"
                aria-pressed={toAgent === value}
                onClick={() => setToAgent(value)}
                className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-muted-foreground aria-pressed:bg-white/[0.08] aria-pressed:text-foreground"
              >
                {value ? (
                  <MousePointer2 aria-hidden className="size-3.5" />
                ) : (
                  <MessageSquare aria-hidden className="size-3.5" />
                )}
                {value ? t("comments.agent") : t("comments.comment")}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          aria-label={t("comments.send")}
          disabled={!body.trim() || send.isPending}
          onClick={submit}
          className="grid size-7 place-items-center rounded-full bg-white/[0.08] text-foreground enabled:hover:bg-white/[0.14] disabled:opacity-40"
        >
          {send.isPending ? <BrailleLoader /> : <ArrowUp aria-hidden className="size-4" />}
        </button>
      </div>
    </div>
  );
}

/** Runs a GitHub action on a thread, then reloads the threads; failures become a notice. */
function useThreadAction(ctx: Ctx) {
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const t = useT();
  return useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSettled: () => client.invalidateQueries({ queryKey: threadsKey(ctx.repoPath, ctx.pr.number) }),
    onError: (error) => notify({ tone: "error", title: t("comments.actionFailed"), detail: toGitError(error).message }),
  });
}

function Reactions({ comment, ctx }: { comment: ThreadComment; ctx: Ctx }) {
  const run = useThreadAction(ctx);
  const groups = comment.reactionGroups.filter((g) => g.reactors.totalCount > 0);
  if (groups.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {groups.map((g) => (
        <button
          key={g.content}
          type="button"
          onClick={() =>
            run.mutate(() => gitBackend.reactToComment(ctx.repoPath, comment.id, g.content, !g.viewerHasReacted))
          }
          className={cn(
            "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] tabular-nums",
            g.viewerHasReacted ? "border-primary/50 bg-primary/15" : "border-white/10 hover:bg-white/[0.06]",
          )}
        >
          {EMOJI[g.content]} {g.reactors.totalCount}
        </button>
      ))}
    </div>
  );
}

function ReactionPicker({ comment, ctx }: { comment: ThreadComment; ctx: Ctx }) {
  const t = useT();
  const run = useThreadAction(ctx);
  const [open, setOpen] = useState(false);
  const mine = new Set(comment.reactionGroups.filter((g) => g.viewerHasReacted).map((g) => g.content));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={t("comments.react")} title={t("comments.react")} className={ICON}>
        <SmilePlus aria-hidden className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-auto gap-0.5 rounded-full p-1">
        {(Object.keys(EMOJI) as Reaction[]).map((content) => (
          <button
            key={content}
            type="button"
            onClick={() => {
              setOpen(false);
              run.mutate(() => gitBackend.reactToComment(ctx.repoPath, comment.id, content, !mine.has(content)));
            }}
            className={cn(
              "grid size-8 place-items-center rounded-full text-[16px] hover:bg-white/[0.08]",
              mine.has(content) && "bg-primary/20",
            )}
          >
            {EMOJI[content]}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** The prompt an agent gets for a comment: where it is, the code, the discussion so far. */
function commentPrompt(ctx: Ctx, thread: ReviewThread, comment: ThreadComment) {
  const discussion = thread.comments.nodes.map((c) => `${c.author?.login ?? "?"}: ${c.body}`).join("\n\n");
  return [
    `Review comment on pull request #${ctx.pr.number} ("${ctx.pr.title}"), at ${thread.path}:${thread.line ?? thread.originalLine}.`,
    `Discussion:\n\n${discussion}`,
    `Address this comment by ${comment.author?.login ?? "the reviewer"}: make the change on the current branch, run the relevant checks, then summarize what you did.`,
  ].join("\n\n");
}

const sendToAgent = (ctx: Ctx, prompt: string, title: string, agent?: AgentKind) =>
  startAgentWithNotice(ctx.repoPath, prompt, title, agent);

function CommentMenu({
  ctx,
  thread,
  comment,
  onEdit,
  onNewIssue,
}: {
  ctx: Ctx;
  thread: ReviewThread;
  comment: ThreadComment;
  onEdit: () => void;
  onNewIssue: () => void;
}) {
  const t = useT();
  const run = useThreadAction(ctx);
  const title = `${thread.path}:${thread.line ?? ""} · #${ctx.pr.number}`;
  const remove = async () => {
    if (await ask(t("comments.deleteConfirm"), { kind: "warning", okLabel: t("comments.delete") }))
      run.mutate(() => gitBackend.deleteReviewComment(ctx.repoPath, comment.databaseId));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={t("common.more")} className={ICON}>
        <MoreHorizontal aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {comment.viewerCanUpdate && (
          <>
            <DropdownMenuItem onSelect={onEdit} className="gap-2.5">
              <Pencil aria-hidden />
              {t("comments.edit")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onSelect={() => run.mutate(() => gitBackend.resolveReviewThread(ctx.repoPath, thread.id, !thread.isResolved))}
          className="gap-2.5"
        >
          <Check aria-hidden />
          {thread.isResolved ? t("comments.unresolve") : t("comments.resolve")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2.5">
            <Clipboard aria-hidden className="size-4 text-muted-foreground" />
            {t("comments.copy")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(comment.body)}>
              {t("comments.copyText")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(comment.url)}>
              {t("comments.copyLink")}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void sendToAgent(ctx, commentPrompt(ctx, thread, comment), title)}
          className="gap-2.5"
        >
          <MousePointer2 aria-hidden />
          {t("comments.sendToAgent")}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2.5">
            <ExternalLink aria-hidden className="size-4 text-muted-foreground" />
            {t("comments.workOn")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            {(["claude", "codex"] as const).map((agent) => (
              <DropdownMenuItem
                key={agent}
                onSelect={() => void sendToAgent(ctx, commentPrompt(ctx, thread, comment), title, agent)}
              >
                {agent === "claude" ? "Claude Code" : "Codex"}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={() => void gitBackend.openGithubUrl(comment.url)}>
              {t("github.openOnGithub")}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          onSelect={() => openInEditor(ctx.repoPath, thread.path, thread.line ?? thread.originalLine ?? 1)}
          className="gap-2.5"
        >
          <Code2 aria-hidden />
          {t("editor.openInEditor")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNewIssue} className="gap-2.5">
          <SquarePen aria-hidden />
          {t("comments.newIssue")}
        </DropdownMenuItem>
        {comment.viewerCanDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void remove()} className="gap-2.5">
              <Trash2 aria-hidden />
              {t("comments.delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Comment({
  ctx,
  thread,
  comment,
  first,
}: {
  ctx: Ctx;
  thread: ReviewThread;
  comment: ThreadComment;
  first: boolean;
}) {
  const t = useT();
  const run = useThreadAction(ctx);
  const [editing, setEditing] = useState(false);
  const [issue, setIssue] = useState(false);
  const login = comment.author?.login ?? "ghost";
  return (
    <div className="group/comment border-b border-white/[0.06] px-3.5 py-2.5">
      <div className="mb-1 flex items-center gap-2">
        <AuthorAvatar name={login} src={comment.author?.avatarUrl} className="size-5" />
        <span className="font-medium">{login}</span>
        <span className="text-[12px] text-muted-foreground">{formatAge(comment.createdAt, undefined, t.locale)}</span>
        <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover/comment:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
          <ReactionPicker comment={comment} ctx={ctx} />
          {first && (
            <button
              type="button"
              aria-label={thread.isResolved ? t("comments.unresolve") : t("comments.resolve")}
              title={thread.isResolved ? t("comments.unresolve") : t("comments.resolve")}
              onClick={() =>
                run.mutate(() => gitBackend.resolveReviewThread(ctx.repoPath, thread.id, !thread.isResolved))
              }
              className={cn(ICON, thread.isResolved && "text-added-foreground")}
            >
              {run.isPending ? <BrailleLoader /> : <Check aria-hidden className="size-4" />}
            </button>
          )}
          <CommentMenu
            ctx={ctx}
            thread={thread}
            comment={comment}
            onEdit={() => setEditing(true)}
            onNewIssue={() => setIssue(true)}
          />
        </div>
      </div>
      {editing ? (
        <EditComment ctx={ctx} comment={comment} onDone={() => setEditing(false)} />
      ) : (
        <div className="text-[13px] [&_p]:my-1">
          <Markdown text={comment.body} />
        </div>
      )}
      <Reactions comment={comment} ctx={ctx} />
      <CreateIssueDialog
        open={issue}
        onOpenChange={setIssue}
        initial={{
          title: comment.body.split("\n")[0].slice(0, 120),
          description: `${comment.body}\n\n— ${login} on [${thread.path}:${thread.line ?? ""}](${comment.url}) (#${ctx.pr.number})`,
        }}
      />
    </div>
  );
}

function EditComment({ ctx, comment, onDone }: { ctx: Ctx; comment: ThreadComment; onDone: () => void }) {
  const t = useT();
  const client = useQueryClient();
  const [body, setBody] = useState(comment.body);
  const save = useMutation({
    mutationFn: () => gitBackend.editReviewComment(ctx.repoPath, comment.databaseId, body),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: threadsKey(ctx.repoPath, ctx.pr.number) });
      onDone();
    },
  });
  return (
    <div className="space-y-2">
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) save.mutate();
          if (e.key === "Escape") onDone();
        }}
        rows={3}
        className="block w-full resize-y rounded-md border border-white/10 bg-transparent px-2.5 py-2 outline-none focus:border-primary/60"
      />
      <div className="flex items-center justify-end gap-2 text-[12.5px]">
        {save.isError && (
          <span className="mr-auto truncate text-removed-foreground">{toGitError(save.error).message}</span>
        )}
        <button type="button" onClick={onDone} className="rounded-md px-2.5 py-1 hover:bg-white/[0.06]">
          {t("common.cancel")}
        </button>
        <button
          type="button"
          disabled={!body.trim() || save.isPending}
          onClick={() => save.mutate()}
          className="rounded-md bg-primary px-2.5 py-1 text-primary-foreground disabled:opacity-50"
        >
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}

function Thread({ thread, ctx }: { thread: ReviewThread; ctx: Ctx }) {
  const t = useT();
  const client = useQueryClient();
  const [open, setOpen] = useState(!thread.isResolved);
  const comments = thread.comments.nodes;
  const reply = (body: string) =>
    gitBackend
      .replyReviewComment(ctx.repoPath, ctx.pr.number, comments[0].databaseId, body)
      .then(() => client.invalidateQueries({ queryKey: threadsKey(ctx.repoPath, ctx.pr.number) }));
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          BOX,
          "flex w-[calc(100%-1.5rem)] items-center gap-2 px-3.5 py-2 text-left text-muted-foreground hover:text-foreground",
        )}
      >
        <ChevronRight aria-hidden className="size-3.5" />
        <Check aria-hidden className="size-3.5 text-added-foreground" />
        {t("comments.resolved")}
        <span className="truncate">· {t.plural("comments.count", comments.length)}</span>
      </button>
    );
  return (
    <div className={BOX}>
      {comments.map((c, i) => (
        <Comment key={c.id} ctx={ctx} thread={thread} comment={c} first={i === 0} />
      ))}
      <Composer placeholder={t("comments.reply")} onSend={(body) => reply(body)} />
    </div>
  );
}

/** Under a line: its threads, then the new-comment box when it was opened there. */
export function LineThreads({ line }: { line: DiffLine }) {
  const t = useT();
  const ctx = useContext(LineCommentsContext);
  const client = useQueryClient();
  const target = targetOf(line);
  if (!ctx || !target) return null;
  const key = keyOf(target);
  const threads = ctx.threads.get(key) ?? [];
  const composing = ctx.composer === key;
  if (threads.length === 0 && !composing) return null;
  const send = async (body: string, toAgent: boolean) => {
    if (toAgent) {
      const where = `${ctx.path}:${target.line}${target.side === "LEFT" ? " (removed line)" : ""}`;
      const prompt = [
        `Review comment on pull request #${ctx.pr.number} ("${ctx.pr.title}"), at ${where}:`,
        "```\n" + line.content + "\n```",
        body.trim(),
      ].join("\n\n");
      if (!(await sendToAgent(ctx, prompt, `${where} · #${ctx.pr.number}`))) return;
    } else {
      await gitBackend.commentLine(ctx.repoPath, ctx.pr.number, ctx.pr.head, ctx.path, target.line, target.side, body);
      await client.invalidateQueries({ queryKey: threadsKey(ctx.repoPath, ctx.pr.number) });
    }
    ctx.setComposer(null);
  };
  return (
    <div className="sticky left-0 w-[100cqw] border-y border-white/[0.06] bg-background/40 py-0.5">
      {threads.map((thread) => (
        <Thread key={thread.id} thread={thread} ctx={ctx} />
      ))}
      {composing && (
        <div className={BOX}>
          <Composer
            autoFocus
            agent
            placeholder={t("comments.placeholder")}
            onSend={send}
            onCancel={() => ctx.setComposer(null)}
          />
        </div>
      )}
    </div>
  );
}
