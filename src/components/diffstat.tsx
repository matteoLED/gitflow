import { cn } from "@/lib/utils";

const BLOCKS = 5;

/** GitHub's diffstat: five squares split between added and removed lines, gray for what's left. */
export function DiffStatBar({ add, del, className }: { add: number; del: number; className?: string }) {
  const total = add + del;
  const green = total ? Math.round((add / total) * BLOCKS) : 0;
  const red = total ? Math.min(BLOCKS - green, Math.max(del > 0 ? 1 : 0, Math.round((del / total) * BLOCKS))) : 0;
  return (
    <span aria-hidden className={cn("flex gap-[2px]", className)}>
      {Array.from({ length: BLOCKS }, (_, i) => (
        <span
          key={i}
          className={cn(
            "size-[7px] rounded-[2px]",
            i < green ? "bg-added-foreground" : i < green + red ? "bg-removed-foreground" : "bg-white/[0.12]",
          )}
        />
      ))}
    </span>
  );
}

/** "+12 −3", each side in its color; the zero side left out. */
export function LineCounts({ add, del, className }: { add: number; del: number; className?: string }) {
  return (
    <span className={cn("flex shrink-0 gap-1.5 font-mono text-[11px] tabular-nums", className)}>
      {add > 0 && <span className="text-added-foreground">+{add}</span>}
      {del > 0 && <span className="text-removed-foreground">−{del}</span>}
    </span>
  );
}
