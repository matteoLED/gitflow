import { formatDuration } from "@/features/ci/ci-stats";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { WorkflowJob } from "@/types/git";

type Span = { name: string; start: number; end: number };

/** The job's steps on one time axis, like a request trace: where the time went, the slowest step in amber. */
export function JobTrace({ job }: { job: WorkflowJob }) {
  const t = useT();
  const origin = Date.parse(job.startedAt);
  const spans: Span[] = job.steps.flatMap((s) => {
    const start = Date.parse(s.startedAt ?? "") - origin;
    const end = Date.parse(s.completedAt ?? "") - origin;
    return Number.isFinite(start) && end >= start ? [{ name: s.name, start, end }] : [];
  });
  const total = Math.max(1, Date.parse(job.completedAt) - origin, ...spans.map((s) => s.end));
  if (spans.length < 2 || !Number.isFinite(total)) return null;
  const slowest = spans.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
  const share = Math.round(((slowest.end - slowest.start) / total) * 100);
  const pct = (ms: number) => `${(ms / total) * 100}%`;
  return (
    <details className="group mx-3 mb-2 rounded-lg border border-white/[0.06] bg-white/[0.02]">
      <summary className="flex cursor-default list-none items-center gap-2 px-3 py-2 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="font-medium">{t("trace.title")}</span>
        <span className="tabular-nums">{formatDuration(total / 1000)}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {t("trace.slowest", { step: slowest.name, share })}
        </span>
        <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <ol className="px-3 pb-3">
        {spans.map((s, i) => {
          const hot = s === slowest;
          return (
            <li
              key={i}
              className={cn(
                "grid grid-cols-[minmax(0,10rem)_1fr_3.5rem] items-center gap-3 rounded-md px-1.5 py-1 text-[12px]",
                hot && "bg-amber-400/10",
              )}
            >
              <span className={cn("truncate", hot ? "text-amber-300" : "text-muted-foreground")} title={s.name}>
                {s.name}
              </span>
              <span className="relative h-1.5">
                <span
                  className={cn("absolute inset-y-0 rounded-full", hot ? "bg-amber-400" : "bg-white/25")}
                  style={{ left: pct(s.start), width: `max(4px, ${pct(s.end - s.start)})` }}
                />
              </span>
              <span className={cn("text-right tabular-nums", hot ? "text-amber-300" : "text-muted-foreground")}>
                {formatDuration((s.end - s.start) / 1000)}
              </span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
