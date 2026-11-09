import type { DiffLine } from "@/types/git";
import type { SyntaxThemeName } from "./syntax";
import type { HighlightRequest, HighlightResponse, SlimToken } from "./syntax.worker";

export type LineTokens = (SlimToken[] | null)[];

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (tokens: LineTokens | null) => void>();

function getWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (!worker) {
    worker = new Worker(new URL("./syntax.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<HighlightResponse>) => {
      pending.get(data.id)?.(data.tokens);
      pending.delete(data.id);
    };
  }
  return worker;
}

/** Results by diff (the query cache keeps the same array while the diff is unchanged), then by theme. */
const cache = new WeakMap<DiffLine[], Map<string, LineTokens>>();

export function cachedTokens(lines: DiffLine[], theme: SyntaxThemeName): LineTokens | null {
  return cache.get(lines)?.get(theme) ?? null;
}

/** Highlights in the shared worker; falls back to the main thread where workers don't exist (tests). */
export async function highlightDiff(
  path: string,
  lines: DiffLine[],
  theme: SyntaxThemeName,
): Promise<LineTokens | null> {
  const hit = cachedTokens(lines, theme);
  if (hit) return hit;
  const tokens = await highlightUncached(path, lines, theme);
  if (tokens) cache.set(lines, (cache.get(lines) ?? new Map()).set(theme, tokens));
  return tokens;
}

function highlightUncached(path: string, lines: DiffLine[], theme: SyntaxThemeName): Promise<LineTokens | null> {
  const target = getWorker();
  if (!target) return import("./syntax").then((m) => m.highlightDiff(path, lines, theme));
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    target.postMessage({ id, path, lines, theme } satisfies HighlightRequest);
  });
}
