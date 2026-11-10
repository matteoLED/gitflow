import { create } from "zustand";
import type { DiffHunk } from "@/types/git";

export const SEVERITIES = ["bug", "risk", "nit", "question"] as const;
export type Severity = (typeof SEVERITIES)[number];
export type AiSide = "LEFT" | "RIGHT";
export type AiComment = { path: string; line: number; side: AiSide; severity: Severity; body: string };
export type AiReviewResult = { summary: string; comments: AiComment[]; invalid: number };

const MAX_BODY = 65_536;

/** The JSON object in an agent's answer: a fenced block when there is one, else the outermost braces. */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/.exec(text)?.[1];
  const start = (fenced ?? text).indexOf("{");
  const end = (fenced ?? text).lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse((fenced ?? text).slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const safePath = (path: string) =>
  path.length > 0 &&
  path.length < 4096 &&
  !path.startsWith("/") &&
  !path.split("/").some((part) => part === ".." || part === "") &&
  ![...path].some((c) => c.charCodeAt(0) < 0x20);

function toComment(value: unknown): AiComment | null {
  if (!isRecord(value)) return null;
  const { path, line, side, severity, body } = value;
  if (typeof path !== "string" || typeof body !== "string") return null;
  const cleanPath = path.trim().replace(/^\.\//, "");
  const text = body.trim();
  const valid =
    safePath(cleanPath) &&
    Number.isInteger(line) &&
    (line as number) > 0 &&
    (side === "LEFT" || side === "RIGHT") &&
    SEVERITIES.includes(severity as Severity) &&
    text.length > 0 &&
    text.length <= MAX_BODY;
  return valid
    ? { path: cleanPath, line: line as number, side: side as AiSide, severity: severity as Severity, body: text }
    : null;
}

/** Reads the agent's answer; null when it holds no usable review. Malformed comments are counted, not kept. */
export function parseAiReview(text: string): AiReviewResult | null {
  const json = extractJson(text);
  if (!isRecord(json) || typeof json.summary !== "string" || !Array.isArray(json.comments)) return null;
  const comments = json.comments.map(toComment).filter((c): c is AiComment => c !== null);
  return { summary: json.summary.trim(), comments, invalid: json.comments.length - comments.length };
}

/** GitHub's own diff context: comments must sit on a changed line or within this many lines of one. */
const CONTEXT = 3;

/**
 * `SIDE:line` keys GitHub accepts a comment on. The app's diffs carry the whole file as context, but GitHub
 * only takes lines of its 3-line-context hunks: an unchanged line further away would get the review refused.
 */
export function commentableLines(hunks: DiffHunk[]): Set<string> {
  const keys = new Set<string>();
  for (const { lines } of hunks) {
    const changed = lines.flatMap((line, i) => (line.kind === "context" ? [] : [i]));
    lines.forEach((line, i) => {
      const near = line.kind !== "context" || changed.some((c) => Math.abs(c - i) <= CONTEXT);
      if (!near) return;
      if (line.kind === "removed" && line.oldLine !== null) keys.add(`LEFT:${line.oldLine}`);
      else if (line.kind !== "removed" && line.newLine !== null) keys.add(`RIGHT:${line.newLine}`);
    });
  }
  return keys;
}

/** Drops comments on a file or line that isn't in the pull request's diff (GitHub would refuse the review). */
export const keepInDiff = (comments: AiComment[], lines: Map<string, Set<string>>) =>
  comments.filter((c) => lines.get(c.path)?.has(`${c.side}:${c.line}`));

export type AiDraft = AiComment & { id: string };
export type AiReview =
  | { status: "running"; runId: string }
  | { status: "failed"; error: string }
  | { status: "ready"; head: string; summary: string; drafts: AiDraft[]; dropped: number };

type AiReviewState = {
  /** By `reviewKeyOf`: one AI review per pull request, kept in memory until posted or discarded. */
  reviews: Record<string, AiReview>;
  set: (key: string, review: AiReview | null) => void;
  editSummary: (key: string, summary: string) => void;
  editDraft: (key: string, id: string, body: string) => void;
  discardDraft: (key: string, id: string) => void;
};

export const reviewKeyOf = (repoPath: string, number: number) => `${repoPath}#${number}`;

const updateReady = (state: AiReviewState, key: string, change: (r: AiReview & { status: "ready" }) => AiReview) => {
  const review = state.reviews[key];
  return review?.status === "ready" ? { reviews: { ...state.reviews, [key]: change(review) } } : state;
};

export const useAiReviewStore = create<AiReviewState>()((set) => ({
  reviews: {},
  set: (key, review) =>
    set(({ reviews }) => ({
      reviews: review
        ? { ...reviews, [key]: review }
        : Object.fromEntries(Object.entries(reviews).filter(([k]) => k !== key)),
    })),
  editSummary: (key, summary) => set((s) => updateReady(s, key, (r) => ({ ...r, summary }))),
  editDraft: (key, id, body) =>
    set((s) => updateReady(s, key, (r) => ({ ...r, drafts: r.drafts.map((d) => (d.id === id ? { ...d, body } : d)) }))),
  discardDraft: (key, id) =>
    set((s) => updateReady(s, key, (r) => ({ ...r, drafts: r.drafts.filter((d) => d.id !== id) }))),
}));
