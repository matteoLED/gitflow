import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarList, Donut, StatCard, useChartTip } from "@/components/charts";
import { PanelLoading } from "@/components/layout/panel";
import { DataUnavailable } from "@/components/states";
import { useT } from "@/i18n";
import { gitBackend } from "@/lib/tauri-git";
import { useCodeGraphStore } from "@/stores/code-graph-store";
import type { CodeGraphStatus } from "@/types/git";

const SLICES = ["var(--primary)", "#c77dbb", "#5fb3a8", "#f29b45", "#6f9fd8"];
const OTHER = "#6b6d75";
const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const short = (path: string) => path.split("/").slice(-2).join("/");
/** Low to high: calm teal through amber to red, the order a reader expects of risk. */
const RISK = ["#5fb3a8", "#8fb87a", "#d9b65c", "#f29b45", "#e5534b"];
const LANGUAGES: Record<string, string> = {
  typescript: "TypeScript",
  tsx: "TSX",
  javascript: "JavaScript",
  jsx: "JSX",
  python: "Python",
  rust: "Rust",
  dart: "Dart",
  go: "Go",
  java: "Java",
  kotlin: "Kotlin",
  swift: "Swift",
  ruby: "Ruby",
  php: "PHP",
  csharp: "C#",
  cpp: "C++",
  c: "C",
};
const language = (name: string) => LANGUAGES[name.toLowerCase()] ?? name;

/** A file's area: its first two folders ("apps/platform", "packages/iris"), where most monorepos split. */
const areaOf = (path: string) => path.split("/").slice(0, 2).join("/") || path;

/** The first `top` counts named, the rest folded into one gray "Other" slice. */
function slices(rows: { name: string; count: number }[], top: number, other: string) {
  const head = rows.slice(0, top).map((r, i) => ({
    key: r.name,
    label: language(r.name),
    value: r.count,
    display: r.count.toLocaleString(),
    color: SLICES[i],
  }));
  const rest = rows.slice(top).reduce((sum, r) => sum + r.count, 0);
  return rest
    ? [...head, { key: "other", label: other, value: rest, display: rest.toLocaleString(), color: OTHER }]
    : head;
}

/**
 * The code graph at a glance: how big the codebase is, how much of it is tested, where the risk sits, and which
 * code everything leans on. Each card leads to the page that goes deeper.
 */
export function GraphOverview({ repoPath, status }: { repoPath: string; status: CodeGraphStatus }) {
  const t = useT();
  const go = useCodeGraphStore((s) => s.set);
  const overview = useQuery({
    queryKey: ["code-graph", repoPath, "overview", status.commit],
    queryFn: () => gitBackend.codeGraphOverview(repoPath),
    staleTime: Infinity,
  });
  const map = useQuery({
    queryKey: ["code-graph", repoPath, "map"],
    queryFn: () => gitBackend.codeGraphMap(repoPath),
    staleTime: Infinity,
  });
  if (overview.isError)
    return (
      <DataUnavailable title={t("graph.loadError")} error={overview.error} onRetry={() => void overview.refetch()} />
    );
  if (!overview.data) return <PanelLoading title={t("common.loading")} />;
  const data = overview.data;

  const count = (rows: { name: string; count: number }[], ...names: string[]) =>
    rows.filter((r) => names.includes(r.name)).reduce((sum, r) => sum + r.count, 0);
  const symbols = count(data.kinds, "Function", "Class");
  const tests = count(data.kinds, "Test");
  const tested = count(data.coverage, "tested");
  const covered = tested + count(data.coverage, "untested");
  const coverage = covered ? Math.round((tested / covered) * 100) : null;
  const bands = Array.from({ length: 5 }, (_, i) => data.risk.find((r) => r.band === i)?.count ?? 0);
  const risky = bands[3] + bands[4];
  const bandLabel = (i: number) => `${(i * 0.2).toFixed(1)} – ${((i + 1) * 0.2).toFixed(1)}`;

  const areas = new Map<string, number>();
  for (const f of map.data?.files ?? []) if (!f.test) areas.set(areaOf(f.path), (areas.get(areaOf(f.path)) ?? 0) + 1);
  const topAreas = [...areas].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxCalls = data.mostCalled[0]?.callers ?? 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title={t("graph.kpiFiles")}
          value={compact(status.files)}
          hint={t("graph.kpiFilesHint", { tests: compact(tests) })}
        />
        <StatCard
          title={t("graph.kpiSymbols")}
          value={compact(symbols)}
          hint={t("graph.kpiLinks", { count: compact(status.edges) })}
        />
        <StatCard
          title={t("graph.kpiCoverage")}
          value={coverage === null ? null : `${coverage}%`}
          hint={t("graph.kpiCoverageHint", { tested: compact(tested), total: compact(covered) })}
          onClick={() => go({ section: "hotspots" })}
        />
        <StatCard
          title={t("graph.kpiRisky")}
          value={compact(risky)}
          hint={t("graph.kpiRiskyHint")}
          onClick={() => go({ section: "hotspots" })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <StatCard title={t("graph.languages")} hint={t("graph.languagesHint")}>
          <Donut
            slices={slices(data.languages, 4, t("usage.other"))}
            center={{ value: compact(status.files), label: t("graph.files") }}
          />
        </StatCard>
        <StatCard title={t("graph.riskSpread")} hint={t("graph.riskSpreadHint")}>
          <RiskSpread bands={bands} label={(i) => t("graph.riskBand", { band: bandLabel(i) })} />
        </StatCard>

        <StatCard title={t("graph.mostCalled")} hint={t("graph.mostCalledHint")}>
          <BarList
            items={data.mostCalled.map((s) => ({
              key: `${s.file}:${s.line}`,
              label: (
                <span>
                  <span className="font-mono">{s.name}</span>{" "}
                  <span className="text-muted-foreground">{short(s.file)}</span>
                </span>
              ),
              value: s.callers,
              display: s.callers,
              tip: {
                label: `${s.file}:${s.line}`,
                value: t("graph.callerCount", { count: s.callers }),
                detail: `${Math.round((s.callers / maxCalls) * 100)}%`,
              },
            }))}
          />
        </StatCard>
        <StatCard title={t("graph.largestFiles")} hint={t("graph.largestFilesHint")}>
          <BarList
            items={data.largestFiles.map((f) => ({
              key: f.file,
              label: <span className="font-mono">{short(f.file)}</span>,
              value: f.symbols,
              display: f.symbols,
              tip: { label: f.file, value: t("graph.symbolCount", { count: f.symbols }) },
            }))}
          />
        </StatCard>

        <StatCard title={t("graph.areas")} hint={t("graph.areasHint")} onClick={() => go({ section: "map" })}>
          <BarList
            items={topAreas.map(([name, files]) => ({
              key: name,
              label: <span className="font-mono">{name}</span>,
              value: files,
              display: files,
              tip: { label: name, value: t("graph.fileCount", { count: files }) },
            }))}
          />
        </StatCard>
        <StatCard title={t("graph.linkKinds")} hint={t("graph.linkKindsHint")}>
          <Donut
            slices={slices(data.links, 4, t("usage.other"))}
            center={{ value: compact(status.edges), label: t("graph.links") }}
          />
        </StatCard>
      </div>
    </div>
  );
}

/**
 * Every symbol on one bar, split by risk band low to high, with each band's count and share below: how much of
 * the code is safe to touch reads at a glance, where five bars mostly near zero did not.
 */
function RiskSpread({ bands, label }: { bands: number[]; label: (band: number) => string }) {
  const frame = useRef<HTMLDivElement>(null);
  const tooltip = useChartTip(frame);
  const total = bands.reduce((sum, n) => sum + n, 0) || 1;
  const share = (n: number) => {
    const p = Math.round((n / total) * 100);
    return p === 0 && n > 0 ? "<1%" : `${p}%`;
  };
  return (
    <div ref={frame}>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" onMouseLeave={tooltip.hide}>
        {bands.map((n, i) =>
          n ? (
            <span
              key={i}
              className="h-full min-w-1 transition-opacity hover:opacity-80"
              style={{ flexGrow: n, background: RISK[i] }}
              onMouseEnter={(e) =>
                tooltip.over(e.currentTarget, { label: label(i), value: n.toLocaleString(), detail: share(n) })
              }
            />
          ) : null,
        )}
      </div>
      <ul className="mt-4 grid gap-1.5 text-[12.5px]">
        {bands.map((n, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-full" style={{ background: RISK[i] }} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{label(i)}</span>
            <span className="font-medium tabular-nums">{compact(n)}</span>
            <span className="w-9 text-right text-muted-foreground tabular-nums">{share(n)}</span>
          </li>
        ))}
      </ul>
      {tooltip.node}
    </div>
  );
}
