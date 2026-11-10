import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Locale } from "@/i18n";
import type { BlameHunk } from "@/types/git";

/** Inline blame on/off (⌥⌘B), remembered across launches. */
export const useBlameStore = create<{ on: boolean; toggle: () => void }>()(
  persist((set) => ({ on: false, toggle: () => set((s) => ({ on: !s.on })) }), { name: "gitflow.blame" }),
);

export const isUncommitted = (sha: string) => /^0+$/.test(sha);

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** "3 days ago" / "il y a 3 jours", from Unix seconds. */
export function relativeTime(seconds: number, locale: Locale, now: number = Date.now()): string {
  const elapsed = Math.max(0, Math.floor(now / 1000) - seconds);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const unit = UNITS.find(([, size]) => elapsed >= size);
  return unit ? format.format(-Math.floor(elapsed / unit[1]), unit[0]) : format.format(0, "second");
}

const capitalized = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/** End-of-line annotation, Zed style: "Ana, Yesterday" (the summary is one click away, in the card). */
export const inlineBlame = (hunk: BlameHunk, locale: Locale, notCommitted: string) =>
  isUncommitted(hunk.sha) ? notCommitted : `${hunk.author}, ${capitalized(relativeTime(hunk.authorTime, locale))}`;
