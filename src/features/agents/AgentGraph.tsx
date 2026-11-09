import type { ComponentType } from "react";
import { CircleX, FileText, Globe, MessageSquare, Pencil, Search, SquareTerminal, User } from "lucide-react";
import { useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { countByCategory, type ChatItem, type ToolCall } from "./steps-model";

type Lane = "user" | "message" | "read" | "search" | "command" | "edit" | "web";

const LANES: { lane: Lane; label: MessageKey; Icon: ComponentType<{ className?: string }>; color: string }[] = [
  { lane: "user", label: "agents.lane.user", Icon: User, color: "#a1a1aa" },
  { lane: "message", label: "agents.lane.message", Icon: MessageSquare, color: "#e4e4e7" },
  { lane: "read", label: "agents.lane.read", Icon: FileText, color: "#7dd3fc" },
  { lane: "search", label: "agents.lane.search", Icon: Search, color: "#c4b5fd" },
  { lane: "command", label: "agents.lane.command", Icon: SquareTerminal, color: "#fcd34d" },
  { lane: "edit", label: "agents.lane.edit", Icon: Pencil, color: "#86efac" },
  { lane: "web", label: "agents.lane.web", Icon: Globe, color: "#5eead4" },
];

const LANE_W = 26;
const ROW_H = 28;

type Node = { key: string; lane: Lane; label: string; failed: boolean; repeat: number };

function laneOf(call: ToolCall): Lane {
  return call.category === "other" ? "command" : call.category;
}

/** One node per thing the agent did, in order. */
function toNodes(items: ChatItem[]): Node[] {
  const nodes: Node[] = [];
  for (const item of items) {
    if (item.type === "prompt")
      nodes.push({ key: `p${item.key}`, lane: "user", label: item.text, failed: false, repeat: 1 });
    else if (item.type === "message")
      nodes.push({ key: `m${item.key}`, lane: "message", label: item.text, failed: false, repeat: 1 });
    else if (item.type === "tools")
      for (const call of item.calls)
        nodes.push({
          key: `t${call.key}`,
          lane: laneOf(call),
          label: `${call.tool} · ${call.target}`,
          failed: call.failed,
          repeat: call.repeat,
        });
    else if (item.type === "error")
      nodes.push({ key: `e${item.key}`, lane: "command", label: item.step.title, failed: true, repeat: 1 });
  }
  return nodes;
}

const laneX = (lane: Lane) => LANES.findIndex((l) => l.lane === lane) * LANE_W + LANE_W / 2;
const firstLine = (text: string) => text.replace(/\s+/g, " ").trim();

function Stat({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-card px-3 py-2">
      <p className={cn("text-[18px] font-semibold tabular-nums", tone)}>{value}</p>
      <p className="text-[11.5px] text-muted-foreground">{label}</p>
    </div>
  );
}

/** Schema of a run: what the agent did, how much, on which files, as a flow through lanes. */
export function AgentGraph({ items, running }: { items: ChatItem[]; running: boolean }) {
  const t = useT();
  const calls = items.flatMap((i) => (i.type === "tools" ? i.calls : []));
  const counts = countByCategory(calls);
  const files = [
    ...new Set(calls.filter((c) => c.category === "read" || c.category === "edit").map((c) => c.target)),
  ].slice(0, 30);
  const edited = new Set(calls.filter((c) => c.category === "edit").map((c) => c.target));
  const nodes = toNodes(items);
  const result = [...items].reverse().find((i) => i.type === "result");
  const width = LANES.length * LANE_W;
  const points = nodes.map((n, i) => `${laneX(n.lane)},${i * ROW_H + ROW_H / 2}`).join(" ");

  return (
    <div className="mx-auto max-w-[900px] pt-4 pb-10">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Stat value={counts.read} label={t("agents.lane.read")} tone="text-sky-300" />
        <Stat value={counts.search} label={t("agents.lane.search")} tone="text-violet-300" />
        <Stat value={counts.command + counts.other} label={t("agents.lane.command")} tone="text-amber-300" />
        <Stat value={counts.edit} label={t("agents.lane.edit")} tone="text-added-foreground" />
        <Stat value={counts.web} label={t("agents.lane.web")} tone="text-teal-300" />
        <Stat value={counts.failed} label={t("agents.errors")} tone={counts.failed ? "text-removed-foreground" : ""} />
      </div>
      {result?.type === "result" && <p className="mt-2 text-[12px] text-muted-foreground">{result.text}</p>}

      {files.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-2 text-[12px] font-medium text-muted-foreground">{t("agents.filesTouched")}</h3>
          <div className="flex flex-wrap gap-1.5">
            {files.map((file) => (
              <span
                key={file}
                title={file}
                className={cn(
                  "max-w-72 truncate rounded-md border px-2 py-0.5 font-mono text-[11.5px]",
                  edited.has(file)
                    ? "border-added/40 bg-added/10 text-added-foreground"
                    : "border-white/[0.08] text-foreground/80",
                )}
              >
                {file}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h3 className="mb-2 text-[12px] font-medium text-muted-foreground">{t("agents.flow")}</h3>
        <div className="flex gap-3 border-b border-white/[0.06] pb-2" style={{ paddingLeft: 0 }}>
          <div className="flex shrink-0" style={{ width }}>
            {LANES.map(({ lane, label, Icon, color }) => (
              <span key={lane} title={t(label)} className="grid place-items-center" style={{ width: LANE_W, color }}>
                <Icon className="size-3.5" />
              </span>
            ))}
          </div>
        </div>
        <div className="relative flex gap-3">
          <svg aria-hidden width={width} height={nodes.length * ROW_H} className="shrink-0">
            {LANES.map(({ lane }) => (
              <line
                key={lane}
                x1={laneX(lane)}
                x2={laneX(lane)}
                y1={0}
                y2={nodes.length * ROW_H}
                style={{ stroke: "color-mix(in oklab, var(--color-white) 5%, transparent)" }}
              />
            ))}
            <polyline
              points={points}
              fill="none"
              style={{ stroke: "color-mix(in oklab, var(--color-white) 22%, transparent)" }}
              strokeWidth={1.5}
            />
            {nodes.map((n, i) => {
              const color = n.failed ? "#f87171" : (LANES.find((l) => l.lane === n.lane)?.color ?? "#fff");
              return (
                <circle
                  key={n.key}
                  cx={laneX(n.lane)}
                  cy={i * ROW_H + ROW_H / 2}
                  r={n.lane === "user" ? 5 : 4}
                  fill={n.lane === "user" || n.lane === "message" ? color : "var(--background)"}
                  stroke={color}
                  strokeWidth={2}
                />
              );
            })}
          </svg>
          <ol className="min-w-0 flex-1">
            {nodes.map((n) => (
              <li
                key={n.key}
                className={cn(
                  "flex items-center gap-2 truncate text-[12.5px]",
                  n.lane === "user" && "font-medium",
                  n.lane === "message" ? "text-foreground" : "text-muted-foreground",
                  n.failed && "text-removed-foreground",
                )}
                style={{ height: ROW_H }}
              >
                {n.failed && <CircleX aria-hidden className="size-3.5 shrink-0" />}
                <span
                  className={cn(
                    "min-w-0 truncate",
                    n.lane !== "user" && n.lane !== "message" && "font-mono text-[12px]",
                  )}
                >
                  {firstLine(n.label)}
                </span>
                {n.repeat > 1 && <span className="shrink-0 text-[11px] text-muted-foreground">×{n.repeat}</span>}
              </li>
            ))}
          </ol>
        </div>
        {running && <p className="mt-2 text-[12px] text-muted-foreground">{t("agents.working")}</p>}
      </section>
    </div>
  );
}

export default AgentGraph;
