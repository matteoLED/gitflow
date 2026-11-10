import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { invalidateRepo } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { useNoticesStore } from "@/stores/notices-store";
import type { WorkItem } from "./work-items";

/** A branch that can go: not the checked-out one, here or on GitHub. */
export const deletable = (item: WorkItem) => !item.current && (!!item.local || !!item.remote);

/** On GitHub, a branch with an open pull request stays: deleting it would close the PR. */
export const remoteDeletable = (item: WorkItem) => !!item.remote && item.pr?.state !== "OPEN";

/** Branches worth cleaning up: merged, or stale. */
export const cleanable = (items: WorkItem[]) =>
  items.filter((i) => deletable(i) && (i.status === "merged" || i.status === "stale"));

type Undo = () => Promise<unknown>;

/**
 * Deletes branches one by one: the local one, and the one on GitHub when `onGithub`. Merged branches go even after
 * a squash merge; anything else git doesn't see as merged is kept. One notice sums it up, with "Undo".
 */
export function useDeleteBranches(repoPath: string) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const [pending, setPending] = useState(false);
  const run = async (items: WorkItem[], onGithub: boolean, force = false): Promise<void> => {
    setPending(true);
    const undo: Undo[] = [];
    const deleted = new Set<string>();
    const kept: string[] = [];
    const unmerged: WorkItem[] = [];
    for (const item of items.filter(deletable)) {
      if (item.local) {
        const mergedHead = item.pr?.state === "MERGED" ? item.pr.headRefOid : null;
        try {
          const tip = await gitBackend.deleteBranch(repoPath, item.branch, mergedHead, force);
          undo.push(() => gitBackend.restoreBranch(repoPath, item.branch, tip));
          deleted.add(item.branch);
        } catch (error) {
          kept.push(toGitError(error).message);
          unmerged.push(item);
          continue; // The local branch stays: its GitHub one too, so the two never drift apart.
        }
      }
      if (onGithub && item.remote && remoteDeletable(item)) {
        const { remote } = item.remote;
        try {
          const tip = await gitBackend.deleteRemoteBranch(repoPath, remote, item.branch);
          undo.push(() => gitBackend.restoreRemoteBranch(repoPath, remote, item.branch, tip));
          deleted.add(item.branch);
        } catch (error) {
          kept.push(`${remote}/${item.branch}: ${toGitError(error).message}`);
        }
      }
    }
    setPending(false);
    void invalidateRepo(client, repoPath);
    if (deleted.size > 0)
      notify({
        tone: "success",
        title:
          deleted.size === 1
            ? t("branches.deleted", { name: [...deleted][0] })
            : t.plural("branches.deletedMany", deleted.size),
        action: {
          label: t("branches.undo"),
          run: () => void Promise.allSettled(undo.map((u) => u())).finally(() => void invalidateRepo(client, repoPath)),
        },
      });
    if (kept.length > 0)
      notify({
        tone: "error",
        title: t.plural("branches.keptMany", kept.length),
        detail: kept.join("\n"),
        // The user's explicit choice, after reading why: their commits stay restorable through "Undo".
        action:
          unmerged.length > 0 && !force
            ? { label: t("branches.deleteAnyway"), run: () => void run(unmerged, onGithub, true) }
            : undefined,
      });
  };
  return { run, pending };
}
