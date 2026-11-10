import { useState } from "react";
import { Cloud, HardDrive, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { BrailleLoader } from "@/components/braille-loader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { WorkItem } from "./work-items";
import { STATUS } from "./WorkPage";
import { remoteDeletable, useDeleteBranches } from "./use-delete-branches";

/** Lists exactly which local branches go before anything is deleted. */
export function DeleteBranchesButton({
  repoPath,
  items,
  label,
  variant = "outline",
  className,
}: {
  repoPath: string;
  items: WorkItem[];
  label: string;
  variant?: "outline" | "ghost";
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [onGithub, setOnGithub] = useState(true);
  const del = useDeleteBranches(repoPath);
  const onlyRemote = items.filter((i) => !i.local);
  const withRemote = items.filter(remoteDeletable);
  // Nothing would happen: only GitHub branches, with GitHub left out.
  const nothing = !onGithub && onlyRemote.length === items.length;
  if (items.length === 0) return null;
  return (
    <>
      <Button size="xs" variant={variant} className={cn("gap-1.5", className)} onClick={() => setOpen(true)}>
        <Trash2 aria-hidden />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-4 rounded-xl sm:max-w-[520px]">
          <DialogTitle className="text-[15px]">{t.plural("branches.deleteTitle", items.length)}</DialogTitle>
          <DialogDescription className="text-[12.5px]">{t("branches.deleteHint")}</DialogDescription>
          <ul className="max-h-64 overflow-y-auto rounded-lg border border-white/[0.07]">
            {items.map((item) => {
              const { icon: Icon, className: tone, label: status } = STATUS[item.status];
              return (
                <li
                  key={item.branch}
                  className="flex items-center gap-2.5 border-b border-white/[0.05] px-3 py-2 text-[12.5px] last:border-0"
                >
                  <Icon aria-label={t(status)} className={cn("size-3.5 shrink-0", tone)} />
                  <span className="min-w-0 flex-1 truncate font-mono">{item.branch}</span>
                  {/* Nothing says this work reached the default branch: it may exist only here. */}
                  {item.remote && item.pr?.state !== "MERGED" && onGithub && (
                    <span className="shrink-0 rounded bg-renamed/15 px-1.5 text-[11px] text-renamed">
                      {t("branches.notMerged")}
                    </span>
                  )}
                  <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-muted-foreground">
                    {item.local && <HardDrive aria-label={t("branches.local")} className="size-3.5" />}
                    {item.remote && (
                      <Cloud
                        aria-label={t("branches.onGithub")}
                        className={cn("size-3.5", (!onGithub || !remoteDeletable(item)) && "opacity-30")}
                      />
                    )}
                  </span>
                  {item.pr && <span className="text-muted-foreground">#{item.pr.number}</span>}
                </li>
              );
            })}
          </ul>
          {withRemote.length > 0 && (
            <label className="flex items-start gap-2.5 text-[12.5px]">
              <Checkbox checked={onGithub} onCheckedChange={(v) => setOnGithub(v === true)} className="mt-px" />
              <span>
                {t.plural("branches.alsoGithub", withRemote.length)}
                <span className="block text-muted-foreground">{t("branches.alsoGithubHint")}</span>
              </span>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t("branches.cancel")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={del.pending || nothing}
              className="gap-1.5"
              onClick={() => void del.run(items, onGithub).then(() => setOpen(false))}
            >
              {del.pending ? <BrailleLoader /> : <Trash2 aria-hidden />}
              {t("branches.deleteConfirm", { count: items.length })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
