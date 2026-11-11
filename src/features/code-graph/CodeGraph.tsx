import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { Flame, GitCompareArrows, Network, RefreshCw, ShieldAlert, TriangleAlert } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { PanelHeader, PanelLoading } from "@/components/layout/panel";
import { DataUnavailable, EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { useBaseComparison } from "@/features/working-tree/CreatePullRequest";
import { useT, type MessageKey } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { formatAge } from "@/lib/format-date";
import { useCommits } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useCodeGraphStore, type GraphSection, type ImpactBase } from "@/stores/code-graph-store";
import { useNoticesStore } from "@/stores/notices-store";
import type { CodeImpact } from "@/types/git";
import { areaOf, layoutGraph } from "./layout";

const statusKey = (repoPath: string) => ["code-graph", repoPath, "status"];

function useGraphStatus(repoPath: string) {
  return useQuery({ queryKey: statusKey(repoPath), queryFn: () => gitBackend.codeGraphStatus(repoPath) });
}

function useUpdateGraph(repoPath: string) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  return useMutation({
    mutationFn: () => gitBackend.codeGraphUpdate(repoPath),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["code-graph", repoPath] }),
    onError: (error) => notify({ tone: "error", title: t("graph.updateFailed"), detail: toGitError(error).message }),
  });
}

const SECTIONS: { id: GraphSection; label: MessageKey; hint: MessageKey; Icon: typeof Flame }[] = [
  { id: "impact", label: "graph.impact", hint: "graph.impactHint", Icon: GitCompareArrows },
  { id: "hotspots", label: "graph.hotspots", hint: "graph.hotspotsHint", Icon: Flame },
  { id: "map", label: "graph.map", hint: "graph.mapHint", Icon: Network },
];

/** List column of the Code graph view: what to look at, and how fresh the graph is. */
export function CodeGraphList({ repoPath }: { repoPath: string }) {
  const t = useT();
  const { section, set } = useCodeGraphStore(useShallow((s) => ({ section: s.section, set: s.set })));
  const status = useGraphStatus(repoPath).data;
  const head = useCommits(repoPath, null).data?.pages[0]?.[0]?.hash;
  const update = useUpdateGraph(repoPath);
  const stale = !!status?.commit && !!head && status.commit !== head;
  return (
    <nav aria-label={t("view.graph")} className="flex min-h-0 flex-1 flex-col px-2 pt-3 pb-2">
      <ul className="space-y-px">
        {SECTIONS.map(({ id, label, hint, Icon }) => (
          <li key={id}>
            <button
              type="button"
              aria-current={section === id ? "page" : undefined}
              onClick={() => set({ section: id })}
              className={cn(
                "grid w-full grid-cols-[16px_1fr] items-center gap-x-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring",
                section === id && "bg-white/[0.08]",
              )}
            >
              <Icon aria-hidden className="size-3.5 text-muted-foreground" />
              <span className="text-[13px]">{t(label)}</span>
              <span className="col-start-2 truncate text-[11.5px] text-muted-foreground">{t(hint)}</span>
            </button>
          </li>
        ))}
      </ul>
      {status?.built && (
        <div className="mt-auto rounded-lg border border-white/[0.07] bg-card p-3 text-[12px]">
          <p className="flex items-center gap-1.5 font-medium">
            <span className={cn("size-1.5 rounded-full", stale ? "bg-renamed" : "bg-added-foreground")} />
            {stale ? t("graph.stale") : t("graph.upToDate")}
          </p>
          <p className="mt-1 text-muted-foreground tabular-nums">
            {t("graph.counts", { files: status.files, nodes: status.nodes, edges: status.edges })}
          </p>
          {status.lastUpdated && (
            <p className="text-muted-foreground">
              {t("graph.updated", { age: formatAge(status.lastUpdated, undefined, t.locale) })}
              {status.commit && <span className="font-mono"> · {status.commit.slice(0, 7)}</span>}
            </p>
          )}
          <Button
            size="xs"
            variant={stale ? "default" : "outline"}
            disabled={update.isPending}
            onClick={() => update.mutate()}
            className="mt-2 w-full gap-1.5"
          >
            {update.isPending ? <BrailleLoader /> : <RefreshCw aria-hidden />}
            {t("graph.update")}
          </Button>
        </div>
      )}
    </nav>
  );
}

function Risk({ value }: { value: number }) {
  const tone = value >= 0.7 ? "bg-removed-foreground" : value >= 0.4 ? "bg-renamed" : "bg-added-foreground";
  return (
    <span className="flex items-center gap-1.5 tabular-nums">
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-white/10">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      {value.toFixed(2)}
    </span>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-white/[0.07] bg-card">
      <h3 className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5 text-[12.5px] font-medium">
        {title}
        {count !== undefined && <span className="font-normal text-muted-foreground">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function SymbolRows({ rows, empty }: { rows: CodeImpact["changed_functions"]; empty: string }) {
  if (rows.length === 0) return <p className="px-4 py-3 text-[12.5px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="max-h-80 overflow-y-auto py-1">
      {rows.map((r, i) => (
        <li key={`${r.name}:${i}`} className="flex items-center gap-3 px-4 py-1 text-[12.5px]">
          <span className="w-16 shrink-0 text-[11px] text-muted-foreground">{r.kind}</span>
          <span className="min-w-0 shrink-0 font-mono">{r.name}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {r.file_path ?? r.file}:{r.line_start}
          </span>
          {r.risk_score !== undefined && <Risk value={r.risk_score} />}
        </li>
      ))}
    </ul>
  );
}

const BASES: { id: ImpactBase; label: MessageKey }[] = [
  { id: "worktree", label: "graph.base.worktree" },
  { id: "last-commit", label: "graph.base.lastCommit" },
  { id: "branch", label: "graph.base.branch" },
];

function ImpactView({ repoPath }: { repoPath: string }) {
  const t = useT();
  const { base, set } = useCodeGraphStore(useShallow((s) => ({ base: s.base, set: s.set })));
  const branchBase = useBaseComparison(repoPath).data?.base;
  const revision = base === "worktree" ? "HEAD" : base === "last-commit" ? "HEAD~1" : (branchBase ?? "HEAD~1");
  const impact = useQuery({
    queryKey: ["code-graph", repoPath, "impact", revision],
    queryFn: () => gitBackend.codeGraphImpact(repoPath, revision),
    staleTime: 30_000,
  });
  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label={t("graph.base")} className="flex w-fit rounded-md bg-white/[0.05] p-0.5">
        {BASES.map((b) => (
          <button
            key={b.id}
            type="button"
            role="radio"
            aria-checked={base === b.id}
            onClick={() => set({ base: b.id })}
            className={cn(
              "h-6 rounded-[5px] px-2.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
              base === b.id
                ? "bg-white/[0.12] text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {b.id === "branch" && branchBase ? t("graph.base.vs", { base: branchBase }) : t(b.label)}
          </button>
        ))}
      </div>
      {impact.isError ? (
        <DataUnavailable title={t("graph.impactError")} error={impact.error} onRetry={() => void impact.refetch()} />
      ) : !impact.data ? (
        <PanelLoading title={t("graph.analyzing")} variant="grid-wave" />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label={t("graph.risk")} value={impact.data.risk_score.toFixed(2)} tone={impact.data.risk_score} />
            <Stat label={t("graph.changed")} value={String(impact.data.changed_functions.length)} />
            <Stat label={t("graph.testGaps")} value={String(impact.data.test_gaps.length)} />
          </div>
          <Section title={t("graph.reviewFirst")} count={impact.data.review_priorities.length}>
            <SymbolRows rows={impact.data.review_priorities} empty={t("graph.nothing")} />
          </Section>
          <Section title={t("graph.testGaps")} count={impact.data.test_gaps.length}>
            <SymbolRows rows={impact.data.test_gaps} empty={t("graph.nothing")} />
          </Section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-card px-3.5 py-3">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-[22px] font-semibold tabular-nums",
          tone !== undefined && (tone >= 0.7 ? "text-removed-foreground" : tone >= 0.4 ? "text-renamed" : ""),
        )}
      >
        {value}
      </p>
    </div>
  );
}

function HotspotsView({ repoPath }: { repoPath: string }) {
  const t = useT();
  const hotspots = useQuery({
    queryKey: ["code-graph", repoPath, "hotspots"],
    queryFn: () => gitBackend.codeGraphHotspots(repoPath),
  });
  if (hotspots.isError)
    return (
      <DataUnavailable title={t("graph.loadError")} error={hotspots.error} onRetry={() => void hotspots.refetch()} />
    );
  if (!hotspots.data) return <PanelLoading title={t("common.loading")} variant="grid-wave" />;
  return (
    <Section title={t("graph.hotspots")} count={hotspots.data.length}>
      <table className="w-full text-[12.5px]">
        <thead className="text-muted-foreground">
          <tr>
            <th className="px-4 py-2 text-left font-normal">{t("graph.symbol")}</th>
            <th className="px-2 py-2 text-left font-normal">{t("graph.file")}</th>
            <th className="px-2 py-2 text-right font-normal">{t("graph.callers")}</th>
            <th className="px-2 py-2 text-left font-normal">{t("graph.tests")}</th>
            <th className="px-4 py-2 text-left font-normal">{t("graph.risk")}</th>
          </tr>
        </thead>
        <tbody>
          {hotspots.data.map((h, i) => (
            <tr key={`${h.file}:${h.name}:${i}`} className="border-t border-white/[0.05]">
              <td className="px-4 py-1.5 font-mono">
                <span className="flex items-center gap-1.5">
                  {h.security ? (
                    <ShieldAlert aria-label={t("graph.security")} className="size-3.5 shrink-0 text-renamed" />
                  ) : null}
                  {h.name}
                </span>
              </td>
              <td className="max-w-0 truncate px-2 py-1.5 text-muted-foreground" title={`${h.file}:${h.line}`}>
                {h.file}:{h.line}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{h.callers}</td>
              <td className="px-2 py-1.5">
                <span className={cn(h.coverage === "untested" ? "text-removed-foreground" : "text-added-foreground")}>
                  {h.coverage === "untested" ? t("graph.untested") : t("graph.tested")}
                </span>
              </td>
              <td className="px-4 py-1.5">
                <Risk value={h.risk} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

// Categorical hues, fixed order (dark surface); areas beyond them share the neutral "other".
const PALETTE = ["#7c83f5", "#4cb782", "#e8b44a", "#e5737f", "#4fb3d9", "#c084fc", "#f2994a", "#9ab55a"];
const OTHER = "#6b6f78";
const MAX_FILES = 110;

const W = 1000;
const H = 640;
const LABELLED = 14;
const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Wheel zooms around the cursor, dragging the background pans, double-click resets. */
function usePanZoom() {
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const toLocal = (svg: SVGSVGElement, clientX: number, clientY: number) => {
    const box = svg.getBoundingClientRect();
    return { x: ((clientX - box.left) / box.width) * W, y: ((clientY - box.top) / box.height) * H };
  };
  // Native, non-passive listener: zooming must not also scroll the page.
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toLocal(el, e.clientX, e.clientY);
      setView((v) => {
        const k = Math.min(6, Math.max(0.6, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: p.x - ((p.x - v.x) * k) / v.k, y: p.y - ((p.y - v.y) * k) / v.k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });
  return {
    view,
    svg,
    handlers: {
      onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
        if ((e.target as Element).tagName !== "svg" && (e.target as Element).tagName !== "rect") return;
        drag.current = toLocal(e.currentTarget, e.clientX, e.clientY);
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
        if (!drag.current) return;
        const p = toLocal(e.currentTarget, e.clientX, e.clientY);
        const from = drag.current;
        drag.current = p;
        setView((v) => ({ ...v, x: v.x + p.x - from.x, y: v.y + p.y - from.y }));
      },
      onPointerUp: () => {
        drag.current = null;
      },
      onDoubleClick: () => setView({ k: 1, x: 0, y: 0 }),
    },
  };
}

function MapView({ repoPath }: { repoPath: string }) {
  const t = useT();
  const { hideTests, set } = useCodeGraphStore(useShallow((s) => ({ hideTests: s.hideTests, set: s.set })));
  const map = useQuery({ queryKey: ["code-graph", repoPath, "map"], queryFn: () => gitBackend.codeGraphMap(repoPath) });
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const { view, svg, handlers } = usePanZoom();
  const graph = useMemo(() => {
    if (!map.data) return null;
    const files = map.data.files.filter((f) => !(hideTests && f.test));
    const keep = new Set(files.map((f) => f.path));
    const links = map.data.links.filter((l) => keep.has(l.source) && keep.has(l.target));
    const degree = new Map<string, number>();
    for (const l of links) {
      degree.set(l.source, (degree.get(l.source) ?? 0) + l.weight);
      degree.set(l.target, (degree.get(l.target) ?? 0) + l.weight);
    }
    // The most connected files: the map's skeleton.
    const top = files
      .filter((f) => degree.has(f.path))
      .sort((a, b) => (degree.get(b.path) ?? 0) - (degree.get(a.path) ?? 0))
      .slice(0, MAX_FILES);
    const shown = new Set(top.map((f) => f.path));
    const shownLinks = links.filter((l) => shown.has(l.source) && shown.has(l.target));
    const areaSize = new Map<string, number>();
    for (const f of top) areaSize.set(areaOf(f.path), (areaSize.get(areaOf(f.path)) ?? 0) + 1);
    const areas = [...areaSize.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
    const color = (area: string) => PALETTE[areas.indexOf(area)] ?? OTHER;
    // Areas past the palette share one island too, rather than scattering.
    const groupOf = (path: string) => (areas.indexOf(areaOf(path)) < PALETTE.length ? areaOf(path) : "other");
    const placed = layoutGraph(
      top.map((f) => ({ id: f.path, group: groupOf(f.path), size: f.symbols })),
      shownLinks,
      W,
      H,
    );
    const labelled = new Set(top.slice(0, LABELLED).map((f) => f.path));
    return { placed, links: shownLinks, color, areas, labelled };
  }, [map.data, hideTests]);
  if (map.isError)
    return <DataUnavailable title={t("graph.loadError")} error={map.error} onRetry={() => void map.refetch()} />;
  if (!graph) return <PanelLoading title={t("graph.layingOut")} variant="grid-orbit" />;
  const at = new Map(graph.placed.map((p) => [p.id, p]));
  const focus = hover ?? pinned;
  const outgoing = focus ? graph.links.filter((l) => l.source === focus) : [];
  const incoming = focus ? graph.links.filter((l) => l.target === focus) : [];
  const neighbours = new Set([...outgoing.map((l) => l.target), ...incoming.map((l) => l.source)]);
  const focused = focus ? at.get(focus) : null;
  const fill = (p: { id: string; group: string }) => (p.group === "other" ? OTHER : graph.color(areaOf(p.id)));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-muted-foreground">
        {graph.areas.slice(0, PALETTE.length).map((a) => (
          <span key={a} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: graph.color(a) }} />
            {a}
          </span>
        ))}
        {graph.areas.length > PALETTE.length && (
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: OTHER }} />
            {t("graph.other")}
          </span>
        )}
        <label className="ml-auto flex items-center gap-1.5">
          <input type="checkbox" checked={hideTests} onChange={(e) => set({ hideTests: e.target.checked })} />
          {t("graph.hideTests")}
        </label>
      </div>
      <figure className="relative overflow-hidden rounded-lg border border-white/[0.07] bg-card">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full cursor-grab touch-none select-none active:cursor-grabbing"
          onMouseLeave={() => setHover(null)}
          {...handlers}
        >
          <rect width={W} height={H} fill="transparent" onClick={() => setPinned(null)} />
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {graph.links.map((l) => {
              const a = at.get(l.source);
              const b = at.get(l.target);
              if (!a || !b) return null;
              const lit = focus && (l.source === focus || l.target === focus);
              if (focus && !lit) return null;
              return (
                <line
                  key={`${l.source}>${l.target}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  strokeWidth={(lit ? 1.4 : 0.8) / view.k}
                  style={{
                    stroke: lit
                      ? l.source === focus
                        ? "var(--color-primary)"
                        : "var(--color-renamed)"
                      : "color-mix(in oklab, var(--color-white) 4.5%, transparent)",
                  }}
                />
              );
            })}
            {graph.placed.map((p) => {
              const dim = focus && p.id !== focus && !neighbours.has(p.id);
              const label = p.id === focus || neighbours.has(p.id) || (!focus && graph.labelled.has(p.id));
              return (
                <g
                  key={p.id}
                  transform={`translate(${p.x} ${p.y})`}
                  opacity={dim ? 0.15 : 1}
                  onMouseEnter={() => setHover(p.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setPinned(p.id === pinned ? null : p.id)}
                  className="cursor-pointer transition-opacity"
                >
                  <circle
                    r={p.r / Math.sqrt(view.k)}
                    fill={fill(p)}
                    stroke={p.id === pinned ? "var(--color-foreground)" : "var(--color-card)"}
                    strokeWidth={(p.id === pinned ? 2 : 1.5) / view.k}
                  />
                  {label && (
                    <text
                      y={-(p.r / Math.sqrt(view.k)) - 4 / view.k}
                      textAnchor="middle"
                      fontSize={11 / view.k}
                      className="pointer-events-none fill-foreground"
                      style={{ paintOrder: "stroke", stroke: "var(--color-card)", strokeWidth: 3 / view.k }}
                    >
                      {basename(p.id)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        {focused && (
          <figcaption className="pointer-events-none absolute top-3 left-3 w-72 rounded-md border border-white/10 bg-popover px-3 py-2 text-[12px] shadow-lg">
            <p className="truncate font-mono" title={focused.id}>
              {focused.id}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {t("graph.fileLinks", { symbols: focused.size, uses: outgoing.length, usedBy: incoming.length })}
            </p>
            <p className="mt-1.5 flex gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-3 rounded bg-primary" />
                {t("graph.uses")}
              </span>
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-3 rounded bg-renamed" />
                {t("graph.usedBy")}
              </span>
            </p>
          </figcaption>
        )}
      </figure>
      <p className="text-[11.5px] text-muted-foreground">{t("graph.mapNote", { count: graph.placed.length })}</p>
    </div>
  );
}

/** Main panel of the Code graph view. */
export function CodeGraphPage({ repoPath }: { repoPath: string }) {
  const t = useT();
  const section = useCodeGraphStore((s) => s.section);
  const status = useGraphStatus(repoPath);
  const update = useUpdateGraph(repoPath);
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const header = (
    <PanelHeader className="gap-2">
      <current.Icon aria-hidden className="size-3.5 text-primary" />
      <h2 className="text-[13px] font-semibold">{t(current.label)}</h2>
      <span className="truncate text-[12px] text-muted-foreground">{t(current.hint)}</span>
    </PanelHeader>
  );
  if (status.isError)
    return <DataUnavailable title={t("graph.loadError")} error={status.error} onRetry={() => void status.refetch()} />;
  if (!status.data) return <PanelLoading title={t("common.loading")} />;
  if (!status.data.built)
    return (
      <EmptyState
        icon={<Network />}
        title={t("graph.notBuilt")}
        hint={status.data.cli ? t("graph.notBuiltHint") : t("graph.noCli")}
        action={
          status.data.cli && (
            <Button onClick={() => update.mutate()} disabled={update.isPending} className="gap-1.5">
              {update.isPending ? <BrailleLoader /> : <Network aria-hidden className="size-4" />}
              {t("graph.build")}
            </Button>
          )
        }
      />
    );
  return (
    <section aria-label={t("view.graph")} className="flex h-full flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-10">
        <div className="mx-auto max-w-[1000px]">
          {!status.data.cli && (
            <p className="mb-3 flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <TriangleAlert aria-hidden className="size-3.5 text-renamed" />
              {t("graph.noCli")}
            </p>
          )}
          {section === "impact" ? (
            <ImpactView repoPath={repoPath} />
          ) : section === "hotspots" ? (
            <HotspotsView repoPath={repoPath} />
          ) : (
            <MapView repoPath={repoPath} />
          )}
        </div>
      </div>
    </section>
  );
}
