import type { PullRequestDetails } from "@/types/git";

export type RiskLevel = 1 | 2 | 3 | 4;
export type RiskArea = { name: string; level: RiskLevel; explanation?: string };
export type RiskScore = {
  level: RiskLevel;
  explanations: string[];
  areas: RiskArea[];
  author: string;
  at: string;
};

const BLOCK = /<!--\s*linear:extension\s*([\s\S]*?)-->/g;
const ENTRY_KEYS = new Set(["plugin", "sha", "level", "explanations", "areas"]);
const AREA_KEYS = new Set(["name", "level", "explanation"]);

const isLevel = (v: unknown): v is RiskLevel => v === 1 || v === 2 || v === 3 || v === 4;
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;

/** One `riskScore` entry, validated as Linear does: anything off (unknown field, bad area) drops the score. */
function parseEntry(entry: Record<string, unknown>, head: string | null) {
  if (Object.keys(entry).some((k) => !ENTRY_KEYS.has(k)) || !isLevel(entry.level)) return null;
  if (entry.sha !== undefined && (typeof entry.sha !== "string" || (head && entry.sha !== head))) return null;
  const explanations = entry.explanations ?? [];
  if (!Array.isArray(explanations) || explanations.length > 8 || !explanations.every((e) => text(e, 200))) return null;
  const areas = entry.areas ?? [];
  if (!Array.isArray(areas) || areas.length > 8) return null;
  const parsed: RiskArea[] = [];
  for (const a of areas as Record<string, unknown>[]) {
    if (typeof a !== "object" || !a || Object.keys(a).some((k) => !AREA_KEYS.has(k))) return null;
    if (!text(a.name, 60) || String(a.name).includes("\n") || !isLevel(a.level)) return null;
    if (a.explanation !== undefined && !text(a.explanation, 200)) return null;
    parsed.push({ name: String(a.name).trim(), level: a.level, explanation: (a.explanation as string)?.trim() });
  }
  // Highest risk first; equal levels keep the order given (sort is stable).
  parsed.sort((x, y) => y.level - x.level);
  return { level: entry.level, explanations: (explanations as string[]).map((e) => e.trim()), areas: parsed };
}

/** The risk score a connected tool left in a `<!-- linear:extension {…} -->` comment, if any. */
export function riskScoreIn(body: string, head: string | null) {
  let found: Omit<RiskScore, "author" | "at"> | null = null;
  for (const [, json] of body.matchAll(BLOCK)) {
    try {
      const block = JSON.parse(json) as { version?: unknown; plugins?: unknown };
      if (block.version !== 1 || !Array.isArray(block.plugins)) continue;
      for (const p of block.plugins as Record<string, unknown>[])
        if (p?.plugin === "riskScore") found = parseEntry(p, head) ?? found;
    } catch {
      // Not JSON: not an extension block.
    }
  }
  return found;
}

/** The latest risk score on the pull request: its description, reviews and comments, newest wins. */
export function riskScoreOf(pr: PullRequestDetails): RiskScore | null {
  const head = pr.commits[pr.commits.length - 1]?.oid ?? null;
  const sources = [
    { body: pr.body, author: pr.author.login, at: pr.createdAt },
    ...pr.reviews.map((r) => ({ body: r.body, author: r.author.login, at: r.submittedAt })),
    ...pr.comments.map((c) => ({ body: c.body, author: c.author.login, at: c.createdAt })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  let latest: RiskScore | null = null;
  for (const s of sources) {
    const score = s.body ? riskScoreIn(s.body, head) : null;
    if (score) latest = { ...score, author: s.author, at: s.at };
  }
  return latest;
}
