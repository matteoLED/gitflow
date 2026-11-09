import { useEffect, useState } from "react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/* ─── Variant types ────────────────────────────────────────────────── */

type BrailleTextVariant = "orbit" | "breathe" | "snake" | "pulse" | "wave";
type GridVariant =
  | "grid"
  | "grid-importing"
  | "grid-syncing"
  | "grid-searching"
  | "grid-spiral"
  | "grid-columns"
  | "grid-orbit"
  | "grid-breathe"
  | "grid-snake"
  | "grid-pulse"
  | "grid-wave"
  | "grid-diagonal";

export type BrailleVariant = BrailleTextVariant | GridVariant;

type BrailleLoaderProps = {
  variant?: BrailleVariant;
  className?: string;
  intervalMs?: number;
  /** Override grid frames (only for grid variants) */
  frames?: number[][];
  /** Grid dot size in px (default 2) */
  dotSize?: number;
  /** Grid gap in px (default 1) */
  dotGap?: number;
  /** Accessible name; defaults to "Loading". */
  label?: string;
};

/* ─── Braille text frames ──────────────────────────────────────────── */

const BRAILLE_FRAMES: Record<BrailleTextVariant, string[]> = {
  orbit: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  breathe: ["⠁", "⠉", "⠋", "⠛", "⠟", "⠿", "⠟", "⠛", "⠋", "⠉"],
  snake: ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"],
  pulse: ["⠀", "⠁", "⠋", "⠛", "⠿", "⣿", "⠿", "⠛", "⠋", "⠁"],
  wave: ["⠁", "⠂", "⠄", "⡀", "⡈", "⡐", "⡠", "⣀", "⣁", "⣂", "⣄", "⣌", "⣔", "⣤", "⣥", "⣦", "⣮", "⣶", "⣷", "⣿"],
};

/* ─── 5×5 grid frames ──────────────────────────────────────────────── *
 *   0  1  2  3  4
 *   5  6  7  8  9
 *  10 11 12 13 14
 *  15 16 17 18 19
 *  20 21 22 23 24
 * ──────────────────────────────────────────────────────────────────── */

const GRID = 5;
const TOTAL = GRID * GRID;
const ALL = Array.from({ length: TOTAL }, (_, i) => i);

/** Diagonal fill sweep top-left → bottom-right. */
function diagonalSweep(): number[][] {
  const frames: number[][] = [];
  for (let d = 0; d <= 2 * (GRID - 1); d++) frames.push(ALL.filter((i) => Math.floor(i / GRID) + (i % GRID) <= d));
  return [...frames, []];
}

/** Rows (or columns) filling one after the other. */
function lineFill(axis: "row" | "column"): number[][] {
  const lineOf = (i: number) => (axis === "row" ? Math.floor(i / GRID) : i % GRID);
  return [...Array.from({ length: GRID }, (_, n) => ALL.filter((i) => lineOf(i) <= n)), []];
}

const SPIRAL = [0, 1, 2, 3, 4, 9, 14, 19, 24, 23, 22, 21, 20, 15, 10, 5, 6, 7, 8, 13, 18, 17, 16, 11, 12];
const PERIMETER = [0, 1, 2, 3, 4, 9, 14, 19, 24, 23, 22, 21, 20, 15, 10, 5];
const SNAKE = [0, 1, 2, 3, 4, 9, 8, 7, 6, 5, 10, 11, 12, 13, 14, 19, 18, 17, 16, 15, 20, 21, 22, 23, 24];
const RING_1 = [7, 11, 13, 17];
const RING_2 = [2, 6, 8, 10, 14, 16, 18, 22];
const RING_3 = [1, 3, 5, 9, 15, 19, 21, 23];
const CORNERS = [0, 4, 20, 24];

const GRID_FRAMES: Record<GridVariant, number[][]> = {
  grid: diagonalSweep(),
  "grid-diagonal": diagonalSweep(),
  /** Concentric diamond rings contracting then expanding */
  "grid-importing": [
    [...CORNERS, ...RING_2, 12],
    [...RING_3, ...RING_1],
    [...RING_2, 12],
    RING_1,
    [12],
    RING_1,
    [...RING_2, 12],
    [...RING_3, ...RING_1],
    [...CORNERS, ...RING_2, 12],
  ],
  /** Arrow moving up then restarting from bottom */
  "grid-syncing": [
    [22, 17, 12, 7, 11, 13],
    [17, 12, 7, 2, 6, 8],
    [12, 7, 2, 1, 3],
    [7, 2],
    [2],
    [],
    [22],
    [22, 17, 21, 23],
    [22, 17, 12, 16, 18],
    [22, 17, 12, 7, 11, 13],
  ],
  /** Cross shape orbiting clockwise */
  "grid-searching": [
    [1, 5, 7, 6, 11],
    [2, 6, 8, 7, 12],
    [3, 7, 9, 8, 13],
    [8, 12, 14, 13, 18],
    [13, 17, 19, 18, 23],
    [12, 16, 18, 17, 22],
    [11, 15, 17, 16, 21],
    [6, 10, 12, 11, 16],
    [1, 5, 7, 6, 11],
  ],
  /** Spiral inward */
  "grid-spiral": [...Array.from({ length: Math.ceil(SPIRAL.length / 2) }, (_, n) => SPIRAL.slice(0, n * 2 + 2)), []],
  /** Columns filling left to right */
  "grid-columns": lineFill("column"),
  /** Single dot orbiting the perimeter */
  "grid-orbit": PERIMETER.map((i) => [i]),
  /** Rings expanding from center then contracting */
  "grid-breathe": [
    [12],
    [12, ...RING_1],
    [12, ...RING_1, ...RING_2],
    [12, ...RING_1, ...RING_2, ...RING_3],
    ALL,
    [12, ...RING_1, ...RING_2, ...RING_3],
    [12, ...RING_1, ...RING_2],
    [12, ...RING_1],
    [12],
    [],
  ],
  /** Single dot snaking through the grid */
  "grid-snake": SNAKE.map((i) => [i]),
  /** Rings exploding outward from center */
  "grid-pulse": [[], [12], RING_1, RING_2, RING_3, CORNERS, RING_3, RING_2, RING_1, [12]],
  /** Rows filling top to bottom */
  "grid-wave": lineFill("row"),
};

function isGridVariant(variant: BrailleVariant): variant is GridVariant {
  return variant === "grid" || variant.startsWith("grid-");
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Ever-increasing tick: the frame is `tick % length`, so a variant change needs no reset. */
function useTick(ms: number) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reducedMotion()) return;
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return tick;
}

/* ─── Cycling variant component ────────────────────────────────────── */

type CyclingBrailleLoaderProps = Omit<BrailleLoaderProps, "variant"> & {
  variants: BrailleVariant[];
  /** Interval between variant switches in ms (default 3000) */
  cycleMs?: number;
};

export function CyclingBrailleLoader({ variants, cycleMs = 3000, ...props }: CyclingBrailleLoaderProps) {
  const tick = useTick(variants.length > 1 ? cycleMs : 2 ** 30);
  return <BrailleLoader {...props} variant={variants[tick % variants.length]} />;
}

/* ─── Single variant component ─────────────────────────────────────── */

export function BrailleLoader({
  variant = "orbit",
  className,
  intervalMs,
  frames,
  dotSize = 2,
  dotGap = 1,
  label,
}: BrailleLoaderProps) {
  const t = useT();
  const grid = isGridVariant(variant);
  const gridFrames = grid ? (frames ?? GRID_FRAMES[variant]) : [];
  const brailleFrames = grid ? [] : BRAILLE_FRAMES[variant];
  const tick = useTick(intervalMs ?? (grid ? 120 : 80));
  const name = label ?? t("common.loading");

  if (grid) {
    const lit = new Set(gridFrames[tick % gridFrames.length] ?? []);
    return (
      <span
        role="status"
        aria-label={name}
        className={cn("inline-grid", className)}
        style={{ gridTemplateColumns: `repeat(${GRID}, ${dotSize}px)`, gap: dotGap }}
      >
        {ALL.map((i) => (
          <span
            key={i}
            className="rounded-full bg-current transition-opacity duration-100 ease-out"
            style={{ width: dotSize, height: dotSize, opacity: lit.has(i) ? 1 : 0.2 }}
          />
        ))}
      </span>
    );
  }

  return (
    <span role="status" aria-label={name} className={cn("inline-block font-mono leading-none", className)}>
      {brailleFrames[tick % brailleFrames.length]}
    </span>
  );
}
