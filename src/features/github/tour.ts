import { create } from "zustand";
import type { DiffHunk, DiffLine } from "@/types/git";
import { extractJson, isRecord, safePath } from "./ai-review";

/** A pull request's guided tour, as the agent writes it (see agents/mod.rs TourPullRequest). */
export const LEVELS = ["low", "medium", "high"] as const;
export type Level = (typeof LEVELS)[number];
export type Rating = "risk" | "impact" | "attention";
export type Snippet = { path: string; start: number; end: number };
export type TourStep = { label: string; title: string; explanation: string; snippets: Snippet[] };
export type TourLink = { from: number; to: number; label: string };
export type Tour = {
  overview: string;
  risk: Level;
  impact: Level;
  attention: Level;
  /** Why each rating, in a sentence or two; empty when the agent gave none (tours written before they existed). */
  reasons: Record<Rating, string>;
  steps: TourStep[];
  links: TourLink[];
};
/** Brief → detailed, plain → technical: 0, 1 or 2 each. */
export type Tone = { detail: number; technical: number };

const MAX_STEPS = 12;
const MAX_SNIPPET = 80;
const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : null;
const level = (value: unknown): Level => (LEVELS.includes(value as Level) ? (value as Level) : "medium");

function toSnippet(value: unknown): Snippet | null {
  if (!isRecord(value) || typeof value.path !== "string") return null;
  const path = value.path.trim().replace(/^\.\//, "");
  const { start, end } = value;
  if (!safePath(path) || !Number.isInteger(start) || !Number.isInteger(end)) return null;
  const [a, b] = [start as number, end as number];
  if (a < 1 || b < a) return null;
  return { path, start: a, end: Math.min(b, a + MAX_SNIPPET - 1) };
}

function toStep(value: unknown): TourStep | null {
  if (!isRecord(value)) return null;
  const label = text(value.label, 200);
  const title = text(value.title, 400);
  const explanation = text(value.explanation, 20_000);
  if (!label || !title || !explanation) return null;
  const snippets = Array.isArray(value.snippets)
    ? value.snippets.map(toSnippet).filter((s): s is Snippet => s !== null)
    : [];
  return { label, title, explanation, snippets };
}

/** Reads the agent's answer; null when it holds no usable tour. Malformed steps and links are dropped. */
export function parseTour(answer: string): Tour | null {
  const json = extractJson(answer);
  if (!isRecord(json) || !Array.isArray(json.steps)) return null;
  const overview = text(json.overview, 20_000);
  const steps = json.steps
    .map(toStep)
    .filter((s): s is TourStep => s !== null)
    .slice(0, MAX_STEPS);
  if (!overview || steps.length === 0) return null;
  const reasons = isRecord(json.reasons) ? json.reasons : {};
  const links = (Array.isArray(json.links) ? json.links : []).flatMap((l): TourLink[] => {
    if (!isRecord(l) || !Number.isInteger(l.from) || !Number.isInteger(l.to)) return [];
    const [from, to] = [l.from as number, l.to as number];
    const ok = from !== to && [from, to].every((i) => i >= 0 && i < steps.length);
    return ok ? [{ from, to, label: text(l.label, 80) ?? "" }] : [];
  });
  return {
    overview,
    risk: level(json.risk),
    impact: level(json.impact),
    attention: level(json.attention),
    reasons: {
      risk: text(reasons.risk, 1000) ?? "",
      impact: text(reasons.impact, 1000) ?? "",
      attention: text(reasons.attention, 1000) ?? "",
    },
    steps,
    links,
  };
}

/**
 * Where each step sits in the diagram: its row is the longest chain of links leading to it (so every arrow
 * points down), its column its place in that row. Cycles are broken by ignoring links pointing back.
 */
export function layoutSteps(count: number, links: TourLink[]): { row: number; column: number }[] {
  const rows = Array.from({ length: count }, () => 0);
  // Links go forward in the step order; a few passes settle chains (at most `count` long).
  const forward = links.filter((l) => l.from < l.to);
  for (let pass = 0; pass < count; pass++) for (const l of forward) rows[l.to] = Math.max(rows[l.to], rows[l.from] + 1);
  const seen = new Map<number, number>();
  return rows.map((row) => {
    const column = seen.get(row) ?? 0;
    seen.set(row, column + 1);
    return { row, column };
  });
}

/** The diff lines of a snippet: those whose new-file line falls in its range, plus removed lines among them. */
export function snippetLines(hunks: DiffHunk[], snippet: Snippet): DiffLine[] {
  const lines = hunks.flatMap((h) => h.lines);
  const inRange = (l: DiffLine) => l.newLine !== null && l.newLine >= snippet.start && l.newLine <= snippet.end;
  const first = lines.findIndex(inRange);
  if (first < 0) return [];
  let last = first;
  lines.forEach((l, i) => {
    if (inRange(l)) last = i;
  });
  return lines.slice(first, last + 1);
}

export type TourState =
  | { status: "running"; runId: string }
  | { status: "ready"; head: string; tour: Tour; tone: Tone }
  | { status: "failed"; error: string };

type TourStore = {
  tours: Record<string, TourState>;
  /** Snippets marked reviewed, by tour key then `path:start`. */
  reviewed: Record<string, Record<string, true>>;
  /** A tour to show as soon as its pull request's page is open (from the "ready" notice); `n` tells requests apart. */
  requested: { key: string; n: number } | null;
  request: (key: string) => void;
  set: (key: string, state: TourState | null) => void;
  toggleReviewed: (key: string, snippet: Snippet) => void;
};

export const snippetKey = (s: Snippet) => `${s.path}:${s.start}`;
export const tourKeyOf = (repoPath: string, number: number) => `${repoPath}#${number}`;

export const useTourStore = create<TourStore>()((set) => ({
  tours: {},
  reviewed: {},
  requested: null,
  request: (key) => set(({ requested }) => ({ requested: { key, n: (requested?.n ?? 0) + 1 } })),
  set: (key, state) =>
    set(({ tours, reviewed }) => {
      const next = state
        ? { ...tours, [key]: state }
        : Object.fromEntries(Object.entries(tours).filter(([k]) => k !== key));
      // A new tour starts with nothing reviewed.
      return { tours: next, reviewed: state?.status === "running" ? { ...reviewed, [key]: {} } : reviewed };
    }),
  toggleReviewed: (key, snippet) =>
    set(({ reviewed }) => {
      const id = snippetKey(snippet);
      const current = reviewed[key] ?? {};
      const mine: Record<string, true> = current[id]
        ? Object.fromEntries(Object.entries(current).filter(([k]) => k !== id))
        : { ...current, [id]: true };
      return { reviewed: { ...reviewed, [key]: mine } };
    }),
}));
