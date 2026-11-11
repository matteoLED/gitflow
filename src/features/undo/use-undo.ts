import { useEffect } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { useGitAction } from "@/features/operations/use-git-action";
import { getT, useT, type MessageKey } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { useNoticesStore } from "@/stores/notices-store";
import type { UndoAction, UndoKind } from "@/types/git";

const TITLE: Record<UndoKind, MessageKey> = {
  commit: "undo.title.commit",
  amend: "undo.title.amend",
  merge: "undo.title.merge",
  rebase: "undo.title.rebase",
  fixup: "undo.title.fixup",
  pull: "undo.title.pull",
  reset: "undo.title.reset",
  checkout: "undo.title.checkout",
  branchDelete: "undo.title.branchDelete",
};

const DESCRIPTION: Record<UndoKind, MessageKey> = {
  commit: "undo.commit",
  amend: "undo.amend",
  merge: "undo.merge",
  rebase: "undo.rebase",
  fixup: "undo.fixup",
  pull: "undo.pull",
  reset: "undo.reset",
  checkout: "undo.checkout",
  branchDelete: "undo.branchDelete",
};

/** Exactly what undoing `action` does, for the confirmation. */
export function describeUndo(action: UndoAction, t = getT()) {
  const params = { label: action.label, branch: action.branch ?? "HEAD", target: action.target.slice(0, 7) };
  return { title: t(TITLE[action.kind]), description: t(DESCRIPTION[action.kind], params) };
}

/** Finds the last undoable Git operation, describes it, and reverses it once confirmed. */
export function useUndo(repoPath: string) {
  const t = useT();
  const notify = useNoticesStore((s) => s.notify);
  const undo = useGitAction<UndoAction>(repoPath, {
    run: (action) => gitBackend.undoLast(repoPath, action),
    success: t("undo.done"),
    failure: t("undo.failed"),
  });
  return async () => {
    let action: UndoAction | null;
    try {
      action = await gitBackend.lastUndo(repoPath);
    } catch (error) {
      notify({ tone: "error", title: t("undo.failed"), detail: toGitError(error).message });
      return;
    }
    if (!action) {
      notify({ tone: "success", title: t("undo.nothing") });
      return;
    }
    const { title, description } = describeUndo(action, t);
    if (await ask(description, { title, kind: "warning", okLabel: t("undo.confirm") })) undo.mutate(action);
  };
}

/** True when ⌘Z belongs to what has focus: a field, an editor or the terminal undo their own typing. */
const isEditing = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest("input, textarea, select, [contenteditable]");

/** ⌘Z outside text fields and editors: undo the last Git operation (after confirmation). */
export function useUndoShortcut(repoPath: string) {
  const undo = useUndo(repoPath);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
      if (e.defaultPrevented || isEditing(e.target)) return;
      e.preventDefault();
      void undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);
}
