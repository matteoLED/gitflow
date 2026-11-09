import { useShallow } from "zustand/react/shallow";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { useAgentsStore } from "@/stores/agents-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { AgentInfo, AgentKind, AgentTask } from "@/types/git";
import { startAgentRun, useInstalledAgents } from "./use-agents";

/** The preferred agent when installed, else whichever is. */
export function pickAgent(installed: AgentInfo[] | undefined, preferred: AgentKind): AgentKind | null {
  const ready = (installed ?? []).filter((a) => a.installed).map((a) => a.kind);
  return ready.includes(preferred) ? preferred : (ready[0] ?? null);
}

/** "AI review" on a pull request, "Explain" on a commit: starts the run and shows its workflow. */
export function AgentButton({ repoPath }: { repoPath: string }) {
  const t = useT();
  const installed = useInstalledAgents().data;
  const preferred = useAgentsStore((s) => s.preferredAgent);
  const { pullRequest, compareBase, selectedCommitHash, setView } = useWorkspaceStore(
    useShallow((s) => ({
      pullRequest: s.pullRequest,
      compareBase: s.compareBase,
      selectedCommitHash: s.selectedCommitHash,
      setView: s.setView,
    })),
  );
  const [starting, setStarting] = useState(false);
  const agent = pickAgent(installed, preferred);

  const job: { task: AgentTask; title: string; label: string } | null =
    pullRequest?.base && compareBase
      ? {
          task: {
            kind: "review-pull-request",
            number: pullRequest.number,
            base: pullRequest.base,
            head: pullRequest.head,
          },
          title: t("agents.reviewTitle", { number: pullRequest.number }),
          label: t("agents.aiReview"),
        }
      : selectedCommitHash
        ? {
            task: { kind: "explain-commit", hash: selectedCommitHash },
            title: t("agents.explainTitle", { hash: selectedCommitHash.slice(0, 7) }),
            label: t("agents.explain"),
          }
        : null;
  if (!job || !agent) return null;

  const start = async () => {
    setStarting(true);
    const id = await startAgentRun(repoPath, agent, job.task, job.title);
    setStarting(false);
    if (!id) return;
    useAgentsStore.getState().select({ type: "run", id });
    setView("agents");
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={starting}
          onClick={() => void start()}
          className="h-6 gap-1.5 rounded-full px-2 text-[12.5px] text-muted-foreground [&_svg]:size-3.5"
        >
          {starting ? <BrailleLoader /> : <Sparkles aria-hidden className="text-primary" />}
          {job.label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("agents.runWith", { agent: agent === "claude" ? "Claude Code" : "Codex" })}</TooltipContent>
    </Tooltip>
  );
}
