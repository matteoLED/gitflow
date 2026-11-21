import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarList, Bars, Delta, FailureBars, Sparkline, StatCard } from "@/components/charts";
import { byDay, summarize } from "@/features/ci/ci-stats";
import { useT } from "@/i18n";
import { repoKey, useWorkflowRuns } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { RepositoryInfo } from "@/types/git";
import { byHour, change, peak, perDay, topAuthors } from "./activity-stats";
import { ContributionCalendar } from "./ContributionCalendar";

const DAY = 86_400_000;

/** The repository's pulse: the year's commits, this week's, how CI holds up, who commits and when. */
export function Activity({ repo }: { repo: RepositoryInfo }) {
  const t = useT();
  const [now] = useState(Date.now);
  const stamps = useQuery({
    queryKey: [...repoKey(repo.path), "commit-activity", "recent"],
    queryFn: () => gitBackend.commitActivity(repo.path, Math.floor((now - 30 * DAY) / 1000), Math.floor(now / 1000)),
    staleTime: 5 * 60_000,
  }).data;
  const runs = useWorkflowRuns(repo.path).data;
  const go = useWorkspaceStore((s) => s.setView);
  if (!stamps) return null;

  const days = perDay(stamps, 14, now);
  const week = days.slice(7).reduce((a, b) => a + b, 0);
  const lastWeek = days.slice(0, 7).reduce((a, b) => a + b, 0);
  const month = topAuthors(stamps, 4);
  const hours = byHour(stamps);
  const peakHour = hours.indexOf(Math.max(...hours));
  const busiest = peak(stamps);
  const weekday = (d: number) => new Date(2026, 10, 1 + d).toLocaleDateString(t.locale, { weekday: "long" }); // Nov 1st 2026 is a Sunday
  const date = (ms: number) =>
    new Date(ms).toLocaleDateString(t.locale, { weekday: "short", day: "numeric", month: "short" });
  const share = (n: number) => t("activity.share", { share: Math.round((n / Math.max(1, stamps.length)) * 100) });
  const ci = runs && byDay(runs, 14, new Date(now));
  const ciWeek = runs && summarize(runs.filter((r) => Date.parse(r.createdAt) >= now - 7 * DAY));
  const ciBefore =
    runs &&
    summarize(runs.filter((r) => Date.parse(r.createdAt) < now - 7 * DAY && Date.parse(r.createdAt) >= now - 14 * DAY));
  const rate = ciWeek?.rate == null ? null : Math.round(ciWeek.rate * 100);
  const rateBefore = ciBefore?.rate == null ? null : Math.round(ciBefore.rate * 100);

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <ContributionCalendar repo={repo} />
      <StatCard
        title={t("activity.commits")}
        period={t("activity.days", { count: 7 })}
        value={week}
        badge={<Delta value={change(week, lastWeek)} />}
        hint={t("activity.vsLastWeek", { count: lastWeek })}
        onClick={() => go("history")}
      >
        <Sparkline
          values={days.slice(7)}
          previous={days.slice(0, 7)}
          label={t("activity.commitsChart")}
          tip={(i) => ({
            label: date(now - (6 - i) * DAY),
            value: t.plural("activity.commitCount", days[7 + i]),
            detail: t("activity.weekBefore", { day: date(now - (13 - i) * DAY), count: days[i] }),
          })}
        />
      </StatCard>

      <StatCard
        title={t("activity.ci")}
        period={t("activity.days", { count: 14 })}
        value={rate === null ? null : `${rate}%`}
        badge={rate !== null && rateBefore !== null && <Delta value={rate - rateBefore} unit=" pts" />}
        hint={ciWeek && t("activity.ciHint", { failed: ciWeek.failure, runs: ciWeek.runs })}
        onClick={() => go("ci")}
      >
        {ci && (
          <FailureBars
            columns={ci.map((d) => ({
              key: d.day,
              total: d.success + d.failure + d.other,
              failed: d.failure,
              tip: {
                label: date(Date.parse(d.day)),
                value: t.plural("activity.runCount", d.success + d.failure + d.other),
                detail: t("activity.ciTip", { failed: d.failure, passed: d.success }),
              },
            }))}
          />
        )}
      </StatCard>

      <StatCard
        title={t("activity.authors")}
        period={t("activity.days", { count: 30 })}
        value={month.authors.length + month.others.people}
        hint={t("activity.authorsHint", { count: stamps.length })}
      >
        <BarList
          items={[
            ...month.authors.map((a) => ({
              key: a.name,
              label: a.name,
              value: a.count,
              display: a.count,
              tip: { label: a.name, value: t.plural("activity.commitCount", a.count), detail: share(a.count) },
            })),
            ...(month.others.people
              ? [
                  {
                    key: "others",
                    label: t("activity.others", { count: month.others.people }),
                    value: month.others.count,
                    display: month.others.count,
                    muted: true,
                    tip: {
                      label: t("activity.others", { count: month.others.people }),
                      value: t.plural("activity.commitCount", month.others.count),
                      detail: share(month.others.count),
                    },
                  },
                ]
              : []),
          ]}
        />
      </StatCard>
      <StatCard
        title={t("activity.hours")}
        period={t("activity.days", { count: 30 })}
        value={stamps.length ? `${peakHour}:00` : null}
        hint={busiest && t("activity.hoursHint", { day: weekday(busiest[0]) })}
      >
        <Bars
          values={hours}
          highlight={peakHour}
          tip={(h) => ({
            label: `${h}:00 – ${h + 1}:00`,
            value: t.plural("activity.commitCount", hours[h]),
            detail: share(hours[h]),
          })}
        />
        <span className="mt-1.5 flex justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>0:00</span>
          <span>6:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>23:00</span>
        </span>
      </StatCard>
    </div>
  );
}
