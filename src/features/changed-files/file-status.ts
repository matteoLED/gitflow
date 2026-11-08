import type { FileStatus } from "@/types/git";
import type { MessageKey, Translator } from "@/i18n";

/** Status letter, label and color, shared by the file lists. */
export const FILE_STATUS: Record<FileStatus, { letter: string; label: MessageKey; className: string }> = {
  added: { letter: "A", label: "status.added", className: "text-added-foreground" },
  modified: { letter: "M", label: "status.modified", className: "text-ring" },
  deleted: { letter: "D", label: "status.deleted", className: "text-removed-foreground" },
  renamed: { letter: "R", label: "status.renamed", className: "text-renamed" },
  copied: { letter: "C", label: "status.copied", className: "text-renamed" },
  unmerged: { letter: "!", label: "status.unmerged", className: "text-renamed" },
  untracked: { letter: "U", label: "status.untracked", className: "text-added-foreground" },
};

export type ChangeMark = { className: string; label: string };

/**
 * Reference look: a green dot when lines were only added, red when only removed, a red/green pill for both.
 * Deleted and new files keep their own shape; the label is always exposed to assistive tech.
 */
export function changeMark(
  file: { status: FileStatus; additions: number | null; deletions: number | null },
  t: Translator,
): ChangeMark {
  const label = t(FILE_STATUS[file.status].label);
  if (file.status === "deleted") return { label, className: "h-[3px] w-2 rounded-full bg-removed-foreground" };
  if (file.status === "untracked") return { label, className: "size-1.5 rounded-full border border-added-foreground" };
  const added = (file.additions ?? 0) > 0;
  const removed = (file.deletions ?? 0) > 0;
  if (added && removed) {
    return {
      label: t("status.linesBoth", { label }),
      className:
        "h-1.5 w-2.5 rounded-full bg-[linear-gradient(90deg,var(--removed-foreground)_50%,var(--added-foreground)_50%)]",
    };
  }
  if (removed)
    return { label: t("status.linesRemoved", { label }), className: "size-1.5 rounded-full bg-removed-foreground" };
  if (added)
    return { label: t("status.linesAdded", { label }), className: "size-1.5 rounded-full bg-added-foreground" };
  return { label, className: "size-1.5 rotate-45 bg-renamed" }; // binary, rename or mode change only
}
