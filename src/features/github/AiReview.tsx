import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ask } from "@tauri-apps/plugin-dialog";
import { Pencil, Send, Sparkles, Trash2, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { BrailleLoader } from "@/components/braille-loader";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/features/agents/Markdown";
import { pickAgent } from "@/features/agents/AgentButton";
import { startAgentRun, useInstalledAgents } from "@/features/agents/use-agents";
import { parseUnifiedDiff } from "@/features/diff/parse-unified-diff";
import { getT, useT, type MessageKey } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { finalAnswer, useAgentsStore, type AgentRun } from "@/stores/agents-store";
import { useNoticesStore } from "@/stores/notices-store";
import { useWorkspaceStore, type ActivePullRequest } from "@/stores/workspace-store";
import type { AgentKind } from "@/types/git";
import {
  commentableLines,
  keepInDiff,
  parseAiReview,
  reviewKeyOf,
  useAiReviewStore,
  type AiDraft,
  type Severity,
} from "./ai-review";

const SEVERITY: Record<Severity, { label: MessageKey; tone: string }> = {
  bug: { label: "aiReview.bug", tone: "text-removed-foreground border-removed-foreground/40" },
  risk: { label: "aiReview.risk", tone: "text-renamed border-renamed/40" },
  nit: { label: "aiReview.nit", tone: "text-muted-foreground border-white/15" },
  question: { label: "aiReview.question", tone: "text-primary border-primary/40" },
};

const finished = (id: string) =>
  new Promise<AgentRun>((resolve) => {
    const check = (state: { runs: AgentRun[] }) => {
      const run = state.runs.find((r) => r.id === id && r.status !== "running");
      if (!run) return false;
      resolve(run);
      return true;
    };
    if (check(useAgentsStore.getState())) return;
    const stop = useAgentsStore.subscribe((state) => check(state) && stop());
  });

/** `SIDE:line` anchors of each file the comments point at, from the pull request's own diff. */
async function diffLines(repoPath: string, head: string, base: string, paths: string[]) {
  const files = await gitBackend.listCommitFiles(repoPath, head, base);
  const wanted = files.filter((f) => paths.includes(f.path));
  const diffs = await Promise.all(
    wanted.map((f) => gitBackend.getCommitDiff(repoPath, head, f.path, f.previousPath, base)),
  );
  return new Map(wanted.map((f, i) => [f.path, commentableLines(parseUnifiedDiff(diffs[i].patch))]));
}

/** Runs the agent read-only on the PR diff, then turns its JSON answer into draft comments. */
const MAX_COMMENTS = 100;
const MAX_BODY = 65_000;

/** Reviews being started: a double click before the run exists must not launch a second one. */
const starting = new Set<string>();

async function runAiReview(repoPath: string, pr: ActivePullRequest, base: string, agent: AgentKind) {
  const key = reviewKeyOf(repoPath, pr.number);
  if (starting.has(key)) return;
  starting.add(key);
  try {
    await reviewWithAgent(repoPath, pr, base, agent, key);
  } finally {
    starting.delete(key);
  }
}

async function reviewWithAgent(repoPath: string, pr: ActivePullRequest, base: string, agent: AgentKind, key: string) {
  const t = getT();
  const store = useAiReviewStore.getState();
  const task = { kind: "ai-review-pull-request" as const, number: pr.number, base, head: pr.head };
  const runId = await startAgentRun(repoPath, agent, task, t("aiReview.runTitle", { number: pr.number }));
  if (!runId) return store.set(key, null); // the reason was already notified
  store.set(key, { status: "running", runId });
  const run = await finished(runId);
  if (run.status === "cancelled") return store.set(key, null);
  const parsed = run.status === "done" ? parseAiReview(finalAnswer(run) ?? "") : null;
  if (!parsed) return store.set(key, { status: "failed", error: t("aiReview.unreadable") });
  try {
    const lines = await diffLines(repoPath, pr.head, base, [...new Set(parsed.comments.map((c) => c.path))]);
    const kept = keepInDiff(parsed.comments, lines);
    store.set(key, {
      status: "ready",
      head: pr.head,
      summary: parsed.summary,
      drafts: kept.map((c, i) => ({ ...c, id: String(i) })),
      dropped: parsed.comments.length - kept.length + parsed.invalid,
    });
  } catch (error) {
    store.set(key, { status: "failed", error: toGitError(error).message });
  }
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const t = useT();
  const { label, tone } = SEVERITY[severity];
  return <span className={cn("rounded-full border px-1.5 text-[11px] leading-4", tone)}>{t(label)}</span>;
}

function AiBadge() {
  return (
    <span className="flex items-center gap-1 rounded-full bg-primary/15 px-1.5 text-[11px] leading-4 font-medium text-primary">
      <Sparkles aria-hidden className="size-3" />
      AI
    </span>
  );
}

/** A draft's body, with Edit and Discard: nothing leaves the app until the review is posted. */
function DraftCard({ reviewKey, draft, showPlace }: { reviewKey: string; draft: AiDraft; showPlace?: boolean }) {
  const t = useT();
  const { editDraft, discardDraft } = useAiReviewStore(
    useShallow((s) => ({ editDraft: s.editDraft, discardDraft: s.discardDraft })),
  );
  const selectFile = useWorkspaceStore((s) => s.selectFile);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(draft.body);
  const save = () => {
    if (!body.trim()) return;
    editDraft(reviewKey, draft.id, body.trim());
    setEditing(false);
  };
  return (
    <div className="group/draft px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5">
        <AiBadge />
        <SeverityBadge severity={draft.severity} />
        {showPlace && (
          <button
            type="button"
            onClick={() => selectFile(draft.path)}
            title={draft.path}
            className="min-w-0 truncate font-mono text-[11.5px] text-muted-foreground hover:text-foreground"
          >
            {draft.path.split("/").pop()}:{draft.line}
          </button>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/draft:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            aria-label={t("comments.edit")}
            title={t("comments.edit")}
            onClick={() => {
              setBody(draft.body);
              setEditing(true);
            }}
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
          >
            <Pencil aria-hidden className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={t("aiReview.discard")}
            title={t("aiReview.discard")}
            onClick={() => discardDraft(reviewKey, draft.id)}
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
          >
            <Trash2 aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>
      {editing ? (
        <div className="space-y-1.5">
          <Textarea
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.metaKey) save();
              if (e.key === "Escape") setEditing(false);
            }}
            rows={3}
            className="min-h-16 resize-y text-[13px] md:text-[13px]"
          />
          <div className="flex justify-end gap-1.5 text-[12.5px]">
            <Button variant="ghost" size="sm" className="h-6 text-[12.5px]" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" className="h-6 text-[12.5px]" disabled={!body.trim()} onClick={save}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-[13px] [&_p]:my-1">
          <Markdown text={draft.body} />
        </div>
      )}
    </div>
  );
}

/** AI drafts anchored on one diff line, under its GitHub threads: dashed and tinted to read as unposted. */
export function AiLineDrafts({
  repoPath,
  number,
  path,
  target: { side, line },
  standalone,
}: {
  repoPath: string;
  number: number;
  path: string;
  target: { side: "LEFT" | "RIGHT"; line: number };
  /** Without GitHub threads on the line, the drafts bring their own full-width row. */
  standalone: boolean;
}) {
  const key = reviewKeyOf(repoPath, number);
  const drafts = useAiReviewStore(
    useShallow((s) => {
      const review = s.reviews[key];
      return review?.status === "ready"
        ? review.drafts.filter((d) => d.path === path && d.side === side && d.line === line)
        : [];
    }),
  );
  if (drafts.length === 0) return null;
  const box = (
    <div className="mx-3 my-2 divide-y divide-white/[0.06] overflow-hidden rounded-lg border border-dashed border-primary/40 bg-primary/[0.04] font-sans text-[13px]">
      {drafts.map((d) => (
        <DraftCard key={d.id} reviewKey={key} draft={d} />
      ))}
    </div>
  );
  return standalone ? (
    <div className="sticky left-0 w-[100cqw] border-y border-white/[0.06] bg-background/40 py-0.5">{box}</div>
  ) : (
    box
  );
}

function usePostReview(repoPath: string, pr: ActivePullRequest, onPosted: () => void) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  return useMutation({
    mutationFn: async ({ head, summary, drafts }: { head: string; summary: string; drafts: AiDraft[] }) => {
      const confirmed = await ask(t("aiReview.confirm", { count: drafts.length, number: pr.number }), {
        kind: "warning",
        okLabel: t("aiReview.post"),
      });
      if (!confirmed) return false;
      // GitHub takes at most 100 comments per review here, and the backend 65,536 characters per body.
      const comments = drafts.slice(0, MAX_COMMENTS).map((d) => ({
        path: d.path,
        line: d.line,
        side: d.side,
        body: `**${t(SEVERITY[d.severity].label)}** · ${d.body}`.slice(0, MAX_BODY),
      }));
      await gitBackend.submitAiReview(repoPath, pr.number, head, summary, comments);
      return true;
    },
    onSuccess: (posted) => {
      if (!posted) return;
      notify({ tone: "success", title: t("review.sent", { number: pr.number }) });
      void client.invalidateQueries({ queryKey: ["review-threads", repoPath, pr.number] });
      void client.invalidateQueries({ queryKey: ["pull-request", repoPath, pr.number] });
      onPosted();
    },
    onError: (error) => {
      const { message, detail } = toGitError(error);
      notify({ tone: "error", title: t("review.failed"), detail: detail ?? message });
    },
  });
}

function Progress({ runId }: { runId: string }) {
  const t = useT();
  const step = useAgentsStore((s) => s.runs.find((r) => r.id === runId)?.steps.at(-1)?.title);
  return (
    <div className="flex items-center gap-2.5 px-3 py-3">
      <BrailleLoader className="text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px]">{t("aiReview.running")}</span>
        <span className="block truncate text-[12px] text-muted-foreground">{step ?? t("common.loading")}</span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 text-[12.5px]"
        onClick={() => void gitBackend.cancelAgentRun(runId)}
      >
        <X aria-hidden className="size-3.5" />
        {t("common.cancel")}
      </Button>
    </div>
  );
}

function Panel({
  repoPath,
  pr,
  base,
  onClose,
}: {
  repoPath: string;
  pr: ActivePullRequest;
  base: string;
  onClose: () => void;
}) {
  const t = useT();
  const key = reviewKeyOf(repoPath, pr.number);
  const review = useAiReviewStore((s) => s.reviews[key]);
  const { set, editSummary } = useAiReviewStore(useShallow((s) => ({ set: s.set, editSummary: s.editSummary })));
  const agent = pickAgent(
    useInstalledAgents().data,
    useAgentsStore((s) => s.preferredAgent),
  );
  const post = usePostReview(repoPath, pr, () => {
    set(key, null);
    onClose();
  });
  const start = () => agent && void runAiReview(repoPath, pr, base, agent);
  const header = (
    <p className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-2 text-[13px] font-semibold">
      <Sparkles aria-hidden className="size-3.5 text-primary" />
      {t("aiReview.title")} · #{pr.number}
    </p>
  );
  if (review?.status === "running")
    return (
      <>
        {header}
        <Progress runId={review.runId} />
      </>
    );
  if (review?.status !== "ready")
    return (
      <>
        {header}
        <div className="space-y-2.5 px-3 py-3 text-[12.5px] text-muted-foreground">
          {review?.status === "failed" && <p className="text-removed-foreground">{review.error}</p>}
          <p>{agent ? t("aiReview.hint") : t("aiReview.noAgent")}</p>
          <Button size="sm" disabled={!agent} onClick={start} className="h-7 w-full gap-1.5 text-[13px]">
            <Sparkles aria-hidden className="size-3.5" />
            {review?.status === "failed" ? t("aiReview.retry") : t("aiReview.start")}
          </Button>
        </div>
      </>
    );
  return (
    <>
      {header}
      <div className="px-3 pt-2.5">
        <Textarea
          value={review.summary}
          onChange={(e) => editSummary(key, e.target.value)}
          aria-label={t("aiReview.summary")}
          className="max-h-32 min-h-16 resize-none text-[13px] md:text-[13px]"
        />
        {review.dropped > 0 && (
          <p className="mt-1.5 text-[12px] text-muted-foreground">{t.plural("aiReview.dropped", review.dropped)}</p>
        )}
      </div>
      <div className="mt-2 max-h-[46vh] divide-y divide-white/[0.06] overflow-y-auto border-t border-white/[0.07]">
        {review.drafts.length === 0 ? (
          <p className="px-3 py-3 text-[12.5px] text-muted-foreground">{t("aiReview.noComments")}</p>
        ) : (
          review.drafts.map((d) => <DraftCard key={d.id} reviewKey={key} draft={d} showPlace />)
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-white/[0.07] px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[12.5px] text-muted-foreground"
          onClick={() => set(key, null)}
        >
          {t("aiReview.discardAll")}
        </Button>
        <Button
          size="sm"
          disabled={!review.summary.trim() || post.isPending}
          onClick={() => post.mutate(review)}
          className="ml-auto h-7 gap-1.5 text-[13px]"
        >
          {post.isPending ? <BrailleLoader /> : <Send aria-hidden className="size-3.5" />}
          {t.plural("aiReview.postCount", review.drafts.length)}
        </Button>
      </div>
    </>
  );
}

/** "Review with AI": a read-only agent run whose comments come back as drafts to edit, then post as one review. */
export function AiReviewButton({ repoPath, pr }: { repoPath: string; pr: ActivePullRequest }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const review = useAiReviewStore((s) => s.reviews[reviewKeyOf(repoPath, pr.number)]);
  if (!pr.base) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1.5 rounded-full px-2 text-[12.5px] text-muted-foreground [&_svg]:size-3.5"
        >
          {review?.status === "running" ? <BrailleLoader /> : <Sparkles aria-hidden className="text-primary" />}
          {t("aiReview.button")}
          {review?.status === "ready" && review.drafts.length > 0 && (
            <span className="rounded-full bg-primary/20 px-1.5 text-[11px] text-primary tabular-nums">
              {review.drafts.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[380px] overflow-hidden rounded-xl p-0 shadow-xl">
        <Panel repoPath={repoPath} pr={pr} base={pr.base} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
