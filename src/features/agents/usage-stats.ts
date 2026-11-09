import type { Tokens, UsageStats } from "@/types/git";
import { costOf, totalTokens } from "./pricing";

const ZERO: Tokens = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
const plus = (a: Tokens, b: Tokens): Tokens => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
  cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
  cacheRead: a.cacheRead + b.cacheRead,
});

/** Transcripts are dated in UTC, so are the days here. */
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

export type Bucket = { key: string; tokens: Tokens; cost: number; messages: number; sessions: number };

function bucket(map: Map<string, Bucket>, key: string): Bucket {
  let b = map.get(key);
  if (!b) map.set(key, (b = { key, tokens: ZERO, cost: 0, messages: 0, sessions: 0 }));
  return b;
}

/** The last `days` days (today included), for one project or all of them. */
export function summarize(stats: UsageStats, days: number, project: string | null, today = new Date()) {
  const dayList = Array.from({ length: days }, (_, i) =>
    utcDay(new Date(today.getTime() - (days - 1 - i) * 86_400_000)),
  );
  const from = dayList[0];
  const inScope = (r: { day: string; project: string }) => r.day >= from && (!project || r.project === project);
  const byDay = new Map<string, Bucket>(
    dayList.map((d) => [d, { key: d, tokens: ZERO, cost: 0, messages: 0, sessions: 0 }]),
  );
  const byModel = new Map<string, Bucket>();
  const byProject = new Map<string, Bucket>();
  let unpriced = false;
  for (const row of stats.rows.filter(inScope)) {
    const cost = costOf(row.model, row.tokens);
    if (cost === null) unpriced = true;
    for (const b of [bucket(byDay, row.day), bucket(byModel, row.model), bucket(byProject, row.project)]) {
      b.tokens = plus(b.tokens, row.tokens);
      b.cost += cost ?? 0;
      b.messages += row.messages;
    }
  }
  const sessions = stats.sessions.filter(inScope);
  for (const s of sessions) {
    bucket(byDay, s.day).sessions += 1;
    bucket(byProject, s.project).sessions += 1;
  }
  const daily = dayList.map((d) => bucket(byDay, d));
  const tokens = daily.reduce((acc, d) => plus(acc, d.tokens), ZERO);
  const prompt = tokens.input + tokens.cacheWrite5m + tokens.cacheWrite1h + tokens.cacheRead;
  const sortByCost = (m: Map<string, Bucket>) => [...m.values()].sort((a, b) => b.cost - a.cost);
  return {
    daily,
    byModel: sortByCost(byModel),
    byProject: sortByCost(byProject),
    cost: daily.reduce((a, d) => a + d.cost, 0),
    tokens: totalTokens(tokens),
    sessions: sessions.length,
    /** Share of prompt tokens served from the cache. */
    cacheHit: prompt ? tokens.cacheRead / prompt : null,
    unpriced,
  };
}
