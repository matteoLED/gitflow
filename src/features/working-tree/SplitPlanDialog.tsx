import { useState } from "react";
import { X } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useGitAction } from "@/features/operations/use-git-action";
import { gitBackend } from "@/lib/tauri-git";
import { useT } from "@/i18n";
import type { CommitGroup } from "@/types/git";

const OUT = "out";

type Props = { repoPath: string; plan: CommitGroup[]; changed: string[]; onClose: () => void };

/** Moves `file` to group `target` (an index, or OUT to leave it uncommitted). */
function moveFile(groups: CommitGroup[], file: string, target: string) {
  return groups.map((group, i) => ({
    ...group,
    files: [...group.files.filter((f) => f !== file), ...(String(i) === target ? [file] : [])],
  }));
}

function FileRow({
  file,
  value,
  groups,
  onMove,
}: {
  file: string;
  value: string;
  groups: number;
  onMove: (to: string) => void;
}) {
  const t = useT();
  return (
    <li className="flex h-7 items-center gap-2">
      <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={file}>
        {file}
      </span>
      <Select value={value} onValueChange={onMove}>
        <SelectTrigger size="sm" aria-label={t("aiSplit.moveTo", { path: file })} className="h-6 w-32 text-[12px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: groups }, (_, i) => (
            <SelectItem key={i} value={String(i)} className="text-[12px]">
              {t("split.step", { number: i + 1 })}
            </SelectItem>
          ))}
          <SelectItem value={OUT} className="text-[12px]">
            {t("aiSplit.leftOut")}
          </SelectItem>
        </SelectContent>
      </Select>
    </li>
  );
}

/** The agent's proposed commits, editable before anything is committed. */
export function SplitPlanDialog({ repoPath, plan, changed, onClose }: Props) {
  const t = useT();
  const [groups, setGroups] = useState(plan);
  const planned = new Set(groups.flatMap((g) => g.files));
  const leftOut = changed.filter((f) => !planned.has(f));
  const ready = groups.filter((g) => g.files.length > 0);
  const commit = useGitAction(repoPath, {
    run: () => gitBackend.commitGroups(repoPath, ready),
    success: t("aiSplit.done"),
    failure: t("aiSplit.failed"),
  });
  const valid = ready.length > 0 && ready.every((g) => g.message.trim()) && !commit.isPending;
  const move = (file: string) => (to: string) => setGroups((prev) => moveFile(prev, file, to));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] gap-3 rounded-xl sm:max-w-[640px]">
        <DialogTitle className="text-[15px]">{t("aiSplit.title")}</DialogTitle>
        <DialogDescription className="text-[12.5px]">{t("aiSplit.hint")}</DialogDescription>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
          {groups.map((group, i) => (
            <section key={i} className="rounded-lg border border-white/8 p-2.5">
              <header className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-muted-foreground">
                {t("split.step", { number: i + 1 })}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("aiSplit.drop")}
                  onClick={() => setGroups((prev) => prev.filter((_, j) => j !== i))}
                >
                  <X />
                </Button>
              </header>
              <Textarea
                aria-label={t("changes.message")}
                value={group.message}
                onChange={(e) =>
                  setGroups((prev) => prev.map((g, j) => (j === i ? { ...g, message: e.target.value } : g)))
                }
                className="min-h-14 resize-none bg-transparent text-[13px] md:text-[13px]"
              />
              <ul className="mt-1.5">
                {group.files.map((file) => (
                  <FileRow key={file} file={file} value={String(i)} groups={groups.length} onMove={move(file)} />
                ))}
              </ul>
            </section>
          ))}
          {leftOut.length > 0 && (
            <section className="px-2.5">
              <h3 className="mb-1 text-[12px] font-medium text-muted-foreground">{t("aiSplit.leftOut")}</h3>
              <ul>
                {leftOut.map((file) => (
                  <FileRow key={file} file={file} value={OUT} groups={groups.length} onMove={move(file)} />
                ))}
              </ul>
            </section>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("staging.cancel")}
          </Button>
          <Button disabled={!valid} onClick={() => commit.mutate(undefined, { onSuccess: onClose })}>
            {commit.isPending && <BrailleLoader />}
            {t.plural("aiSplit.confirm", ready.length)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
