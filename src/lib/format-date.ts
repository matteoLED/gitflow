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
