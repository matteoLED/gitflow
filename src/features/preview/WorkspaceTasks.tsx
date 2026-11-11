import { useEffect, useMemo, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { runOf, usePreviewStore, type LogLine } from "@/stores/preview-store";
import { usePreviewTargets } from "./PreviewList";
import { InputBar } from "./InputBar";

const ALL = "__all__";

/** Tasks in order of first output, with their line counts. */
function useTasks(logs: LogLine[]) {
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const { task } of logs) if (task) counts.set(task, (counts.get(task) ?? 0) + 1);
    return [...counts];
  }, [logs]);
}

/** A monorepo run, like Turborepo's TUI: every task on the left, the selected one's output on the right. */
export function WorkspaceTasks({
  repoPath,
  targetId,
  running,
}: {
  repoPath: string;
  targetId: string;
  running: boolean;
}) {
  const t = useT();
  const logs = usePreviewStore((s) => runOf(s.runs, targetId).logs);
  const [task, setTask] = useState(ALL);
  const tasks = useTasks(logs);
  const runs = usePreviewStore((s) => s.runs);
  const select = usePreviewStore((s) => s.select);
  const targets = usePreviewTargets(repoPath).data ?? [];
  // A task named after a package (or its short name) maps to that app's preview.
  const appOf = (name: string) =>
    targets.find((x) => x.kind !== "workspace" && (x.name === name || x.name.endsWith(`/${name}`)));
  const visible = task === ALL ? logs : logs.filter((l) => l.task === task);
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => ref.current?.scrollTo({ top: ref.current.scrollHeight }), [visible.length, task]);

  const row = (id: string, label: string, count: number) => {
    const app = id === ALL ? undefined : appOf(id);
    const ready = app && runOf(runs, app.id).status === "ready";
    return (
      <li key={id}>
        <button
          type="button"
          onClick={() => setTask(id)}
          className={cn(
            "group/task flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-[12px] outline-none hover:bg-white/[0.07]",
            task === id && "bg-white/10 text-foreground",
          )}
        >
          <span className={cn("size-1.5 shrink-0 rounded-full", ready ? "bg-added-foreground" : "bg-white/25")} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {ready && app ? (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-5 gap-1 rounded-full px-1.5 text-[11px] text-primary"
              onClick={(e) => {
                e.stopPropagation();
                select(app.id);
              }}
            >
              <span>
                <Eye aria-hidden className="size-3" />
                {t("preview.open")}
              </span>
            </Button>
          ) : (
            <span className="text-[11px] text-muted-foreground tabular-nums">{count}</span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 border-t border-white/[0.06]">
      <nav aria-label={t("preview.tasks")} className="w-64 shrink-0 overflow-y-auto border-r border-white/[0.06] p-2">
        <p className="px-2.5 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {t("preview.tasks")} · {tasks.length}
        </p>
        <ul>
          {row(ALL, t("preview.allTasks"), logs.length)}
          {tasks.map(([name, count]) => row(name, name, count))}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <pre
          ref={ref}
          className="min-h-0 flex-1 overflow-auto bg-black/25 px-4 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-foreground/85 select-text"
        >
          {visible.map((l) => (task === ALL && l.task ? `${l.task} │ ${l.line}` : l.line)).join("\n")}
        </pre>
        {running && <InputBar targetId={targetId} />}
      </div>
    </div>
  );
}
