import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { GitPullRequest, History, UserRoundSearch } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT, type Translator } from "@/i18n";
import { formatAge } from "@/lib/format-date";
import { useBlame, useCommitDiff, useCommitPullRequest, useFileHistory } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { BlameHunk, FileCommit } from "@/types/git";
import { DiffBody } from "@/features/diff/DiffCard";
import { PullRequestHoverCard } from "@/features/refs/RefPreview";
import { blameExtension, blameSlot, type BlameLabels } from "./blame-cm";
import { inlineBlame, isUncommitted, useBlameStore } from "./blame-model";

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const longDate = (date: string, t: Translator) =>
  new Intl.DateTimeFormat(t.locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));

function labelsFor(t: Translator): BlameLabels {
  const notCommitted = t("blame.notCommitted");
  return {
    gutter: (h) =>
      isUncommitted(h.sha) ? notCommitted : `${h.author} · ${formatAge(iso(h.authorTime), undefined, t.locale)}`,
    inline: (h) => inlineBlame(h, t.locale, notCommitted),
    title: (h) =>
      isUncommitted(h.sha)
        ? notCommitted
        : `${h.sha.slice(0, 8)} · ${h.author} · ${longDate(iso(h.authorTime), t)}\n${h.summary}`,
  };
}

/** Shows a commit in the History view. */
function openCommit(hash: string) {
  const store = useWorkspaceStore.getState();
  store.setView("history");
  store.selectCommit(hash);
}

function PullRequestLink({ repoPath, sha }: { repoPath: string; sha: string }) {
  const t = useT();
  const pr = useCommitPullRequest(repoPath, sha).data;
  if (!pr) return null;
  return (
    <PullRequestHoverCard repoPath={repoPath} number={pr.number} side="right">
      <button
        type="button"
        onClick={() => void gitBackend.openGithubUrl(pr.url)}
        className="flex min-w-0 items-center gap-1.5 text-left text-primary hover:underline"
      >
        <GitPullRequest aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{t("blame.pullRequest", { number: pr.number, title: pr.title })}</span>
      </button>
    </PullRequestHoverCard>
  );
}

type Card = { hunk: BlameHunk; anchor: DOMRect };

function BlameCard({ repoPath, card, onClose }: { repoPath: string; card: Card; onClose: () => void }) {
  const t = useT();
  const { hunk, anchor } = card;
  const uncommitted = isUncommitted(hunk.sha);
  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed"
          style={{ left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex w-80 flex-col gap-2 p-3 font-mono text-[12px]"
      >
        {uncommitted ? (
          <p className="text-muted-foreground">{t("blame.notCommitted")}</p>
        ) : (
          <>
            <p className="leading-snug font-medium text-foreground">{hunk.summary}</p>
            <p className="text-[11.5px] text-muted-foreground">
              {hunk.author} · {longDate(iso(hunk.authorTime), t)}
            </p>
            <code className="text-[11.5px] text-muted-foreground select-all">{hunk.sha}</code>
            <PullRequestLink repoPath={repoPath} sha={hunk.sha} />
            <button
              type="button"
              onClick={() => (openCommit(hunk.sha), onClose())}
              className="self-start rounded px-1.5 py-0.5 text-[11.5px] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
            >
              {t("blame.openCommit")}
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Inline blame of the file in front (⌥⌘B): fills the view's blame slot once the blame is loaded.
 * `apply` must also run whenever a tab's state is swapped into the view, which resets the slot.
 */
export function useBlameLayer(
  repoPath: string,
  path: string | null,
  view: RefObject<EditorView | null>,
  shown: RefObject<string | null>,
) {
  const t = useT();
  const on = useBlameStore((s) => s.on);
  // The cursor line's author is always shown, as in Zed; ⌥⌘B adds the whole gutter.
  const { data } = useBlame(repoPath, path, true);
  const [card, setCard] = useState<Card | null>(null);
  // Behind a ref so callers get a stable function, not one that changes each time the blame reloads.
  const applyRef = useRef(() => {});
  useEffect(() => {
    applyRef.current = () => {
      const current = view.current;
      if (!current) return;
      const hunks = data && path && shown.current === path ? data : null;
      const open = (hunk: BlameHunk, anchor: DOMRect) => setCard({ hunk, anchor });
      current.dispatch({
        effects: blameSlot.reconfigure(hunks ? blameExtension(hunks, labelsFor(t), open, on) : []),
      });
    };
    applyRef.current();
  }, [data, on, path, shown, t, view]);
  const reapply = useCallback(() => applyRef.current(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || !e.altKey || e.code !== "KeyB") return;
      e.preventDefault();
      useBlameStore.getState().toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const cardElement = card && <BlameCard repoPath={repoPath} card={card} onClose={() => setCard(null)} />;
  return { apply: reapply, card: cardElement };
}

const toolbarButton =
  "grid size-6 place-items-center rounded text-muted-foreground hover:bg-white/[0.06] hover:text-foreground aria-pressed:bg-primary/20 aria-pressed:text-primary";

export function BlameToggle() {
  const t = useT();
  const on = useBlameStore((s) => s.on);
  return (
    <button
      type="button"
      aria-label={t("blame.toggle")}
      title={`${t("blame.toggle")} ⌥⌘B`}
      aria-pressed={on}
      onClick={() => useBlameStore.getState().toggle()}
      className={toolbarButton}
    >
      <UserRoundSearch aria-hidden className="size-3.5" />
    </button>
  );
}

function CommitFileDialog({
  repoPath,
  commit,
  onClose,
}: {
  repoPath: string;
  commit: FileCommit;
  onClose: () => void;
}) {
  const t = useT();
  const diff = useCommitDiff(repoPath, commit.hash, commit.path, commit.previousPath, true);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 p-4 sm:max-w-4xl">
        <DialogHeader className="gap-1 pr-6">
          <DialogTitle className="text-[13px] font-medium">{commit.subject}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
            <span>
              {commit.author} · {longDate(commit.authoredAt, t)} · <code>{commit.hash.slice(0, 8)}</code>
            </span>
            <PullRequestLink repoPath={repoPath} sha={commit.hash} />
            <button
              type="button"
              onClick={() => (openCommit(commit.hash), onClose())}
              className="rounded px-1.5 py-0.5 hover:bg-white/[0.06] hover:text-foreground"
            >
              {t("blame.openCommit")}
            </button>
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-white/[0.06]">
          <DiffBody path={commit.path} diff={diff.data} error={diff.error} loading={diff.isLoading} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Commits touching the file (renames followed); one opens its diff of the file. */
export function FileHistoryButton({ repoPath, path }: { repoPath: string; path: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<FileCommit | null>(null);
  const history = useFileHistory(repoPath, path, open);
  const commits = history.data ?? [];
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("blame.fileHistory")}
            title={t("blame.fileHistory")}
            className={toolbarButton}
          >
            <History aria-hidden className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 p-0 text-[12px]">
          <header className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
            <span className="font-medium">{t("blame.fileHistory")}</span>
            {history.data && (
              <span className="text-[11.5px] text-muted-foreground">{t.plural("blame.commits", commits.length)}</span>
            )}
          </header>
          {history.isLoading && <p className="px-3 py-2 text-muted-foreground">{t("blame.loading")}</p>}
          {history.isError && <p className="px-3 py-2 text-muted-foreground">{t("blame.historyFailed")}</p>}
          {history.data && commits.length === 0 && (
            <p className="px-3 py-2 text-muted-foreground">{t("blame.historyEmpty")}</p>
          )}
          <ul className="max-h-96 overflow-y-auto py-1">
            {commits.map((commit) => (
              <li key={commit.hash}>
                <button
                  type="button"
                  onClick={() => (setPicked(commit), setOpen(false))}
                  title={`${commit.hash.slice(0, 8)} · ${commit.path}`}
                  className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-white/[0.06]"
                >
                  <span className="truncate text-foreground">{commit.subject}</span>
                  <span className="truncate text-[11.5px] text-muted-foreground">
                    {commit.author} · {formatAge(commit.authoredAt, undefined, t.locale)} ·{" "}
                    <code>{commit.hash.slice(0, 7)}</code>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      {picked && <CommitFileDialog repoPath={repoPath} commit={picked} onClose={() => setPicked(null)} />}
    </>
  );
}
