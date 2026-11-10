import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import type { LineStaging } from "@/features/diff/DiffCard";
import { buildPartialPatch, EndOfFileSelectionError, supportsLineStaging } from "@/features/diff/partial-patch";
import { parseUnifiedDiff } from "@/features/diff/parse-unified-diff";
import { useGitAction } from "@/features/operations/use-git-action";
import { gitBackend } from "@/lib/tauri-git";
import { useNoticesStore } from "@/stores/notices-store";
import { useT } from "@/i18n";
import type { PatchMode } from "@/types/git";
import type { SelectedChange } from "@/stores/workspace-store";

/** Selected line indexes, tied to the diff they were picked in: a new diff starts with no selection. */
type Selection = { patch: string; picked: ReadonlySet<number>; anchor: number };

const EMPTY: ReadonlySet<number> = new Set();

function nextSelection(prev: Selection | null, index: number, how: "only" | "range" | "toggle", changed: number[]) {
  if (how === "only" || !prev) return new Set([index]);
  if (how === "toggle") {
    const next = new Set(prev.picked);
    if (!next.delete(index)) next.add(index);
    return next;
  }
  const [from, to] = [Math.min(prev.anchor, index), Math.max(prev.anchor, index)];
  return new Set(changed.filter((i) => i >= from && i <= to));
}

/** Hunk and line staging for one file of the Changes view; `staging` is undefined when it doesn't apply. */
export function useLineStaging(repoPath: string, change: SelectedChange, patch: string | undefined) {
  const t = useT();
  const [selection, setSelection] = useState<Selection | null>(null);
  const notify = useNoticesStore((s) => s.notify);
  // Tied to the diff it was asked on, like the selection: a refreshed diff makes the indexes meaningless.
  const [confirmDiscard, setConfirmDiscard] = useState<Omit<Selection, "anchor"> | null>(null);
  const changed = useMemo(
    () =>
      parseUnifiedDiff(patch ?? "")
        .flatMap((h) => h.lines)
        .flatMap((line, i) => (line.kind === "context" ? [] : [i])),
    [patch],
  );
  const apply = useGitAction<{ hunks: string; mode: PatchMode }>(repoPath, {
    run: ({ hunks, mode }) => gitBackend.applyHunks(repoPath, change.path, hunks, mode),
    failure: t("staging.failed"),
  });

  // Renames, untracked, added and deleted files have no plain diff to apply partially: they stage as whole files.
  if (!patch || change.side === "untracked" || change.previousPath || !supportsLineStaging(patch)) {
    return { staging: undefined, toolbar: null };
  }
  const current = selection?.patch === patch ? selection : null;
  const picked = current?.picked ?? EMPTY;
  const pendingDiscard = confirmDiscard?.patch === patch ? confirmDiscard.picked : null;
  const run = (indexes: ReadonlySet<number>, mode: PatchMode) => {
    try {
      const hunks = buildPartialPatch(patch, indexes, mode !== "stage");
      if (hunks && !apply.isPending) apply.mutate({ hunks, mode });
    } catch (error) {
      if (!(error instanceof EndOfFileSelectionError)) throw error;
      notify({ tone: "error", title: t("staging.failed"), detail: t("staging.selectFileEnd") });
    }
  };
  const forward: PatchMode = change.side === "staged" ? "unstage" : "stage";

  const staging: LineStaging = {
    selected: picked,
    onPick: (index, how) =>
      setSelection((prev) => {
        const base = prev?.patch === patch ? prev : null;
        return {
          patch,
          picked: nextSelection(base, index, how, changed),
          anchor: how === "range" ? (base?.anchor ?? index) : index,
        };
      }),
    hunkActions: (block) => (
      <Button
        variant="secondary"
        size="xs"
        disabled={apply.isPending}
        onClick={() => run(new Set(block), forward)}
        className="h-5 px-1.5 text-[11px]"
      >
        {t(forward === "stage" ? "staging.stageHunk" : "staging.unstageHunk")}
      </Button>
    ),
  };

  const toolbar = (
    <>
      {picked.size > 0 && (
        <div className="flex items-center gap-1.5 font-sans">
          <span className="text-[12px] text-muted-foreground">{t.plural("staging.selected", picked.size)}</span>
          <Button size="xs" disabled={apply.isPending} onClick={() => run(picked, forward)}>
            {t(forward === "stage" ? "staging.stageLines" : "staging.unstageLines")}
          </Button>
          {change.side === "unstaged" && (
            <Button
              variant="outline"
              size="xs"
              disabled={apply.isPending}
              onClick={() => setConfirmDiscard({ patch, picked })}
            >
              {t("staging.discardLines")}
            </Button>
          )}
          <Button variant="ghost" size="xs" onClick={() => setSelection(null)}>
            {t("staging.clear")}
          </Button>
        </div>
      )}
      <Dialog open={pendingDiscard !== null} onOpenChange={(open) => !open && setConfirmDiscard(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogTitle className="text-[15px]">{t("staging.discardTitle")}</DialogTitle>
          <DialogDescription className="text-[13px]">
            {t.plural("staging.discardBody", pendingDiscard?.size ?? 0)}
          </DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDiscard(null)}>
              {t("staging.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDiscard) run(pendingDiscard, "discard");
                setConfirmDiscard(null);
              }}
            >
              {t("staging.discardConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
  return { staging, toolbar };
}
