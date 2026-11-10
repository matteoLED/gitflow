import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { AgentRun } from "@/stores/agents-store";
import type { AgentKind } from "@/types/git";

/** Used until the agent reports its own window (Claude does at the end of each run). */
const DEFAULT_WINDOW: Record<AgentKind, number> = { claude: 200_000, codex: 272_000 };

export const compact = (n: number) =>
  n >= 1_000_000_000
    ? `${+(n / 1_000_000_000).toFixed(1)}B`
    : n >= 1_000_000
      ? `${+(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
        ? `${Math.round(n / 1_000)}k`
        : String(n);

/** The conversation's context fill (latest report) and total cost (every run of the thread). */
export function threadUsage(runs: AgentRun[], agent: AgentKind) {
  const latest = [...runs].reverse().find((r) => r.usage?.contextTokens != null);
  const tokens = latest?.usage?.contextTokens ?? null;
  const window =
    [...runs].reverse().find((r) => r.usage?.contextWindow != null)?.usage?.contextWindow ?? DEFAULT_WINDOW[agent];
  const costs = runs.map((r) => r.usage?.costUsd).filter((c): c is number => c != null);
  const cost = costs.length ? costs.reduce((a, b) => a + b, 0) : null;
  return { tokens, window, cost };
}

/** Context meter of a conversation run from the app. */
export function ContextMeter({ runs, agent }: { runs: AgentRun[]; agent: AgentKind }) {
  return <UsageRing {...threadUsage(runs, agent)} />;
}

/** Codex-style ring next to the send button; hover for tokens and cost. */
export function UsageRing({ tokens, window, cost }: { tokens: number | null; window: number; cost: number | null }) {
  const t = useT();
  if (tokens === null && cost === null) return null;
  const ratio = Math.min(1, (tokens ?? 0) / window);
  const percent = Math.round(ratio * 100);
  const r = 6;
  const length = 2 * Math.PI * r;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t("agents.contextUsed", { percent })}
          className="ml-auto flex h-7 items-center gap-1.5 rounded-full px-2 text-[12px] text-muted-foreground tabular-nums outline-none hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <svg aria-hidden viewBox="0 0 16 16" className="size-4 -rotate-90">
            <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2" className="stroke-white/15" />
            <circle
              cx="8"
              cy="8"
              r={r}
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={`${ratio * length} ${length}`}
              className={cn(
                ratio > 0.85 ? "stroke-removed-foreground" : ratio > 0.6 ? "stroke-renamed" : "stroke-primary",
              )}
            />
          </svg>
          {tokens !== null && `${percent}%`}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={6}
        arrow={false}
        className="block min-w-40 space-y-2 rounded-lg border border-white/10 bg-popover px-3 py-2 text-[12.5px] text-popover-foreground shadow-xl"
      >
        {tokens !== null && (
          <div>
            <p className="text-muted-foreground">{t("agents.context")}</p>
            <p className="font-medium tabular-nums">
              {percent}% · {compact(tokens)} / {compact(window)}
            </p>
          </div>
        )}
        {cost !== null && (
          <div className={cn(tokens !== null && "border-t border-white/[0.08] pt-2")}>
            <p className="text-muted-foreground">{t("agents.cost")}</p>
            <p className="font-medium tabular-nums">{cost.toFixed(2)} USD</p>
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
