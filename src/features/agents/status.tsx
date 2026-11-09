import { CircleCheck, CircleDashed, CircleMinus, CircleX } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { cn } from "@/lib/utils";

export type Status = "running" | "queued" | "done" | "failed" | "cancelled" | "skipped";

/** One status vocabulary for app runs, sessions and GitHub Actions. */
export function StatusIcon({ status, className }: { status: Status; className?: string }) {
  const base = cn("size-3.5 shrink-0", className);
  switch (status) {
    case "running":
      return <BrailleLoader variant="grid-orbit" className={cn("text-primary", className)} />;
    case "queued":
      return <CircleDashed aria-hidden className={cn(base, "text-muted-foreground")} />;
    case "done":
      return <CircleCheck aria-hidden className={cn(base, "text-added-foreground")} />;
    case "failed":
      return <CircleX aria-hidden className={cn(base, "text-removed-foreground")} />;
    default:
      return <CircleMinus aria-hidden className={cn(base, "text-muted-foreground")} />;
  }
}

/** Maps `gh` run/job/step status + conclusion onto the shared vocabulary. */
export function ghStatus(status: string, conclusion: string): Status {
  if (status !== "completed") return status === "in_progress" ? "running" : "queued";
  if (conclusion === "success") return "done";
  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "action_required") return "failed";
  return conclusion === "skipped" ? "skipped" : "cancelled";
}
