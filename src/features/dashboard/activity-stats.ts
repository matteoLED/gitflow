import type { CommitStamp } from "@/types/git";

const DAY = 86_400_000;

/** Local midnight of `ms`, so days follow the user's clock. */
const dayStart = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);

/** Commits per day over the `days` days ending today, oldest first. */
export function perDay(stamps: CommitStamp[], days: number, now = Date.now()): number[] {
  const today = dayStart(now);
  const counts = Array.from({ length: days }, () => 0);
  for (const s of stamps) {
    const ago = Math.round((today - dayStart(s.at * 1000)) / DAY);
    if (ago >= 0 && ago < days) counts[days - 1 - ago]++;
  }
  return counts;
}

/** Relative change in percent, or null without a base to compare to. */
export function change(current: number, previous: number): number | null {
  return previous === 0 ? null : Math.round(((current - previous) / previous) * 100);
}

/**
 * Weeks (Monday first) covering `from`..`to` as columns of 7 days, with each day's commit count; days outside the
 * range or still to come are null. Returns the Monday the first column starts on, for labels.
 */
export function calendar(stamps: CommitStamp[], from: number, to: number, now = Date.now()) {
  const first = new Date(dayStart(from));
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const last = dayStart(Math.min(to, now));
  const counts = new Map<number, number>();
  for (const s of stamps) {
    const day = dayStart(s.at * 1000);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const columns: (number | null)[][] = [];
  for (const day = new Date(first); dayStart(day.getTime()) <= dayStart(to);) {
    const week: (number | null)[] = [];
    for (let d = 0; d < 7; d++) {
      const t = dayStart(day.getTime());
      week.push(t < dayStart(from) || t > last ? null : (counts.get(t) ?? 0));
      day.setDate(day.getDate() + 1);
    }
    columns.push(week);
  }
  return { start: first.getTime(), columns };
}

/** Commits per hour of the day (0-23). */
export function byHour(stamps: CommitStamp[]): number[] {
  const hours = Array.from({ length: 24 }, () => 0);
  for (const s of stamps) hours[new Date(s.at * 1000).getHours()]++;
  return hours;
}

/** The busiest weekday and hour, as `[weekday 0-6 Sunday first, hour]`. */
export function peak(stamps: CommitStamp[]): [number, number] | null {
  const counts = new Map<number, number>();
  for (const s of stamps) {
    const d = new Date(s.at * 1000);
    const key = d.getDay() * 24 + d.getHours();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  return best ? [Math.floor(best[0] / 24), best[0] % 24] : null;
}

/** Authors by commit count, the first `top` named and the rest grouped. */
export function topAuthors(stamps: CommitStamp[], top: number) {
  const counts = new Map<string, number>();
  for (const s of stamps) counts.set(s.author, (counts.get(s.author) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const rest = sorted.slice(top);
  return {
    authors: sorted.slice(0, top).map(([name, count]) => ({ name, count })),
    others: { people: rest.length, count: rest.reduce((sum, [, n]) => sum + n, 0) },
  };
}
