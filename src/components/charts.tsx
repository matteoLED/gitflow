import { createPortal } from "react-dom";
import { useId, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";

/** A change against the previous period: green up, red down (`invert` when lower is better). */
export function Delta({
  value,
  unit = "%",
  invert = false,
}: {
  value: number | null;
  unit?: string;
  invert?: boolean;
}) {
  if (value === null) return null;
  const good = invert ? value < 0 : value > 0;
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-[11.5px] font-medium tabular-nums",
        value === 0
          ? "bg-white/[0.06] text-muted-foreground"
          : good
            ? "bg-added/15 text-added-foreground"
            : "bg-removed/15 text-removed-foreground",
      )}
    >
      {value > 0 ? "+" : value < 0 ? "−" : "±"}
      {Math.abs(value)}
      {unit}
    </span>
  );
}

/** One figure with its context: title and period on top, the number and its change, a line, then a chart. */
export function StatCard({
  title,
  period,
  value,
  badge,
  hint,
  onClick,
  children,
  className,
}: {
  title: string;
  period?: ReactNode;
  /** Omitted on chart cards: the chart is the figure, a big number above it only repeats it. */
  value?: ReactNode;
  badge?: ReactNode;
  hint?: ReactNode;
  onClick?: () => void;
  children?: ReactNode;
  className?: string;
}) {
  const Root = onClick ? "button" : "section";
  return (
    <Root
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "surface flex min-w-0 flex-col p-4 text-left outline-none",
        onClick && "transition-colors hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <span className="flex w-full items-baseline justify-between gap-2 text-[12.5px]">
        <span className="font-medium text-muted-foreground">{title}</span>
        {period && <span className="text-muted-foreground/70">{period}</span>}
      </span>
      {value !== undefined && (
        <span className="mt-2 flex items-center gap-2">
          <span className="text-[26px] leading-none font-semibold tracking-tight tabular-nums">{value ?? "—"}</span>
          {badge}
        </span>
      )}
      <span
        className={cn("min-h-4 truncate text-[12px] text-muted-foreground", value === undefined ? "mt-0.5" : "mt-1.5")}
      >
        {hint}
      </span>
      {children && <span className="mt-4 block w-full">{children}</span>}
    </Root>
  );
}

/** A share as "12%", never a misleading "0%" for a slice that exists. */
const percent = (value: number, total: number) => {
  const p = Math.round((value / total) * 100);
  return p === 0 && value > 0 ? "<1%" : `${p}%`;
};

/** What a hovered mark shows: its label, its value, and an optional line of context. */
export type TipContent = { label: ReactNode; value: ReactNode; detail?: ReactNode };

/** One tooltip per chart, placed above the hovered mark (no per-mark popovers: a heatmap has 84 cells). */
export function useChartTip(ref: RefObject<HTMLElement | null>) {
  const [tip, setTip] = useState<(TipContent & { x: number; y: number; viewport: number }) | null>(null);
  /** At `x`, `y` in the chart's coordinates. */
  const at = (x: number, y: number, content: TipContent) => {
    const box = ref.current?.getBoundingClientRect();
    if (box) setTip({ ...content, x: box.left + x, y: box.top + y, viewport: window.innerWidth });
  };
  /** Above the middle of `target`. */
  const over = (target: Element, content: TipContent) => {
    const r = target.getBoundingClientRect();
    setTip({ ...content, x: r.left + r.width / 2, y: r.top, viewport: window.innerWidth });
  };
  // On the page itself, not in the chart: a scrolling or clipping card can't cut it off.
  const node =
    tip &&
    createPortal(
      <span
        role="tooltip"
        style={{ left: Math.min(Math.max(tip.x, 90), tip.viewport - 90), top: tip.y - 8 }}
        className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg border border-white/10 bg-popover px-2.5 py-1.5 text-left text-[11.5px] whitespace-nowrap shadow-xl shadow-black/40"
      >
        <span className="block text-muted-foreground">{tip.label}</span>
        <span className="block text-[13px] font-medium text-foreground tabular-nums">{tip.value}</span>
        {tip.detail && <span className="block text-muted-foreground">{tip.detail}</span>}
      </span>,
      document.body,
    );
  return { at, over, hide: () => setTip(null), node };
}

const VIEW_W = 100;

/**
 * A trend line with a soft fill; `previous` (same length) draws dashed behind it for comparison.
 * Hovering shows a guide on the nearest point and its tooltip.
 */
export function Sparkline({
  values,
  previous,
  height = 56,
  label,
  tip,
}: {
  values: number[];
  previous?: number[];
  height?: number;
  label: string;
  tip: (index: number) => TipContent;
}) {
  const id = useId();
  const frame = useRef<HTMLSpanElement>(null);
  const tooltip = useChartTip(frame);
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(1, ...values, ...(previous ?? []));
  const step = VIEW_W / Math.max(1, values.length - 1);
  const y = (v: number) => height - 2 - (v / max) * (height - 6);
  const points = (list: number[]) => list.map((v, i) => `${(i * step).toFixed(2)},${y(v).toFixed(2)}`);
  const line = points(values);
  const onMove = (event: PointerEvent<HTMLSpanElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const i = Math.round(((event.clientX - box.left) / box.width) * (values.length - 1));
    const index = Math.min(values.length - 1, Math.max(0, i));
    setHovered(index);
    tooltip.at((index / Math.max(1, values.length - 1)) * box.width, y(values[index]), tip(index));
  };
  const leave = () => {
    setHovered(null);
    tooltip.hide();
  };
  const left = hovered === null ? 0 : (hovered / Math.max(1, values.length - 1)) * 100;
  return (
    <span ref={frame} onPointerMove={onMove} onPointerLeave={leave} className="relative block">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${VIEW_W} ${height}`}
        preserveAspectRatio="none"
        className="block w-full overflow-visible"
        style={{ height }}
      >
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--primary)" stopOpacity={0.28} />
            <stop offset="1" stopColor="var(--primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {previous && (
          <polyline
            points={points(previous).join(" ")}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeOpacity={0.5}
            strokeWidth={1.5}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <polygon points={`0,${height} ${line.join(" ")} ${VIEW_W},${height}`} fill={`url(#${id})`} />
        <polyline
          points={line.join(" ")}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {hovered !== null && (
        <>
          <span aria-hidden className="absolute inset-y-0 w-px bg-white/15" style={{ left: `${left}%` }} />
          {previous && (
            <span
              aria-hidden
              className="absolute size-2 -translate-1/2 rounded-full bg-muted-foreground ring-2 ring-card"
              style={{ left: `${left}%`, top: y(previous[hovered]) }}
            />
          )}
          <span
            aria-hidden
            className="absolute size-2.5 -translate-1/2 rounded-full bg-primary ring-2 ring-card"
            style={{ left: `${left}%`, top: y(values[hovered]) }}
          />
        </>
      )}
      {tooltip.node}
    </span>
  );
}

const MAX_CELL = 16;

/** Days as small squares, darker with more activity; null cells (days to come) stay blank. */
export function Heatmap({
  columns,
  tip,
  legend,
  columnLabel,
  rowLabels,
}: {
  /** Columns of rows (e.g. weeks of days). */
  columns: (number | null)[][];
  tip: (column: number, row: number, value: number) => TipContent;
  legend: { less: string; more: string };
  /** Above a column (e.g. the month it starts); null for none. */
  columnLabel?: (column: number) => string | null;
  /** Beside each row (e.g. Mon, Wed, Fri); null for none. */
  rowLabels?: (string | null)[];
}) {
  const frame = useRef<HTMLSpanElement>(null);
  const tooltip = useChartTip(frame);
  const max = Math.max(1, ...columns.flat().map((v) => v ?? 0));
  const level = (v: number) => (v === 0 ? 0 : Math.ceil((v / max) * 4));
  const tone = ["bg-white/[0.05]", "bg-primary/25", "bg-primary/45", "bg-primary/70", "bg-primary"];
  const offset = rowLabels ? 2 : 1; // grid column of the first week
  const top = columnLabel ? 2 : 1; // grid row of the first day
  // One grid for labels and days, so they stay aligned; squares share the width, up to a cap.
  return (
    <span ref={frame} className="flex flex-col gap-2" onPointerLeave={tooltip.hide}>
      <span
        className="grid gap-[3px]"
        style={{
          gridTemplateColumns: `${rowLabels ? "auto " : ""}repeat(${columns.length}, minmax(0, 1fr))`,
          maxWidth: columns.length * (MAX_CELL + 3) + (rowLabels ? 36 : 0),
        }}
      >
        {rowLabels?.map((l, r) => (
          <span
            key={`row-${r}`}
            aria-hidden
            className="flex items-center pr-1.5 text-[10.5px] leading-none text-muted-foreground"
            style={{ gridColumn: 1, gridRow: top + r }}
          >
            {l}
          </span>
        ))}
        {columnLabel &&
          columns.map((_, c) => {
            const label = columnLabel(c);
            return (
              label && (
                <span
                  key={`col-${c}`}
                  aria-hidden
                  className="pb-1 text-[10.5px] leading-none whitespace-nowrap text-muted-foreground"
                  style={{ gridColumn: offset + c, gridRow: 1 }}
                >
                  {label}
                </span>
              )
            );
          })}
        {columns.flatMap((column, c) =>
          column.map((v, r) => (
            <span
              key={`${c}-${r}`}
              style={{ gridColumn: offset + c, gridRow: top + r }}
              onPointerEnter={v === null ? undefined : (e) => tooltip.over(e.currentTarget, tip(c, r, v))}
              className={cn(
                "aspect-square rounded-[3px]",
                v !== null && "transition-shadow hover:ring-1 hover:ring-foreground/60",
                v !== null && tone[level(v)],
              )}
            />
          )),
        )}
      </span>
      <span
        className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground"
        style={{ maxWidth: columns.length * (MAX_CELL + 3) + (rowLabels ? 36 : 0) }}
      >
        {legend.less}
        {tone.map((t) => (
          <span key={t} className={cn("size-2.5 rounded-[3px]", t)} />
        ))}
        {legend.more}
      </span>
      {tooltip.node}
    </span>
  );
}

/** A ranked list: label and value over a thin bar scaled to the largest; hovering a row tells its share. */
export function BarList({
  items,
}: {
  items: { key: string; label: ReactNode; value: number; display: ReactNode; muted?: boolean; tip?: TipContent }[];
}) {
  const frame = useRef<HTMLSpanElement>(null);
  const tooltip = useChartTip(frame);
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <span ref={frame} className="relative block" onPointerLeave={tooltip.hide}>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li
            key={item.key}
            onPointerEnter={(e) =>
              item.tip && tooltip.over(e.currentTarget.lastElementChild ?? e.currentTarget, item.tip)
            }
            className="-mx-1.5 rounded-md px-1.5 py-1 text-[12.5px] hover:bg-white/[0.04]"
          >
            <span className={cn("flex items-baseline justify-between gap-2", item.muted && "text-muted-foreground")}>
              <span className="min-w-0 truncate">{item.label}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">{item.display}</span>
            </span>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <span
                className={cn("block h-full rounded-full", item.muted ? "bg-white/25" : "bg-primary")}
                style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
      {tooltip.node}
    </span>
  );
}

/** Columns of totals, the failing part in red at their foot (like an error-rate chart). */
export function FailureBars({
  columns,
  height = 64,
}: {
  columns: { key: string; total: number; failed: number; tip: TipContent }[];
  height?: number;
}) {
  const frame = useRef<HTMLSpanElement>(null);
  const tooltip = useChartTip(frame);
  const max = Math.max(1, ...columns.map((c) => c.total));
  return (
    <span ref={frame} className="relative flex items-end gap-[3px]" style={{ height }} onPointerLeave={tooltip.hide}>
      {columns.map((c) => (
        <span
          key={c.key}
          onPointerEnter={(e) => tooltip.over(e.currentTarget.firstElementChild ?? e.currentTarget, c.tip)}
          className="group/bar flex h-full min-w-0 flex-1 flex-col justify-end"
        >
          <span
            className="flex flex-col justify-end overflow-hidden rounded-[3px] bg-white/[0.09] transition-colors group-hover/bar:bg-white/[0.18]"
            style={{ height: `${Math.max(c.total ? 6 : 2, (c.total / max) * 100)}%` }}
          >
            {c.failed > 0 && (
              <span className="block bg-removed" style={{ height: `${Math.max(12, (c.failed / c.total) * 100)}%` }} />
            )}
          </span>
        </span>
      ))}
      {tooltip.node}
    </span>
  );
}

/** Plain columns in the accent color (e.g. commits per hour); `highlight` marks one at full strength. */
export function Bars({
  values,
  tip,
  highlight,
  height = 64,
}: {
  values: number[];
  tip: (index: number) => TipContent;
  highlight?: number | null;
  height?: number;
}) {
  const frame = useRef<HTMLSpanElement>(null);
  const tooltip = useChartTip(frame);
  const max = Math.max(1, ...values);
  return (
    <span ref={frame} className="relative flex items-end gap-[3px]" style={{ height }} onPointerLeave={tooltip.hide}>
      {values.map((v, i) => (
        <span
          key={i}
          onPointerEnter={(e) => tooltip.over(e.currentTarget.firstElementChild ?? e.currentTarget, tip(i))}
          className="group/bar flex h-full min-w-0 flex-1 flex-col justify-end"
        >
          <span
            className={cn(
              "block rounded-[3px] transition-opacity",
              v === 0 ? "bg-white/[0.06]" : "bg-primary",
              v > 0 && i !== highlight && "opacity-45 group-hover/bar:opacity-80",
            )}
            style={{ height: `${Math.max(v ? 6 : 3, (v / max) * 100)}%` }}
          />
        </span>
      ))}
      {tooltip.node}
    </span>
  );
}

/** Shares of a whole as a ring, its total in the middle, with a legend beside it. */
export function Donut({
  slices,
  center,
}: {
  slices: { key: string; label: ReactNode; value: number; display: ReactNode; color: string }[];
  center: { value: ReactNode; label: ReactNode };
}) {
  const frame = useRef<HTMLSpanElement>(null);
  const tooltip = useChartTip(frame);
  const total = slices.reduce((sum, s) => sum + s.value, 0) || 1;
  const R = 42;
  const C = 2 * Math.PI * R;
  const GAP = slices.length > 1 ? 2.5 : 0;
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((sum, s) => sum + (s.value / total) * C, 0));
  return (
    <span className="flex items-center gap-6">
      <span ref={frame} className="relative size-32 shrink-0" onPointerLeave={tooltip.hide}>
        <svg viewBox="0 0 100 100" className="size-full -rotate-90">
          {slices.map((s, i) => {
            const length = (s.value / total) * C;
            const dash = Math.max(0.5, length - GAP);
            const circle = (
              <circle
                key={s.key}
                cx={50}
                cy={50}
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={10}
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-starts[i]}
                className="transition-opacity hover:opacity-80"
                onPointerEnter={(e) =>
                  tooltip.over(e.currentTarget, {
                    label: s.label,
                    value: s.display,
                    detail: percent(s.value, total),
                  })
                }
              />
            );
            return circle;
          })}
        </svg>
        <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[17px] font-semibold tabular-nums">{center.value}</span>
          <span className="text-[11px] text-muted-foreground">{center.label}</span>
        </span>
        {tooltip.node}
      </span>
      <ul className="flex min-w-0 flex-1 flex-col gap-2 text-[12.5px]">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: s.color }} />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{percent(s.value, total)}</span>
          </li>
        ))}
      </ul>
    </span>
  );
}

/**
 * A running total so far (solid, filled) and where it heads at the same pace (dashed), over a fixed span such as a
 * month. `values` are the cumulated points up to now; `length` the number of points the span has.
 */
export function Projection({
  values,
  length,
  projected,
  marker,
  tip,
  height = 120,
}: {
  values: number[];
  length: number;
  projected: number;
  /** Labels under the axis: start, now, end. */
  marker: { start: string; now: string; end: string };
  tip: (index: number) => TipContent;
  height?: number;
}) {
  const id = useId();
  const frame = useRef<HTMLSpanElement>(null);
  const tooltip = useChartTip(frame);
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(1e-9, projected, ...values);
  const x = (i: number) => (i / Math.max(1, length - 1)) * VIEW_W;
  const y = (v: number) => height - 2 - (v / max) * (height - 10);
  const line = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`);
  const last = values.length - 1;
  const nowPct = (last / Math.max(1, length - 1)) * 100;
  const onMove = (event: PointerEvent<HTMLSpanElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const i = Math.min(last, Math.max(0, Math.round(((event.clientX - box.left) / box.width) * (length - 1))));
    setHovered(i);
    tooltip.at((i / Math.max(1, length - 1)) * box.width, y(values[i]), tip(i));
  };
  return (
    <span className="block">
      <span
        ref={frame}
        onPointerMove={onMove}
        onPointerLeave={() => {
          setHovered(null);
          tooltip.hide();
        }}
        className="relative block"
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${height}`}
          preserveAspectRatio="none"
          className="block w-full overflow-visible"
          style={{ height }}
        >
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--primary)" stopOpacity={0.25} />
              <stop offset="1" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <polygon points={`0,${height} ${line.join(" ")} ${x(last)},${height}`} fill={`url(#${id})`} />
          <polyline
            points={line.join(" ")}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={x(last)}
            y1={y(values[last] ?? 0)}
            x2={x(length - 1)}
            y2={y(projected)}
            stroke="var(--primary)"
            strokeOpacity={0.6}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          aria-hidden
          className="absolute inset-y-0 border-l border-dashed border-white/15"
          style={{ left: `${nowPct}%` }}
        />
        <span
          aria-hidden
          className="absolute size-2.5 -translate-1/2 rounded-full bg-primary ring-2 ring-card"
          style={{ left: `${nowPct}%`, top: y(values[last] ?? 0) }}
        />
        <span
          aria-hidden
          className="absolute size-2 -translate-1/2 rounded-full border-2 border-primary bg-card"
          style={{ left: "100%", top: y(projected) }}
        />
        {hovered !== null && hovered !== last && (
          <span
            aria-hidden
            className="absolute size-2 -translate-1/2 rounded-full bg-primary ring-2 ring-card"
            style={{ left: `${(hovered / Math.max(1, length - 1)) * 100}%`, top: y(values[hovered]) }}
          />
        )}
        {tooltip.node}
      </span>
      <span className="relative mt-1.5 block h-4 text-[11px] text-muted-foreground tabular-nums">
        <span className="absolute left-0">{marker.start}</span>
        {nowPct > 12 && nowPct < 88 && (
          <span className="absolute -translate-x-1/2 font-medium text-foreground" style={{ left: `${nowPct}%` }}>
            {marker.now}
          </span>
        )}
        <span className="absolute right-0">{marker.end}</span>
      </span>
    </span>
  );
}

/** A label/value pair in a soft tile, under a card's chart (Average · Fastest · Slowest). */
export function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col rounded-lg bg-white/[0.04] px-3 py-2">
      <span className="truncate text-[11.5px] text-muted-foreground">{label}</span>
      <span className="truncate text-[13px] font-medium tabular-nums">{value}</span>
    </span>
  );
}
