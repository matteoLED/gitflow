import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitCommitHorizontal } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { invalidateRepo, useRefs } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useNoticesStore } from "@/stores/notices-store";
import { forcePushWithLease } from "./force-push";

/** Where a branch usually goes back onto: the remote's main branch first. */
function defaultOnto(remotes: string[]) {
  return ["origin/main", "origin/master", "main", "master"].find((r) => remotes.includes(r)) ?? remotes[0] ?? "";
}

/**
 * Moves the current branch onto another (`git fetch` then `git rebase --onto`): the user picks the first commit
 * to keep, so commits that already landed another way (a squash-merged parent branch) are left behind. Then the
 * branch can replace its remote copy with a lease.
 */
export function RebaseDialog({
  repoPath,
  open,
  onOpenChange,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const refs = useRefs(repoPath).data;
  const branch = refs?.head.branch ?? null;
  const upstream = refs?.branches.find((b) => b.name === branch)?.upstream ?? null;
  const targets = [
    ...(refs?.remotes ?? []).filter((r) => r.name !== "HEAD").map((r) => `${r.remote}/${r.name}`),
    ...(refs?.branches ?? []).map((b) => b.name).filter((name) => name !== branch),
  ];
  const [onto, setOnto] = useState("");
  const target = onto || defaultOnto(targets);
  // Fetched first, so "onto" is today's remote branch.
  const fetched = useQuery({
    queryKey: ["rebase-fetch", repoPath],
    queryFn: () => gitBackend.fetch(repoPath).then(() => true),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });
  const commits = useQuery({
    queryKey: ["rebase-candidates", repoPath, target],
    queryFn: () => gitBackend.rebaseCandidates(repoPath, target),
    enabled: open && !!target && !fetched.isPending,
  });
  // The first commit kept (by hash, so another target resets it); all by default.
  const [firstHash, setFirstHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = commits.data ?? [];
  const first = Math.max(0, list.findIndex(([hash]) => hash === firstHash));

  const run = async () => {
    if (!branch) return;
    setBusy(true);
    try {
      const after = first > 0 ? list[first - 1][0] : null;
      await gitBackend.rebaseOnto(repoPath, target, after);
      onOpenChange(false);
      notify({
        tone: "success",
        title: t("rebaseOnto.done", { branch, onto: target }),
        action: upstream
          ? {
              label: t("sync.force"),
              run: () => void forcePushWithLease(repoPath, branch, () => void invalidateRepo(client, repoPath)),
            }
          : undefined,
      });
    } catch (error) {
      // Conflicts leave the rebase in progress: the app's operation bar takes over (continue / abort).
      const { message, detail } = toGitError(error);
      onOpenChange(false);
      notify({ tone: "error", title: t("action.failed", { action: t("rebaseOnto.title", { branch }), message }), detail });
    } finally {
      setBusy(false);
      void invalidateRepo(client, repoPath);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("rebaseOnto.title", { branch: branch ?? "" })}</DialogTitle>
          <DialogDescription>{t("rebaseOnto.description")}</DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-3 text-[13px]">
          <span className="w-20 shrink-0 text-muted-foreground">{t("rebaseOnto.onto")}</span>
          <Select value={target} onValueChange={setOnto}>
            <SelectTrigger className="h-8 min-w-0 flex-1 font-mono text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {targets.map((name) => (
                <SelectItem key={name} value={name} className="font-mono text-[12px]">
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <div className="space-y-1.5">
          <p className="text-[12.5px] text-muted-foreground">{t("rebaseOnto.keep")}</p>
          <ul className="max-h-64 overflow-y-auto rounded-lg border border-white/[0.07] p-1">
            {(fetched.isPending || commits.isPending) && (
              <li className="flex items-center gap-2 px-2 py-1.5 text-[12.5px] text-muted-foreground">
                <BrailleLoader /> {t("common.loading")}
              </li>
            )}
            {commits.isSuccess && list.length === 0 && (
              <li className="px-2 py-1.5 text-[12.5px] text-muted-foreground">{t("rebaseOnto.nothing")}</li>
            )}
            {list.map(([hash, subject], index) => (
              <li key={hash}>
                <button
                  type="button"
                  onClick={() => setFirstHash(list[index][0])}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-white/[0.05]",
                    index < first && "text-muted-foreground line-through decoration-muted-foreground/60",
                  )}
                >
                  <GitCommitHorizontal
                    aria-hidden
                    className={cn("size-3.5 shrink-0", index < first ? "text-muted-foreground" : "text-primary")}
                  />
                  <code className="shrink-0 font-mono text-[11.5px] text-muted-foreground">{hash.slice(0, 7)}</code>
                  <span className="min-w-0 flex-1 truncate">{subject}</span>
                  {index === first && <span className="shrink-0 text-[11px] text-primary">{t("rebaseOnto.from")}</span>}
                </button>
              </li>
            ))}
          </ul>
          {first > 0 && <p className="text-[12px] text-muted-foreground">{t.plural("rebaseOnto.dropped", first)}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={busy || !branch || !target || list.length === 0} onClick={() => void run()}>
            {busy && <BrailleLoader />}
            {t("rebaseOnto.run")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
