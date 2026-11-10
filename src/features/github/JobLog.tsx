import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { StatusIcon, ghStatus } from "@/features/agents/status";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import type { WorkflowJob } from "@/types/git";
import { delta, parseJobLog, span, type LogLine, type StepLog } from "./job-log";
import { AnsiLine, jobIdOf } from "./PullRequestCi";

const ROW = "flex w-full items-start text-left";
const TIME = "w-24 shrink-0 pl-7 text-muted-foreground tabular-nums select-none";

function Line({ line, previous }: { line: LogLine; previous: number | null }) {
  return (
    <div data-log-error={line.error || undefined} className={cn(ROW, line.error && "bg-removed/15")}>
      <span className={TIME}>{line.at !== null && previous !== null ? delta(line.at - previous) : ""}</span>
      {line.error && <span className="mt-[0.6em] mr-2 -ml-4 size-2 shrink-0 rounded-full bg-removed-foreground" />}
      <span className="min-w-0 flex-1 pr-4 break-all whitespace-pre-wrap">
        <AnsiLine line={line.text} />
      </span>
    </div>
  );
}

function StepBody({ log }: { log: StepLog }) {
  // A fold opens by itself when the failure is inside it.
  const [open, setOpen] = useState(
    () =>
      new Set(log.items.flatMap((item, i) => (item.kind === "group" && item.lines.some((l) => l.error) ? [i] : []))),
  );
  // Each row shows the time since the row before it: worked out once, before rendering.
  const rows: ReactNode[] = [];
  let previous = log.start;
  log.items.forEach((item, i) => {
    if (item.kind === "line") {
      rows.push(<Line key={i} line={item.line} previous={previous} />);
      previous = item.line.at ?? previous;
      return;
    }
    const expanded = open.has(i);
    const title = item.title;
    rows.push(
      <button
        key={i}
        type="button"
        onClick={() => setOpen((s) => new Set(s.has(i) ? [...s].filter((x) => x !== i) : [...s, i]))}
        className={cn(ROW, "hover:bg-white/[0.03]")}
      >
        <span className={TIME}>{title.at !== null && previous !== null ? delta(title.at - previous) : ""}</span>
        <ChevronRight
          aria-hidden
          className={cn(
            "mt-[0.4em] mr-2 size-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate pr-4">{title.text}</span>
      </button>,
    );
    let inner = title.at;
    for (const [j, line] of item.lines.entries()) {
      if (expanded) rows.push(<Line key={`${i}:${j}`} line={line} previous={inner} />);
      inner = line.at ?? inner;
    }
    previous = inner ?? previous;
  });
  return rows;
}

/**
 * A job as Linear shows it: every step with its outcome and duration, unfolding into its log with the time
 * between lines. Failing steps start open, and the first error is scrolled into view.
 */
export function JobLogView({ repoPath, job }: { repoPath: string; job: WorkflowJob }) {
  const t = useT();
  const id = jobIdOf(job);
  const done = job.status === "completed";
  const log = useQuery({
    queryKey: ["job-log", repoPath, id, false],
    queryFn: () => gitBackend.getJobLog(repoPath, id ?? 0, false),
    enabled: !!id && done,
    staleTime: Infinity,
  });
  const parsed = useMemo(() => parseJobLog(log.data ?? ""), [log.data]);
  const steps = useMemo(() => {
    const known = job.steps.map((s) => ({ key: `${s.number}`, name: s.name, step: s, log: parsed.get(s.name) }));
    const named = new Set(job.steps.map((s) => s.name));
    const extra = [...parsed]
      .filter(([name]) => !named.has(name))
      .map(([name, l]) => ({ key: name, name, step: null, log: l }));
    return [...known, ...extra];
  }, [job.steps, parsed]);
  const [open, setOpen] = useState(
    () => new Set(job.steps.filter((s) => s.conclusion === "failure").map((s) => `${s.number}`)),
  );
  const ref = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !log.data) return;
    const error = ref.current?.querySelector("[data-log-error]");
    if (!error) return;
    scrolled.current = true;
    error.scrollIntoView({ block: "center" });
  }, [log.data]);
  return (
    <div ref={ref} className="py-1.5 font-mono text-[12.5px] leading-[1.85] select-text">
      {steps.map(({ key, name, step, log: stepLog }) => {
        const expanded = open.has(key) && !!stepLog;
        const time = stepLog?.start != null && stepLog.end != null ? span(stepLog.end - stepLog.start) : null;
        return (
          <Fragment key={key}>
            <button
              type="button"
              disabled={!stepLog}
              onClick={() => setOpen((s) => new Set(s.has(key) ? [...s].filter((x) => x !== key) : [...s, key]))}
              className={cn(
                ROW,
                "items-center py-0.5 pr-4 enabled:hover:bg-white/[0.04]",
                expanded && "bg-white/[0.03]",
              )}
            >
              <span className="grid w-10 shrink-0 place-items-center">
                {step && <StatusIcon status={ghStatus(step.status, step.conclusion)} />}
              </span>
              <ChevronRight
                aria-hidden
                className={cn(
                  "mr-2 size-3.5 shrink-0 text-muted-foreground transition-transform",
                  expanded && "rotate-90",
                  !stepLog && "opacity-0",
                )}
              />
              <span
                className={cn("min-w-0 flex-1 truncate", step?.conclusion === "skipped" && "text-muted-foreground")}
              >
                {name || "—"}
              </span>
              {time && <span className="shrink-0 text-muted-foreground tabular-nums">{time}</span>}
            </button>
            {expanded && stepLog && <StepBody log={stepLog} />}
          </Fragment>
        );
      })}
      {!done && <p className="px-4 py-2 font-sans text-[12.5px] text-muted-foreground">{t("ci.running")}</p>}
      {log.isError && (
        <p className="px-4 py-2 font-sans text-[12.5px] text-removed-foreground">{toGitError(log.error).message}</p>
      )}
      {done && log.isPending && (
        <div className="px-4 py-2">
          <BrailleLoader className="text-primary" />
        </div>
      )}
    </div>
  );
}
