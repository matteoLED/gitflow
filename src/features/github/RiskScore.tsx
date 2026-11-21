import { AuthorAvatar } from "@/components/author-avatar";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useT } from "@/i18n";
import { formatAge } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import type { RiskLevel, RiskScore as Score } from "./risk-score";

const avatarOf = (login: string) => `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=64`;

/** One petal of Linear's risk gauge: a lens across the top-right quarter, its tips rounded by the stroke. */
const PETAL = "M9.6 1.8A6.4 6.4 0 0 1 14.2 6.4A4.2 4.2 0 0 1 9.6 1.8Z";

/** Linear's risk gauge: four petals, filled clockwise from the top right, as many as the level; the rest outlined. */
function RiskIcon({ level, className }: { level: RiskLevel; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn("size-4 shrink-0", className)} strokeLinejoin="round">
      {[0, 1, 2, 3].map((i) => (
        <path
          key={i}
          d={PETAL}
          transform={`rotate(${i * 90} 8 8)`}
          className={
            i < level
              ? "fill-foreground/70 stroke-foreground/70 stroke-[1.3]"
              : "fill-foreground/[0.06] stroke-foreground/35 stroke-[0.8]"
          }
        />
      ))}
    </svg>
  );
}

/** The risk score a connected tool published on the pull request, with its areas on hover (Linear's diffs). */
export function RiskScore({ score }: { score: Score }) {
  const t = useT();
  const label = t(`pr.risk.${score.level}`);
  return (
    <HoverCard openDelay={150}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="-mx-1 flex items-center gap-2 rounded-full px-2.5 py-1 text-[13px] outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RiskIcon level={score.level} />
          {label}
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="left"
        align="start"
        className="flex max-h-[min(520px,var(--radix-hover-card-content-available-height))] w-[330px] flex-col rounded-xl p-0 text-[13px] leading-[15px]"
      >
        {/* Long assessments scroll; the author line stays in view below them. */}
        <div className="min-h-0 overflow-y-auto px-[15px] pt-3.5 pb-3">
          <p className="flex items-center gap-[7px]">
            <RiskIcon level={score.level} />
            {label}
          </p>
          {score.areas.length > 0 && (
            // A tree hanging from the gauge: one line down from its centre, curving off into each area.
            // An opaque line color: the trunk and a branch overlap where it leaves, and a translucent one would show it.
            <ul className="mt-[13px] ml-[7.5px] space-y-2 [--tree:color-mix(in_srgb,var(--popover),white_13%)]">
              {score.areas.map((area) => (
                <li key={area.name} className="group relative grid grid-cols-[16px_1fr] gap-x-[7px] pl-[15px]">
                  {/* The trunk: through every area but the last, where it stops at the branch. */}
                  <span
                    aria-hidden
                    className="absolute top-[-8px] bottom-0 left-0 border-l border-(color:--tree) group-first:top-[-11px] group-last:bottom-auto group-last:h-[8.5px] group-first:group-last:h-[11.5px]"
                  />
                  {/* The branch: bends off the trunk, then slants down into the area's gauge. */}
                  <svg
                    aria-hidden
                    viewBox="0 0 12 7"
                    className="absolute top-0 left-[-0.5px] h-[7px] w-3 overflow-visible"
                  >
                    <path
                      d="M0.5 0Q0.5 2.2 2.6 3.3L11.5 6.5"
                      fill="none"
                      strokeLinecap="round"
                      className="stroke-(--tree)"
                    />
                  </svg>
                  <RiskIcon level={area.level} className="-mt-px size-[15px]" />
                  <p>
                    {area.name}
                    <span className="ml-2 text-foreground/40">{t(`pr.riskArea.${area.level}`)}</span>
                  </p>
                  {area.explanation && <p className="col-start-2 mt-1 text-foreground/60">{area.explanation}</p>}
                </li>
              ))}
            </ul>
          )}
          {score.explanations.length > 0 && (
            <ul className="mt-4 list-disc space-y-1 pl-5 text-foreground/65 marker:text-foreground/40">
              {score.explanations.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
        <p className="mx-[15px] flex shrink-0 items-center gap-2 border-t border-white/[0.08] py-2.5 text-foreground/50">
          <AuthorAvatar name={score.author} src={avatarOf(score.author)} className="size-4" />
          {score.author}
          <span>{formatAge(score.at, undefined, t.locale)}</span>
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
