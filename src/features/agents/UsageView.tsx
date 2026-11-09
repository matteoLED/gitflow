import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, TriangleAlert } from "lucide-react";
import { DataUnavailable } from "@/components/states";
import { PanelHeader, PanelLoading } from "@/components/layout/panel";
import { useT } from "@/i18n";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { compact } from "./ContextMeter";
import { totalTokens } from "./pricing";
import { summarize, type Bucket } from "./usage-stats";

const PERIODS = [7, 30, 90] as const;
const usd = (n: number) => (n >= 100 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`);
const shortDay = (day: string, locale: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md bg-white/[0.05] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-6 rounded-[5px] px-2.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === o.value
              ? "bg-white/[0.12] text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-card px-3.5 py-3">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** One bar per day; hover a column for its numbers. */
function DailyChart({ days }: { days: Bucket[] }) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.cost), 0.01);
  const shown = hover === null ? null : days[hover];
  const ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1];
  return (
    <figure className="rounded-lg border border-white/[0.07] bg-card px-4 pt-3 pb-2.5">
      <figcaption className="flex items-baseline gap-2 text-[12.5px]">
        <span className="font-medium">{t("usage.daily")}</span>
        <span className="ml-auto text-muted-foreground tabular-nums">
          {shown
            ? `${shortDay(shown.key, t.locale)} · ${usd(shown.cost)} · ${compact(totalTokens(shown.tokens))} tokens · ${t.plural("usage.sessionsCount", shown.sessions)}`
            : `max ${usd(max)}`}
        </span>
      </figcaption>
      <div className="relative mt-3 h-40" onMouseLeave={() => setHover(null)}>
        <div aria-hidden className="absolute inset-x-0 top-0 border-t border-dashed border-white/[0.07]" />
        <div aria-hidden className="absolute inset-x-0 top-1/2 border-t border-dashed border-white/[0.07]" />
        <div className="absolute inset-0 flex items-end gap-[2px] border-b border-white/[0.12]">
          {days.map((d, i) => (
            <div
              key={d.key}
              onMouseEnter={() => setHover(i)}
              className="flex h-full flex-1 items-end"
              aria-label={`${d.key}: ${usd(d.cost)}`}
            >
              <div
                className={cn(
                  "w-full rounded-t-[3px] bg-primary transition-opacity",
                  hover !== null && hover !== i && "opacity-50",
                )}
                style={{ height: d.cost > 0 ? `max(2px, ${(d.cost / max) * 100}%)` : 0 }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground tabular-nums">
        {ticks.map((i) => (
          <span key={i}>{shortDay(days[i].key, t.locale)}</span>
        ))}
      </div>
    </figure>
  );
}

function Table({ title, head, rows }: { title: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <section className="rounded-lg border border-white/[0.07] bg-card">
      <h3 className="border-b border-white/[0.06] px-4 py-2.5 text-[12.5px] font-medium">{title}</h3>
      <table className="w-full text-[12.5px] tabular-nums">
        <thead className="text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={cn("px-4 py-2 font-normal", i === 0 ? "w-[34%] text-left" : "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, r) => (
            <tr key={r} className="border-t border-white/[0.05]">
              {cells.map((c, i) => (
                <td
                  key={i}
                  className={cn("px-4 py-1.5", i === 0 ? "w-[34%] max-w-0 truncate text-left font-mono" : "text-right")}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Claude Code usage on this machine: what it consumed, and what it would cost at API prices. */
export function UsageView({ repoPath }: { repoPath: string }) {
  const t = useT();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [scope, setScope] = useState<"repo" | "all">("all");
  const stats = useQuery({ queryKey: ["usage-stats"], queryFn: gitBackend.getUsageStats, refetchInterval: 60_000 });
  const project = repoPath.split("/").filter(Boolean).pop() ?? null;
  const s = useMemo(
    () => stats.data && summarize(stats.data, days, scope === "repo" ? project : null),
    [stats.data, days, scope, project],
  );
  if (stats.isError)
    return <DataUnavailable title={t("usage.error")} error={stats.error} onRetry={() => void stats.refetch()} />;
  if (!s) return <PanelLoading title={t("usage.loading")} variant="grid-snake" />;
  const cost = (b: Bucket) => usd(b.cost);
  return (
    <>
      <PanelHeader className="gap-2">
        <BarChart3 aria-hidden className="size-3.5 text-primary" />
        <h2 className="flex-1 text-[13px] font-semibold">{t("usage.title")}</h2>
        <Segmented
          label={t("usage.scope")}
          value={scope}
          onChange={setScope}
          options={[
            { value: "repo", label: project ?? t("usage.thisRepo") },
            { value: "all", label: t("usage.allProjects") },
          ]}
        />
        <Segmented
          label={t("usage.period")}
          value={days}
          onChange={setDays}
          options={PERIODS.map((d) => ({ value: d, label: t("usage.days", { count: d }) }))}
        />
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-10">
        <div className="mx-auto max-w-[900px] space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label={t("usage.cost")} value={usd(s.cost)} hint={t("usage.costHint")} />
            <Tile label={t("usage.tokens")} value={compact(s.tokens)} />
            <Tile label={t("usage.sessions")} value={String(s.sessions)} />
            <Tile
              label={t("usage.cacheHit")}
              value={s.cacheHit === null ? "—" : `${Math.round(s.cacheHit * 100)}%`}
              hint={t("usage.cacheHint")}
            />
          </div>
          <DailyChart days={s.daily} />
          {s.unpriced && (
            <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <TriangleAlert aria-hidden className="size-3.5 text-renamed" />
              {t("usage.unpriced")}
            </p>
          )}
          <Table
            title={t("usage.byModel")}
            head={[
              t("usage.model"),
              t("usage.messages"),
              t("usage.input"),
              t("usage.output"),
              t("usage.cache"),
              t("usage.cost"),
            ]}
            rows={s.byModel.map((b) => [
              b.key,
              b.messages.toLocaleString(t.locale),
              compact(b.tokens.input + b.tokens.cacheWrite5m + b.tokens.cacheWrite1h),
              compact(b.tokens.output),
              compact(b.tokens.cacheRead),
              cost(b),
            ])}
          />
          {scope === "all" && (
            <Table
              title={t("usage.byProject")}
              head={[t("usage.project"), t("usage.sessions"), t("usage.tokens"), t("usage.cost")]}
              rows={s.byProject.map((b) => [b.key, b.sessions, compact(totalTokens(b.tokens)), cost(b)])}
            />
          )}
        </div>
      </div>
    </>
  );
}
