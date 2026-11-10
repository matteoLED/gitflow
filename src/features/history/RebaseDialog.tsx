import { useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { DataUnavailable } from "@/components/states";
import { BrailleLoader } from "@/components/braille-loader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import type { RebaseAction, RebaseCommit } from "@/types/git";
import { REBASE_ACTIONS, initialSteps, isUnchanged, moveStep, stepsError, toBackend, updateStep } from "./rebase-steps";
import { useRewrite } from "./use-rewrite";

const stepId = (hash: string) => `rebase-step-${hash}`;

/** Interactive rebase from `from` (included) to HEAD, oldest first: reorder, reword, squash, fixup or drop. */
export function RebaseDialog({
  repoPath,
  from,
  onClose,
}: {
  repoPath: string;
  from: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const plan = useQuery({
    queryKey: ["rebase-plan", repoPath, from],
    queryFn: () => gitBackend.rebasePlan(repoPath, from ?? ""),
    enabled: from !== null,
    staleTime: 0,
    gcTime: 0,
  });
  return (
    <Dialog open={from !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] gap-3 rounded-xl sm:max-w-[720px]">
        <div>
          <DialogTitle className="text-[15px]">{t("rebase.title")}</DialogTitle>
          <DialogDescription className="text-[12.5px]">{t("rebase.subtitle")}</DialogDescription>
        </div>
        {plan.isError ? (
          <DataUnavailable title={t("rebase.loadError")} error={plan.error} onRetry={() => void plan.refetch()} />
        ) : plan.data && from ? (
          <RebaseEditor key={from} repoPath={repoPath} from={from} commits={plan.data} onClose={onClose} />
        ) : (
          <p className="flex justify-center py-6">
            <BrailleLoader className="text-primary" label={t("common.loading")} />
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

type EditorProps = { repoPath: string; from: string; commits: RebaseCommit[]; onClose: () => void };

function RebaseEditor({ repoPath, from, commits, onClose }: EditorProps) {
  const t = useT();
  const [steps, setSteps] = useState(() => initialSteps(commits));
  const [dragging, setDragging] = useState<number | null>(null);
  const rewrite = useRewrite(repoPath);
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const error = stepsError(steps);
  const unchanged = isUnchanged(steps, commits);

  const move = (index: number, to: number) => {
    const hash = steps[index].hash;
    setSteps(moveStep(steps, index, to));
    // The moved row keeps keyboard focus so Alt+↑/↓ can be repeated.
    requestAnimationFrame(() => document.getElementById(stepId(hash))?.focus());
  };
  const setAction = (index: number, action: RebaseAction) => {
    const step = steps[index];
    const message = action === "reword" ? (step.message ?? byHash.get(step.hash)?.message ?? "") : step.message;
    setSteps(updateStep(steps, index, { action, message }));
  };
  const onRowKeyDown = (event: KeyboardEvent, index: number) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    move(index, index + (event.key === "ArrowUp" ? -1 : 1));
  };
  const start = () =>
    rewrite.mutate(
      {
        run: (confirmed) => gitBackend.interactiveRebase(repoPath, from, toBackend(steps), confirmed),
        success: t("rebase.done"),
      },
      { onSuccess: (outcome) => outcome && onClose() },
    );

  return (
    <>
      <ol className="-mx-1 flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto px-1">
        {steps.map((step, index) => {
          const commit = byHash.get(step.hash);
          const sha = step.hash.slice(0, 7);
          return (
            <li
              key={step.hash}
              id={stepId(step.hash)}
              tabIndex={0}
              draggable
              onDragStart={() => setDragging(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dragging !== null && move(dragging, index)}
              onDragEnd={() => setDragging(null)}
              onKeyDown={(e) => onRowKeyDown(e, index)}
              className={cn(
                "flex flex-col gap-1.5 rounded-lg px-1.5 py-1 outline-none hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring",
                dragging === index && "opacity-50",
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <GripVertical
                  aria-label={t("rebase.dragHandle")}
                  className="size-3.5 shrink-0 cursor-grab text-muted-foreground"
                />
                <Select value={step.action} onValueChange={(v) => setAction(index, v as RebaseAction)}>
                  <SelectTrigger
                    size="sm"
                    className="h-7 w-32 shrink-0 text-[12.5px]"
                    aria-label={t("rebase.action", { sha })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REBASE_ACTIONS.map((action) => (
                      <SelectItem key={action} value={action} className="text-[12.5px]">
                        {t(`rebase.${action}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <code className="shrink-0 text-[11.5px] text-muted-foreground">{sha}</code>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[12.5px]",
                    step.action === "drop" && "text-muted-foreground line-through",
                    (step.action === "squash" || step.action === "fixup") && "text-foreground/70",
                  )}
                  title={commit?.message}
                >
                  {commit?.subject}
                </span>
                <span className="hidden shrink-0 text-[11.5px] text-muted-foreground sm:inline">{commit?.author}</span>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t("rebase.moveUp")}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t("rebase.moveDown")}
                  disabled={index === steps.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDown />
                </Button>
              </div>
              {step.action === "reword" && (
                <Textarea
                  aria-label={t("rebase.message", { sha })}
                  value={step.message ?? ""}
                  onChange={(e) => setSteps(updateStep(steps, index, { message: e.target.value }))}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="ml-5.5 min-h-20 w-auto resize-y font-mono text-[12.5px] md:text-[12.5px]"
                />
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex items-center gap-2">
        <span className={cn("min-w-0 flex-1 truncate text-[12px]", error ? "text-amber-300" : "text-muted-foreground")}>
          {error ? t(error) : unchanged ? t("rebase.nothing") : t.plural("rebase.count", steps.length)}
        </span>
        {rewrite.isPending && <BrailleLoader className="text-primary" />}
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="button" size="sm" disabled={!!error || unchanged || rewrite.isPending} onClick={start}>
          {t("rebase.start")}
        </Button>
      </div>
    </>
  );
}
