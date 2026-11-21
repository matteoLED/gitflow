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
import { monthProjection, summarize, type Bucket } from "./usage-stats";
import { BarList, Bars, Delta, Donut, MiniStat, Projection, Sparkline, StatCard } from "@/components/charts";

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

const SLICES = ["var(--primary)", "#c77dbb", "#5fb3a8", "#f29b45"];
const OTHER = "#6b6d75";

/** The first `top` buckets by cost, the rest folded into one "Other" slice. */
function slicesOf(buckets: Bucket[], top: number, other: string) {
  const head = buckets.slice(0, top).map((b, i) => ({
    key: b.key,
    label: b.key,
    value: b.cost,
    display: usd(b.cost),
    color: SLICES[i],
  }));
  const rest = buckets.slice(top).reduce((sum, b) => sum + b.cost, 0);
  return rest > 0 ? [...head, { key: "other", label: other, value: rest, display: usd(rest), color: OTHER }] : head;
}

/** One bar per day, with its cost, tokens and sessions on hover. */
function DailyChart({ days, period }: { days: Bucket[]; period: string }) {
  const t = useT();
  const ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1];
  return (
    <section className="surface p-4">
      <h3 className="flex items-baseline justify-between text-[12.5px]">
        <span className="font-medium text-muted-foreground">{t("usage.daily")}</span>
        <span className="text-muted-foreground/70">{period}</span>
      </h3>
      <div className="mt-4">
        <Bars
          height={150}
          values={days.map((d) => d.cost)}
          highlight={days.length - 1}
          tip={(i) => ({
            label: shortDay(days[i].key, t.locale),
            value: usd(days[i].cost),
            detail: `${compact(totalTokens(days[i].tokens))} tokens · ${t.plural("usage.sessionsCount", days[i].sessions)}`,
          })}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground tabular-nums">
        {ticks.map((i) => (
          <span key={i}>{shortDay(days[i].key, t.locale)}</span>
        ))}
      </div>
    </section>
  );
}

function Table({ title, head, rows }: { title: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <section className="surface overflow-hidden">
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
  const [now] = useState(Date.now);
  const stats = useQuery({ queryKey: ["usage-stats"], queryFn: gitBackend.getUsageStats, refetchInterval: 60_000 });
  const project = repoPath.split("/").filter(Boolean).pop() ?? null;
  const s = useMemo(
    () => stats.data && summarize(stats.data, days, scope === "repo" ? project : null),
    [stats.data, days, scope, project],
  );
  if (stats.isError)
    return <DataUnavailable title={t("usage.error")} error={stats.error} onRetry={() => void stats.refetch()} />;
  const data = stats.data;
  if (!s || !data) return <PanelLoading title={t("usage.loading")} variant="grid-snake" />;
  const cost = (b: Bucket) => usd(b.cost);
  const scoped = scope === "repo" ? project : null;
  // The same span just before, for the changes on the figures.
  const before = summarize(data, days, scoped, new Date(now - days * 86_400_000));
  const pct = (now: number, then: number) => (then ? Math.round(((now - then) / then) * 100) : null);
  const month = monthProjection(data, scoped, new Date(now));
  const today = new Date(now);
  const monthName = today.toLocaleDateString(t.locale, { month: "long" });
  const dayLabel = (d: number) =>
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), d)).toLocaleDateString(t.locale, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  const period = t("usage.days", { count: days });
  const spark = (pick: (b: Bucket) => number, show: (n: number) => string) => (
    <Sparkline
      height={32}
      values={s.daily.map(pick)}
      label={t("usage.daily")}
      tip={(i) => ({ label: shortDay(s.daily[i].key, t.locale), value: show(pick(s.daily[i])) })}
    />
  );
  const tokenKinds = [
    { key: "input", label: t("usage.input"), value: s.tokenSplit.input },
    { key: "output", label: t("usage.output"), value: s.tokenSplit.output },
    { key: "cacheRead", label: t("usage.cache"), value: s.tokenSplit.cacheRead },
    { key: "cacheWrite", label: t("usage.cacheWrite"), value: s.tokenSplit.cacheWrite },
  ].map((k, i) => ({ ...k, display: compact(k.value), color: SLICES[i] }));
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
        <div className="mx-auto max-w-[1040px] space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              title={t("usage.cost")}
              period={period}
              value={usd(s.cost)}
              badge={<Delta value={pct(s.cost, before.cost)} invert />}
              hint={t("usage.costHint")}
            >
              {spark((b) => b.cost, usd)}
            </StatCard>
            <StatCard
              title={t("usage.tokens")}
              period={period}
              value={compact(s.tokens)}
              badge={<Delta value={pct(s.tokens, before.tokens)} invert />}
              hint={t("usage.vsBefore", { value: compact(before.tokens) })}
            >
              {spark((b) => totalTokens(b.tokens), compact)}
            </StatCard>
            <StatCard
              title={t("usage.sessions")}
              period={period}
              value={s.sessions}
              badge={<Delta value={pct(s.sessions, before.sessions)} />}
              hint={t("usage.vsBefore", { value: before.sessions })}
            >
              {spark((b) => b.sessions, String)}
            </StatCard>
            <StatCard
              title={t("usage.cacheHit")}
              period={period}
              value={s.cacheHit === null ? "—" : `${Math.round(s.cacheHit * 100)}%`}
              badge={
                s.cacheHit !== null &&
                before.cacheHit !== null && (
                  <Delta value={Math.round((s.cacheHit - before.cacheHit) * 100)} unit=" pts" />
                )
              }
              hint={t("usage.cacheHint")}
            />
          </div>
          <DailyChart days={s.daily} period={period} />
          {s.unpriced && (
            <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <TriangleAlert aria-hidden className="size-3.5 text-renamed" />
              {t("usage.unpriced")}
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <StatCard
              title={t("usage.thisMonth")}
              period={monthName}
              value={usd(month.projected)}
              badge={
                <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11.5px] text-muted-foreground">
                  {t("usage.projected")}
                </span>
              }
              hint={t("usage.projectionHint", { spent: usd(month.spent), end: dayLabel(month.length) })}
            >
              <Projection
                values={month.cumulative}
                length={month.length}
                projected={month.projected}
                marker={{ start: dayLabel(1), now: t("usage.today"), end: dayLabel(month.length) }}
                tip={(i) => ({
                  label: dayLabel(i + 1),
                  value: usd(month.cumulative[i]),
                  detail: t("usage.spentSoFar"),
                })}
              />
              <span className="mt-4 grid grid-cols-3 gap-2">
                <MiniStat label={t("usage.dailyAverage")} value={usd(month.average)} />
                <MiniStat label={t("usage.spent")} value={usd(month.spent)} />
                <MiniStat
                  label={t("usage.daysLeft")}
                  value={t.plural("usage.dayCount", month.length - month.cumulative.length)}
                />
              </span>
            </StatCard>
            <StatCard
              title={t("usage.costByModel")}
              period={period}
              value={t.plural("usage.modelCount", s.byModel.length)}
              hint={s.byModel[0] && t("usage.topModel", { model: s.byModel[0].key })}
            >
              <Donut
                slices={slicesOf(s.byModel, 3, t("usage.other"))}
                center={{ value: usd(s.cost), label: t("usage.cost").toLowerCase() }}
              />
            </StatCard>
            {scope === "all" && (
              <StatCard
                title={t("usage.byProject")}
                period={period}
                value={s.byProject.length}
                hint={s.byProject[0] && t("usage.topProject", { project: s.byProject[0].key })}
              >
                <BarList
                  items={s.byProject.slice(0, 6).map((b) => ({
                    key: b.key,
                    label: <span className="font-mono">{b.key}</span>,
                    value: b.cost,
                    display: cost(b),
                    tip: {
                      label: b.key,
                      value: cost(b),
                      detail: `${t.plural("usage.sessionsCount", b.sessions)} · ${compact(totalTokens(b.tokens))} tokens`,
                    },
                  }))}
                />
              </StatCard>
            )}
            <StatCard
              title={t("usage.tokenKinds")}
              period={period}
              value={compact(s.tokens)}
              hint={t("usage.cacheHint")}
              className={scope === "all" ? undefined : "lg:col-span-2"}
            >
              <Donut
                slices={tokenKinds}
                center={{ value: compact(s.tokens), label: t("usage.tokens").toLowerCase() }}
              />
            </StatCard>
          </div>
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
        </div>
      </div>
    </>
  );
}
