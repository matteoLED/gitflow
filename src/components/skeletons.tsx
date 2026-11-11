import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/*
 * Placeholders shaped like the lists they stand in for, at the real row heights, so nothing jumps when data lands.
 * Widths come from a fixed table (renders stay pure); `motion-safe:animate-pulse` leaves them static under reduced motion.
 */

const WIDTHS = [72, 54, 84, 62, 46, 78, 58, 68, 50, 81, 64, 40];
export const skeletonWidth = (i: number, scale = 1) => `${Math.round(WIDTHS[i % WIDTHS.length] * scale)}%`;

/** Announces "Loading…" once for the whole list, then draws `rows` placeholders. */
export function SkeletonList({
  rows = 10,
  className,
  row,
}: {
  rows?: number;
  className?: string;
  row: (i: number) => ReactNode;
}) {
  const t = useT();
  return (
    <div role="status" aria-busy aria-label={t("common.loading")} className={cn("overflow-hidden", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden>
          {row(i)}
        </div>
      ))}
    </div>
  );
}

type RowSkeletonProps = {
  i: number;
  /** Row height in px, the same as the real row. */
  height: number;
  lead?: "icon" | "avatar" | null;
  lines?: 1 | 2;
  trail?: boolean;
  className?: string;
};

/** A generic list row: an icon, one or two lines of text, an optional trailing meta. */
export function RowSkeleton({ i, height, lead = "icon", lines = 2, trail = true, className }: RowSkeletonProps) {
  return (
    <div style={{ height }} className={cn("flex items-center gap-2.5 px-2", className)}>
      {lead && <Skeleton className={cn("shrink-0", lead === "avatar" ? "size-4 rounded-full" : "size-3.5 rounded")} />}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-2.5 max-w-[520px]" style={{ width: skeletonWidth(i) }} />
        {lines === 2 && (
          <Skeleton className="h-2 max-w-[320px] bg-white/[0.04]" style={{ width: skeletonWidth(i + 5, 0.6) }} />
        )}
      </div>
      {trail && <Skeleton className="h-2 w-7 shrink-0 bg-white/[0.04]" />}
    </div>
  );
}

/** Commit rows: the graph lane (a line through a dot), the subject, then author and date. */
export function CommitListSkeleton({ rows = 14 }: { rows?: number }) {
  return (
    <SkeletonList
      rows={rows}
      className="min-h-0 flex-1 px-2 pb-2"
      row={(i) => (
        <div className="relative flex h-[46px] flex-col justify-center gap-1.5 pr-3 pl-7">
          <span aria-hidden className="absolute inset-y-0 left-[10px] w-px bg-white/[0.07]" />
          <span
            aria-hidden
            className="absolute top-[11px] left-[7px] size-2 rounded-full border-2 border-white/[0.12] bg-panel"
          />
          <Skeleton className="h-2.5" style={{ width: skeletonWidth(i) }} />
          <div className="flex items-center gap-2">
            <Skeleton className="h-2 bg-white/[0.04]" style={{ width: skeletonWidth(i + 3, 0.4) }} />
            <Skeleton className="ml-auto h-2 w-8 bg-white/[0.04]" />
          </div>
        </div>
      )}
    />
  );
}

/** Diff body: a gutter and code lines of varying width, at the code line height. */
export function DiffSkeleton({ lines = 8 }: { lines?: number }) {
  return (
    <SkeletonList
      rows={lines}
      className="py-1.5"
      row={(i) => (
        <div className="flex h-[18.6px] items-center gap-4 px-3">
          <Skeleton className="h-2 w-6 shrink-0 bg-white/[0.035]" />
          <Skeleton className="h-2 bg-white/[0.05]" style={{ width: skeletonWidth(i * 7, i % 4 === 3 ? 0.35 : 0.8) }} />
        </div>
      )}
    />
  );
}
