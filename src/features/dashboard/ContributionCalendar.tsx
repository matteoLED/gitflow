import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Delta, Heatmap, StatCard } from "@/components/charts";
import { useT } from "@/i18n";
import { repoKey } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import type { RepositoryInfo } from "@/types/git";
import { calendar, change, peak, topAuthors } from "./activity-stats";

const DAY = 86_400_000;

/** "last": the 12 months up to today; a number: that calendar year. */
type Period = "last" | number;

function rangeOf(period: Period, now: number): [number, number] {
  if (period === "last") return [new Date(now).setHours(0, 0, 0, 0) - 364 * DAY, now];
  return [new Date(period, 0, 1).getTime(), new Date(period, 11, 31, 23, 59, 59).getTime()];
}

const seconds = (ms: number) => Math.floor(ms / 1000);

/**
 * Commits over a year, like GitHub's contribution graph: the last 12 months or a calendar year (picked on the
 * right), everyone's or one author's (picked below), compared with the year before.
 */
export function ContributionCalendar({ repo }: { repo: RepositoryInfo }) {
  const t = useT();
  const [now] = useState(Date.now);
  const [period, setPeriod] = useState<Period>("last");
  const [author, setAuthor] = useState<string | null>(null);
  const [from, to] = rangeOf(period, now);
  const span = to - from;
  // The period and the one before, in one call: the change is computed from it.
  const stamps = useQuery({
    queryKey: [...repoKey(repo.path), "commit-activity", period],
    queryFn: () => gitBackend.commitActivity(repo.path, seconds(from - span), seconds(to)),
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
  }).data;
  const firstAt = useQuery({
    queryKey: [...repoKey(repo.path), "first-commit"],
    queryFn: () => gitBackend.firstCommitAt(repo.path),
    staleTime: Infinity,
  }).data;
  if (!stamps) return null;

  const thisYear = new Date(now).getFullYear();
  const firstYear = firstAt ? new Date(firstAt * 1000).getFullYear() : thisYear;
  const years = Array.from({ length: Math.min(10, thisYear - firstYear + 1) }, (_, i) => thisYear - i);
  const inPeriod = stamps.filter((s) => s.at * 1000 >= from);
  const people = topAuthors(inPeriod, 6).authors;
  const mine = (list: typeof stamps) => (author ? list.filter((s) => s.author === author) : list);
  const shown = mine(inPeriod);
  const before = mine(stamps).length - shown.length;
  const { start, columns } = calendar(shown, from, to, now);
  const busiest = peak(shown);
  const days = Math.max(1, Math.round((Math.min(to, now) - from) / DAY));
  const weekday = (d: number) => new Date(2026, 10, 1 + d).toLocaleDateString(t.locale, { weekday: "short" }); // Nov 1st 2026 is a Sunday
  const monday = (c: number) => new Date(start + c * 7 * DAY + 12 * 3_600_000); // noon: DST-proof

  return (
    <StatCard
      title={period === "last" ? t("activity.year") : t("activity.inYear", { year: period })}
      className="lg:col-span-2"
      period={author ?? t("activity.everyone")}
      value={shown.length}
      badge={<Delta value={change(shown.length, before)} />}
      hint={
        busiest &&
        t("activity.yearHint", {
          perDay: (shown.length / days).toFixed(1),
          day: weekday(busiest[0]),
          hour: `${busiest[1]}:00`,
        })
      }
    >
      <span className="flex gap-6">
        <span className="min-w-0 flex-1">
          <Heatmap
            columns={columns}
            legend={{ less: t("activity.less"), more: t("activity.more") }}
            rowLabels={[weekday(1), null, weekday(3), null, weekday(5), null, null]}
            columnLabel={(c) => {
              const month = (w: number) => monday(w).getMonth();
              // A month is named on its first week; the first column only when its month lasts long enough.
              const starts = c === 0 ? month(0) === month(2) : month(c) !== month(c - 1);
              return starts ? monday(c).toLocaleDateString(t.locale, { month: "short" }) : null;
            }}
            tip={(c, r, v) => ({
              label: new Date(monday(c).getTime() + r * DAY).toLocaleDateString(t.locale, {
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
              }),
              value: t.plural("activity.commitCount", v),
            })}
          />
        </span>
        <span role="radiogroup" aria-label={t("activity.period")} className="flex w-28 shrink-0 flex-col gap-0.5">
          <PeriodButton active={period === "last"} onClick={() => setPeriod("last")}>
            {t("activity.last12")}
          </PeriodButton>
          {years.map((y) => (
            <PeriodButton key={y} active={period === y} onClick={() => setPeriod(y)}>
              {y}
            </PeriodButton>
          ))}
        </span>
      </span>
      {people.length > 1 && (
        <span className="mt-4 flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-4">
          <AuthorChip active={author === null} onClick={() => setAuthor(null)}>
            {t("activity.everyone")}
          </AuthorChip>
          {people.map((p) => (
            <AuthorChip
              key={p.name}
              active={author === p.name}
              onClick={() => setAuthor(author === p.name ? null : p.name)}
            >
              {p.name}
              <span className="text-muted-foreground tabular-nums">{p.count}</span>
            </AuthorChip>
          ))}
        </span>
      )}
    </StatCard>
  );
}

function PeriodButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1.5 text-left text-[12.5px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function AuthorChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary/60 bg-primary/15" : "border-white/10 hover:bg-white/[0.05]",
      )}
    >
      {children}
    </button>
  );
}
