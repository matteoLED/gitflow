import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Maximize2, Minus, Plus, RefreshCw, Settings2, Sparkles, X } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { FileIcon } from "@/components/file-icon";
import { LineCounts } from "@/components/diffstat";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LazyMarkdown as Markdown } from "@/features/agents/LazyMarkdown";
import { pickAgent } from "@/features/agents/AgentButton";
import { startAgentRun, useInstalledAgents } from "@/features/agents/use-agents";
import { parseUnifiedDiff } from "@/features/diff/parse-unified-diff";
import { getT, useT, type MessageKey } from "@/i18n";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { finalAnswer, useAgentsStore } from "@/stores/agents-store";
import { useNoticesStore } from "@/stores/notices-store";
import { useWorkspaceStore, type ActivePullRequest } from "@/stores/workspace-store";
import type { AgentKind, DiffLine } from "@/types/git";
import { finished } from "./AiReview";
import {
  layoutSteps,
  parseTour,
  snippetKey,
  snippetLines,
  tourKeyOf,
  useTourStore,
  type Level,
  type Snippet,
  type Tone,
  type Tour,
} from "./tour";

const LEVEL: Record<Level, { label: MessageKey; filled: number; tone: string }> = {
  low: { label: "tour.low", filled: 1, tone: "text-added-foreground bg-added-foreground" },
  medium: { label: "tour.medium", filled: 2, tone: "text-amber-400 bg-amber-400" },
  high: { label: "tour.high", filled: 3, tone: "text-removed-foreground bg-removed-foreground" },
};
const pad = (n: number) => String(n).padStart(2, "0");
const stepId = (i: number) => `tour-step-${i}`;

/** Asks the agent for the tour, then keeps its parsed answer for this pull request. */
async function generateTour(repoPath: string, pr: ActivePullRequest, base: string, agent: AgentKind, tone: Tone) {
  const t = getT();
  const key = tourKeyOf(repoPath, pr.number);
  const store = useTourStore.getState();
  const task = { kind: "tour-pull-request" as const, number: pr.number, base, head: pr.head, ...tone };
  const runId = await startAgentRun(repoPath, agent, task, t("tour.runTitle", { number: pr.number }));
  if (!runId) return store.set(key, null);
  store.set(key, { status: "running", runId });
  const run = await finished(runId);
  if (run.status === "cancelled") return store.set(key, null);
  const tour = run.status === "done" ? parseTour(finalAnswer(run) ?? "") : null;
  store.set(
    key,
    tour ? { status: "ready", head: pr.head, tour, tone } : { status: "failed", error: t("tour.unreadable") },
  );
  // Written in the background: wherever the user went meanwhile, say so, with the way back to it.
  useNoticesStore.getState().notify(
    tour
      ? {
          tone: "success",
          title: t("tour.ready", { number: pr.number }),
          action: {
            label: t("tour.show"),
            run: () => {
              useTourStore.getState().request(key);
              useWorkspaceStore.getState().setView("github");
            },
          },
        }
      : { tone: "error", title: t("tour.unreadable") },
  );
}

/** Three dashes, as many lit as the level: low, medium, high. Hovered, the agent's reason for the rating. */
function Meter({ label, level, reason }: { label: string; level: Level; reason: string }) {
  const t = useT();
  const { filled, tone, label: name } = LEVEL[level];
  const meter = (
    <span
      tabIndex={reason ? 0 : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
        reason && "cursor-help",
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", tone.split(" ")[0])}>{t(name)}</span>
      <span aria-hidden className="flex gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span key={i} className={cn("h-[3px] w-3 rounded-full", i < filled ? tone.split(" ")[1] : "bg-white/12")} />
        ))}
      </span>
    </span>
  );
  if (!reason) return meter;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{meter}</TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-sm text-[12.5px] leading-relaxed">
        {/* Plain text: the agent wraps code in backticks, which read fine as they are. */}
        {reason}
      </TooltipContent>
    </Tooltip>
  );
}

const BOX_W = 210;
const BOX_H = 56;
/** Wide enough for a link label between two boxes side by side. */
const GAP_X = 96;
const GAP_Y = 76;
const LINK = "color-mix(in srgb, var(--muted-foreground) 55%, transparent)";

type Box = { x: number; y: number };

/**
 * A link's path and where its label sits. Down a row: from the bottom of one box to the top of the other, elbowed
 * when they're in different columns. Up a row (a link pointing back): the same, upwards. Same row: side to side.
 */
function route(a: Box, b: Box) {
  if (a.y === b.y) {
    const [x1, x2] = b.x > a.x ? [a.x + BOX_W, b.x - 2] : [a.x, b.x + BOX_W + 2];
    const y = a.y + BOX_H / 2;
    return { d: `M${x1} ${y}H${x2}`, label: { x: (x1 + x2) / 2, y }, room: GAP_X - 12 };
  }
  const down = b.y > a.y;
  const [x1, y1] = [a.x + BOX_W / 2, down ? a.y + BOX_H : a.y];
  const [x2, y2] = [b.x + BOX_W / 2, down ? b.y - 2 : b.y + BOX_H + 2];
  const mid = (y1 + y2) / 2;
  if (x1 === x2) return { d: `M${x1} ${y1}V${y2}`, label: { x: x1, y: mid }, room: BOX_W };
  const r = Math.min(8, Math.abs(x2 - x1) / 2);
  const [dx, dy] = [Math.sign(x2 - x1), down ? 1 : -1];
  return {
    d: `M${x1} ${y1}V${mid - dy * r}Q${x1} ${mid} ${x1 + dx * r} ${mid}H${x2 - dx * r}Q${x2} ${mid} ${x2} ${mid + dy * r}V${y2}`,
    label: { x: (x1 + x2) / 2, y: mid },
    room: BOX_W,
  };
}

/** The steps as boxes, each link an arrow with its label sitting on the line: how the changes fit together. */
function Diagram({ tour, onPick }: { tour: Tour; onPick?: (step: number) => void }) {
  const places = layoutSteps(tour.steps.length, tour.links);
  const columns = Math.max(...places.map((p) => p.column)) + 1;
  const rows = Math.max(...places.map((p) => p.row)) + 1;
  const width = columns * BOX_W + (columns - 1) * GAP_X;
  const height = rows * BOX_H + (rows - 1) * GAP_Y;
  const box = (i: number): Box => ({
    x: places[i].column * (BOX_W + GAP_X),
    y: places[i].row * (BOX_H + GAP_Y),
  });
  const routes = tour.links.map((l) => ({ ...route(box(l.from), box(l.to)), text: l.label }));
  return (
    <div className="relative" style={{ width, height }}>
      <svg aria-hidden className="absolute inset-0 overflow-visible" width={width} height={height}>
        <defs>
          {/* Points along the line (orient="auto"): its tip on the line's end, at the box's edge. */}
          <marker id="tour-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
            <path d="M1 1.5 7 4 1 6.5Z" fill={LINK} />
          </marker>
        </defs>
        {routes.map((r, i) => (
          <path key={i} d={r.d} fill="none" stroke={LINK} strokeWidth={1.25} markerEnd="url(#tour-arrow)" />
        ))}
      </svg>
      {/* Labels in HTML, on a solid pill over the line: readable, never crossed by it. */}
      {routes.map(
        (r, i) =>
          r.text && (
            <span
              key={i}
              className="absolute -translate-x-1/2 -translate-y-1/2 truncate rounded-full border border-white/[0.08] bg-card px-2 py-0.5 text-[11px] leading-4 text-muted-foreground"
              style={{ left: r.label.x, top: r.label.y, maxWidth: r.room }}
              title={r.text}
            >
              {r.text}
            </span>
          ),
      )}
      {tour.steps.map((s, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onPick?.(i)}
          className="absolute flex items-center justify-center rounded-lg border border-white/[0.09] bg-card px-3 text-center text-[12.5px] leading-snug shadow-sm outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
          style={{ left: box(i).x, top: box(i).y, width: BOX_W, height: BOX_H }}
        >
          <span className="line-clamp-2">
            <span className="text-muted-foreground tabular-nums">{pad(i + 1)} · </span>
            {s.label}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The diagram full screen: drag to move it, − / + to zoom. */
function DiagramDialog({
  tour,
  open,
  onOpenChange,
}: {
  tour: Tour;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setOffset({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-[92vw] flex-col gap-0 p-0 sm:max-w-[92vw]">
        <DialogTitle className="border-b border-white/[0.06] px-5 py-3 text-[14px] font-medium">
          {t("tour.diagram")}
        </DialogTitle>
        <div
          className="relative min-h-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
          onPointerDown={(e) => {
            drag.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={move}
          onPointerUp={() => (drag.current = null)}
        >
          <div className="flex h-full items-center justify-center">
            <div style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}>
              <Diagram tour={tour} />
            </div>
          </div>
          <div className="absolute right-4 bottom-4 flex items-center gap-1 rounded-lg border border-white/10 bg-popover px-1 py-0.5 text-[12px]">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("tour.zoomOut")}
              onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}
            >
              <Minus />
            </Button>
            <span className="w-11 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("tour.zoomIn")}
              onClick={() => setZoom((z) => Math.min(2.5, z + 0.1))}
            >
              <Plus />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A snippet's lines from the pull request's diff, with both line numbers, like a review card. */
function SnippetCard({
  repoPath,
  pr,
  base,
  snippet,
  tourKey,
}: {
  repoPath: string;
  pr: ActivePullRequest;
  base: string;
  snippet: Snippet;
  tourKey: string;
}) {
  const t = useT();
  const reviewed = useTourStore((s) => !!s.reviewed[tourKey]?.[snippetKey(snippet)]);
  const toggle = useTourStore((s) => s.toggleReviewed);
  const diff = useQuery({
    queryKey: ["tour-diff", repoPath, pr.head, base, snippet.path],
    queryFn: () => gitBackend.getCommitDiff(repoPath, pr.head, snippet.path, null, base),
    staleTime: Infinity,
  });
  const lines: DiffLine[] = diff.data ? snippetLines(parseUnifiedDiff(diff.data.patch), snippet) : [];
  const add = lines.filter((l) => l.kind === "added").length;
  const del = lines.filter((l) => l.kind === "removed").length;
  const slash = snippet.path.lastIndexOf("/");
  return (
    <article
      id={`tour-snippet-${snippetKey(snippet)}`}
      className="overflow-hidden rounded-xl border border-white/[0.07] bg-card"
    >
      <header className="flex h-10 items-center gap-2 border-b border-white/[0.06] px-3 text-[12px]">
        <FileIcon path={snippet.path} className="size-3.5" />
        <span className="min-w-0 truncate text-muted-foreground">
          {snippet.path.slice(0, slash + 1)}
          <span className="text-foreground">{snippet.path.slice(slash + 1)}</span>
        </span>
        <LineCounts add={add} del={del} className="ml-auto" />
        <label className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
          <Checkbox checked={reviewed} onCheckedChange={() => toggle(tourKey, snippet)} />
          {t("tour.reviewed")}
        </label>
      </header>
      {diff.isPending ? (
        <div className="space-y-2 p-4">
          {[70, 90, 55, 80].map((w) => (
            <div key={w} className="h-2.5 animate-pulse rounded bg-white/[0.05]" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : lines.length === 0 ? (
        <p className="px-4 py-3 text-[12.5px] text-muted-foreground">{t("tour.snippetMissing")}</p>
      ) : (
        <pre className="max-h-96 overflow-auto py-1 font-mono text-[12px] leading-[1.6]">
          {lines.map((l, i) => (
            <div
              key={i}
              className={cn(
                "grid grid-cols-[3rem_3rem_1.25rem_1fr] pr-3",
                l.kind === "added" && "bg-diff-added",
                l.kind === "removed" && "bg-diff-removed",
              )}
            >
              <span className="pr-2 text-right text-muted-foreground/60 select-none">{l.oldLine ?? ""}</span>
              <span className="pr-2 text-right text-muted-foreground/60 select-none">{l.newLine ?? ""}</span>
              <span className="text-muted-foreground select-none">
                {l.kind === "added" ? "+" : l.kind === "removed" ? "−" : ""}
              </span>
              <span className="whitespace-pre-wrap">{l.content}</span>
            </div>
          ))}
        </pre>
      )}
    </article>
  );
}

const DETAIL = ["tour.brief", "tour.balanced", "tour.detailed"] as const;
const TECHNICAL = ["tour.plain", "tour.balanced", "tour.technical"] as const;
/** A grid position, 0 to 1 across and down, to the nearest cell: technical at the top. */
const cellAt = (x: number, y: number): Tone => ({
  detail: Math.min(2, Math.max(0, Math.floor(x * 3))),
  technical: 2 - Math.min(2, Math.max(0, Math.floor(y * 3))),
});

/**
 * Brief ↔ detailed across, plain ↔ technical down: a 3×3 grid to pick the tone of the next tour. Drag the dot (it
 * follows the pointer, then settles in the nearest cell), click a cell, or tab to one.
 */
function TonePicker({ tone, onApply }: { tone: Tone; onApply: (tone: Tone) => void }) {
  const t = useT();
  const [picked, setPicked] = useState(tone);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const point = { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
    setDrag(point);
    setPicked(cellAt(point.x, point.y));
  };
  // While dragged the dot is under the pointer; let go, it glides to its cell's centre.
  const dot = drag ?? { x: (picked.detail + 0.5) / 3, y: (2 - picked.technical + 0.5) / 3 };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("tour.tone")} className="text-muted-foreground">
          <Settings2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-4">
        <p className="text-[13px] font-medium">{t("tour.tone")}</p>
        <div
          className={cn(
            "relative mt-3 grid aspect-square touch-none grid-cols-3 overflow-hidden rounded-lg border border-white/[0.08] select-none",
            drag ? "cursor-grabbing" : "cursor-pointer",
          )}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            at(e);
          }}
          onPointerMove={(e) => drag && at(e)}
          onPointerUp={() => setDrag(null)}
          onPointerCancel={() => setDrag(null)}
        >
          {[2, 1, 0].flatMap((tech) =>
            [0, 1, 2].map((det) => (
              <button
                key={`${tech}-${det}`}
                type="button"
                aria-label={`${t(DETAIL[det])} · ${t(TECHNICAL[tech])}`}
                aria-pressed={picked.detail === det && picked.technical === tech}
                onKeyDown={(e) => e.key === " " && setPicked({ detail: det, technical: tech })}
                onFocus={() => setPicked({ detail: det, technical: tech })}
                className={cn(
                  "border-white/[0.06] outline-none not-last:border-r [&:nth-child(3n)]:border-r-0 [&:nth-child(-n+6)]:border-b hover:bg-white/[0.03] focus-visible:bg-white/[0.06]",
                  picked.detail === det && picked.technical === tech && "bg-white/[0.04]",
                )}
              />
            )),
          )}
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_0_4px] shadow-primary/25",
              drag
                ? "scale-110 cursor-grabbing shadow-primary/35"
                : "transition-[left,top,scale] duration-200 ease-out motion-reduce:transition-none",
            )}
            style={{ left: `${dot.x * 100}%`, top: `${dot.y * 100}%` }}
          />
          <span className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 text-[11px] text-muted-foreground">
            {t("tour.technical")}
          </span>
          <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] text-muted-foreground">
            {t("tour.plain")}
          </span>
          <span className="pointer-events-none absolute top-1/2 left-1 -translate-y-1/2 -rotate-90 text-[11px] text-muted-foreground">
            {t("tour.brief")}
          </span>
          <span className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 rotate-90 text-[11px] text-muted-foreground">
            {t("tour.detailed")}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="flex-1 text-[12.5px] text-muted-foreground">
            {t(DETAIL[picked.detail])} · {t(TECHNICAL[picked.technical])}
          </span>
          <Button size="sm" variant="outline" onClick={() => onApply(picked)}>
            {t("tour.apply")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A tour being written: what the agent is reading now, and that it goes on if you leave. */
function TourProgress({ runId }: { runId: string }) {
  const t = useT();
  const run = useAgentsStore((s) => s.runs.find((r) => r.id === runId));
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 pt-24 text-center">
      <BrailleLoader className="text-primary" />
      <p className="text-shimmer text-[14px] font-medium">{t("tour.writing")}</p>
      <p className="min-h-5 max-w-full truncate text-[12.5px] text-muted-foreground">
        {run?.steps.at(-1)?.title ?? t("common.loading")}
      </p>
      <p className="text-[12.5px] text-muted-foreground">{t("tour.background")}</p>
      <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => void gitBackend.cancelAgentRun(runId)}>
        <X aria-hidden className="size-3.5" />
        {t("common.cancel")}
      </Button>
    </div>
  );
}

function Shell({ toolbar, children }: { toolbar?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {toolbar && (
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/[0.06] px-4">{toolbar}</div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

/**
 * The pull request read as a story: overview and ratings, how the changes fit together, then each step with
 * its code, to tick off snippet by snippet. Written by the agent on demand, in the tone picked.
 */
export function PullRequestTour({ repoPath }: { repoPath: string }) {
  const t = useT();
  const pr = useWorkspaceStore((s) => s.pullRequest);
  const key = pr ? tourKeyOf(repoPath, pr.number) : "";
  const state = useTourStore((s) => s.tours[key]);
  const reviewed = useTourStore((s) => Object.keys(s.reviewed[key] ?? {}).length);
  const installed = useInstalledAgents().data;
  const preferred = useAgentsStore((s) => s.preferredAgent);
  const agent = pickAgent(installed, preferred);
  const [zoomed, setZoomed] = useState(false);
  if (!pr?.base) return null;
  const base = pr.base;
  const start = (tone: Tone) => agent && void generateTour(repoPath, pr, base, agent, tone);
  const tone = state?.status === "ready" ? state.tone : { detail: 1, technical: 1 };

  if (!state || state.status === "failed")
    return (
      <Shell>
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 pt-24 text-center">
          <Sparkles aria-hidden className="size-6 text-primary" />
          <h2 className="text-[15px] font-medium">{t("tour.title")}</h2>
          <p className="text-[13px] text-muted-foreground">
            {state?.status === "failed" ? state.error : t("tour.hint")}
          </p>
          <Button disabled={!agent} onClick={() => start(tone)} className="mt-2 gap-1.5">
            <Sparkles aria-hidden className="size-3.5" />
            {state ? t("tour.retry") : t("tour.generate")}
          </Button>
          {!agent && <p className="text-[12px] text-muted-foreground">{t("tour.noAgent")}</p>}
        </div>
      </Shell>
    );
  if (state.status === "running")
    return (
      <Shell>
        <TourProgress runId={state.runId} />
      </Shell>
    );

  const { tour } = state;
  const snippets = tour.steps.flatMap((s) => s.snippets);
  const reveal = (i: number) => document.getElementById(stepId(i))?.scrollIntoView({ behavior: "smooth" });
  return (
    <Shell
      toolbar={
        <>
          {state.head !== pr.head && <span className="text-[12px] text-amber-400">{t("tour.outdated")}</span>}
          <span className="ml-auto flex items-center gap-2 text-[12.5px] text-muted-foreground tabular-nums">
            <span
              aria-hidden
              className="size-3.5 rounded-full border-2 border-white/15"
              style={{
                background: `conic-gradient(var(--primary) ${(reviewed / Math.max(1, snippets.length)) * 360}deg, transparent 0)`,
              }}
            />
            {t("tour.snippets", { done: reviewed, total: snippets.length })}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("tour.refresh")}
            onClick={() => start(tone)}
            className="text-muted-foreground"
          >
            <RefreshCw />
          </Button>
          <TonePicker tone={tone} onApply={start} />
        </>
      }
    >
      <div className="mx-auto max-w-[1280px] px-8 pt-6 pb-16">
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <Meter label={t("tour.risk")} level={tour.risk} reason={tour.reasons?.risk ?? ""} />
          <Meter label={t("tour.impact")} level={tour.impact} reason={tour.reasons?.impact ?? ""} />
          <Meter label={t("tour.attention")} level={tour.attention} reason={tour.reasons?.attention ?? ""} />
        </div>
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <section>
            <h2 className="text-[14px] font-medium">{t("tour.overview")}</h2>
            <div className="mt-2 text-[14px] leading-relaxed">
              <Markdown text={tour.overview} />
            </div>
            <ol className="mt-4 flex flex-col gap-1">
              {tour.steps.map((s, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => reveal(i)}
                    className="flex w-full items-center gap-3 rounded-md px-1 py-1.5 text-left text-[13.5px] outline-none hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="rounded-md border border-white/[0.08] px-1.5 py-px text-[11.5px] text-muted-foreground tabular-nums">
                      {pad(i + 1)}
                    </span>
                    {s.label}
                  </button>
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h2 className="text-[14px] font-medium">{t("tour.fit")}</h2>
            <div className="group relative mt-2 overflow-auto rounded-xl border border-white/[0.07] bg-white/[0.015] p-6">
              <button
                type="button"
                aria-label={t("tour.expand")}
                onClick={() => setZoomed(true)}
                className="absolute top-2 right-2 grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-white/[0.06] focus-visible:opacity-100"
              >
                <Maximize2 className="size-3.5" />
              </button>
              <div className="flex justify-center">
                <Diagram tour={tour} onPick={reveal} />
              </div>
            </div>
          </section>
        </div>
        {tour.steps.map((s, i) => (
          <section
            key={i}
            id={stepId(i)}
            className="mt-10 grid scroll-mt-4 gap-8 border-t border-white/[0.06] pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
          >
            <div>
              <p className="text-[12px] text-muted-foreground tabular-nums">
                {pad(i + 1)} / {pad(tour.steps.length)}
              </p>
              <h3 className="mt-1.5 text-[16px] leading-snug font-medium">{s.title}</h3>
              <div className="mt-3 text-[14px] leading-relaxed">
                <Markdown text={s.explanation} />
              </div>
              <ul className="mt-4 flex flex-col gap-1">
                {s.snippets.map((snip) => (
                  <li key={snippetKey(snip)}>
                    <button
                      type="button"
                      onClick={() =>
                        document
                          .getElementById(`tour-snippet-${snippetKey(snip)}`)
                          ?.scrollIntoView({ behavior: "smooth", block: "center" })
                      }
                      className="flex w-full items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-1.5 text-left font-mono text-[12px] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                    >
                      <FileIcon path={snip.path} className="size-3.5" />
                      <span className="min-w-0 truncate">
                        {snip.path}:{snip.start}-{snip.end}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-4">
              {s.snippets.map((snip) => (
                <SnippetCard
                  key={snippetKey(snip)}
                  repoPath={repoPath}
                  pr={pr}
                  base={base}
                  snippet={snip}
                  tourKey={key}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      <DiagramDialog tour={tour} open={zoomed} onOpenChange={setZoomed} />
    </Shell>
  );
}
