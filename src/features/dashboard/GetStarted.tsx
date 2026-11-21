import { Check } from "lucide-react";
import { useInstalledAgents } from "@/features/agents/use-agents";
import { useActiveAccount } from "@/features/linear/linear-queries";
import { useT, type MessageKey } from "@/i18n";
import { useGithubUser } from "@/lib/git-queries";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { RepositoryInfo } from "@/types/git";

type Step = { key: string; done: boolean; title: MessageKey; hint: MessageKey; action: MessageKey; run: () => void };

/** First steps, numbered, each with its one action; done ones are checked. Gone once all are done. */
export function GetStarted({ repo }: { repo: RepositoryInfo }) {
  const t = useT();
  const github = useGithubUser(repo.path);
  const linear = useActiveAccount();
  const agents = useInstalledAgents();
  if (github.isPending || agents.isPending) return null;
  const steps: Step[] = [
    {
      key: "github",
      done: !!github.data,
      title: "start.github",
      hint: "start.githubHint",
      action: "start.githubAction",
      run: () => useUiStore.getState().setSettingsOpen(true, "integrations"),
    },
    {
      key: "linear",
      done: !!linear,
      title: "start.linear",
      hint: "start.linearHint",
      action: "start.linearAction",
      run: () => useUiStore.getState().setSettingsOpen(true, "integrations"),
    },
    {
      key: "agent",
      done: !!agents.data?.some((a) => a.installed),
      title: "start.agent",
      hint: "start.agentHint",
      action: "start.agentAction",
      run: () => useWorkspaceStore.getState().setView("agents"),
    },
  ];
  if (steps.every((s) => s.done)) return null;
  const next = steps.find((s) => !s.done);
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[14px] font-medium">{t("start.title")}</h2>
      <ol className="surface divide-y divide-white/[0.06]">
        {steps.map((step, i) => (
          <li key={step.key} className="flex items-center gap-3 px-4 py-3">
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-md text-[12px] tabular-nums",
                step.done ? "bg-added/20 text-added-foreground" : "bg-white/[0.06] text-muted-foreground",
              )}
            >
              {step.done ? <Check aria-label={t("start.done")} className="size-3.5" /> : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px]">{t(step.title)}</span>
              <span className="block truncate text-[12px] text-muted-foreground">{t(step.hint)}</span>
            </span>
            <button
              type="button"
              disabled={step.done}
              onClick={step.run}
              className={cn(
                "h-7 shrink-0 rounded-md px-3 text-[12.5px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
                step === next
                  ? "bg-foreground text-background hover:bg-foreground/90"
                  : "bg-white/[0.06] text-foreground hover:enabled:bg-white/[0.1]",
              )}
            >
              {t(step.action)}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
