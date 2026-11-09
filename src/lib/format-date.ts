import { translate, type Locale } from "@/i18n";

const DAY_MS = 86_400_000;
const INTL_LOCALE: Record<Locale, string> = { en: "en-GB", fr: "fr-FR" };

/** "9.46" / "21.48": hour without leading zero, dot separator, like the reference design. */
function time(date: Date): string {
  return `${date.getHours()}.${String(date.getMinutes()).padStart(2, "0")}`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Compact commit timestamp: "Today 9.46", "Fri 21.48", or "3 Mar 2026" beyond a week (localized). */
export function formatCommitDate(iso: string, now: Date = new Date(), locale: Locale = "en"): string {
  const date = new Date(iso);
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (daysAgo === 0) return `${translate(locale, "common.today")} ${time(date)}`;
  const intl = INTL_LOCALE[locale];
  if (daysAgo > 0 && daysAgo < 7) {
    return `${new Intl.DateTimeFormat(intl, { weekday: "short" }).format(date)} ${time(date)}`;
  }
  return new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

const UNITS: { ms: number; en: string; fr: string }[] = [
  { ms: 365 * DAY_MS, en: "y", fr: " a" },
  { ms: 7 * DAY_MS, en: "w", fr: " sem." },
  { ms: DAY_MS, en: "d", fr: " j" },
  { ms: 3_600_000, en: "h", fr: " h" },
  { ms: 60_000, en: "m", fr: " min" },
];

/** Compact age, like Linear: "3h", "5d", "8w" (fr: "3 h", "5 j", "8 sem."). */
export function formatAge(iso: string, now: Date = new Date(), locale: Locale = "en"): string {
  const elapsed = Math.max(0, now.getTime() - new Date(iso).getTime());
  const unit = UNITS.find((u) => elapsed >= u.ms);
  if (!unit) return locale === "fr" ? "maintenant" : "now";
  return `${Math.floor(elapsed / unit.ms)}${unit[locale]}`;
}
