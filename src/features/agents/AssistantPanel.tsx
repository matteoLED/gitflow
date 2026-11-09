import { useState, type ReactNode } from "react";
import {
  FileText,
  GitCommitHorizontal,
  GitPullRequest,
  Globe,
  History,
  ListChecks,
  Maximize2,
  MessageSquarePlus,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT, type MessageKey } from "@/i18n";
import { gitBackend } from "@/lib/tauri-git";
import { useAgentsStore, threadRuns } from "@/stores/agents-store";
import { runOf, usePreviewStore } from "@/stores/preview-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { usePreviewTargets } from "@/features/preview/PreviewList";
import { pickAgent } from "./AgentButton";
import { LinearIcon } from "@/features/linear/LinearIcon";
import { useOpenIssue } from "@/features/linear/linear-queries";
import { RunSettingsBar } from "./RunSettingsBar";
import { ChatThread, CONTEXT_SEPARATOR } from "./ChatThread";
import { startAgentRun, useInstalledAgents } from "./use-agents";

type Chip = { kind: "preview" | "pr" | "commit" | "issue"; icon: ReactNode; label: string; detail: string };

/** What the user is looking at right now, as chips for them and as plain facts for the agent. */
function useContextChips(repoPath: string): Chip[] {
  const { view, pullRequest, selectedCommitHash, compareBase } = useWorkspaceStore();
  const { runs, selected } = usePreviewStore();
  const targets = usePreviewTargets(repoPath).data ?? [];
  const chips: Chip[] = [];
  const issue = useOpenIssue().data;
  // Same default as the preview panel: the first app when none was picked yet.
  const target = targets.find((x) => x.id === selected) ?? targets[0];
  const run = runOf(runs, target?.id ?? null);
  if (view === "preview" && target) {
    chips.push({
      kind: "preview",
      icon: <Globe className="size-3" />,
      label: target.name,
      detail: `The user is previewing the app ${target.name} (${target.framework}, folder ${target.dir})${run.url ? ` running at ${run.url}` : ""}.`,
    });
  }
  if (pullRequest) {
    const diff = pullRequest.base ? ` Its full diff is \`git diff ${pullRequest.base}..${pullRequest.head}\`.` : "";
    chips.push({
      kind: "pr",
      icon: <GitPullRequest className="size-3" />,
      label: `#${pullRequest.number}`,
      detail: `Open pull request #${pullRequest.number} "${pullRequest.title}" by ${pullRequest.author}.${diff}`,
    });
  }
  if (selectedCommitHash && !compareBase && view !== "preview") {
    chips.push({
      kind: "commit",
      icon: <GitCommitHorizontal className="size-3" />,
      label: selectedCommitHash.slice(0, 7),
      detail: `Selected commit ${selectedCommitHash} (\`git show ${selectedCommitHash}\`).`,
    });
  }
  if (view === "linear" && issue) {
    chips.push({
      kind: "issue",
      icon: <LinearIcon className="size-3" />,
      label: issue.identifier,
      detail: `The user is looking at the Linear issue ${issue.identifier} "${issue.title}" (status ${issue.state.name}, team ${issue.team.name}${issue.project ? `, project ${issue.project.name}` : ""}). Its branch name is ${issue.branchName}. Description:\n${issue.description ?? "(none)"}`,
    });
  }
  return chips;
}

/** Notion-AI-like starters for what's on screen; the last one always applies. */
function useSuggestions(chips: Chip[]): { key: MessageKey; Icon: typeof Sparkles }[] {
  const view = useWorkspaceStore((s) => s.view);
  const kinds = new Set(chips.map((c) => c.kind));
  const list: { key: MessageKey; Icon: typeof Sparkles }[] = [];
  if (kinds.has("issue"))
    list.push({ key: "assistant.sugSummarize", Icon: FileText }, { key: "assistant.sugPlan", Icon: ListChecks });
  if (kinds.has("pr")) list.push({ key: "assistant.sugReview", Icon: GitPullRequest });
  if (kinds.has("commit") && view !== "linear") list.push({ key: "assistant.sugExplain", Icon: GitCommitHorizontal });
  if (kinds.has("preview")) list.push({ key: "assistant.sugPage", Icon: Globe });
  list.push({ key: "assistant.sugRecent", Icon: History });
  return list.slice(0, 4);
}

function HeaderButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          className="size-7 text-muted-foreground"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Side-panel assistant (⌘I), like a browser's AI sidebar: it stays next to the preview, a diff or the
 * history, and knows what's on screen. Read-only, through the user's own Claude Code / Codex.
 */
export function AssistantPanel({ repoPath }: { repoPath: string }) {
  const t = useT();
  const setOpen = useUiStore((s) => s.setAssistantOpen);
  const { runs, assistantThread, setAssistantThread, preferredAgent, select } = useAgentsStore();
  const installed = useInstalledAgents().data;
  const agent = pickAgent(installed, preferredAgent);
  const chips = useContextChips(repoPath);
  const suggestions = useSuggestions(chips);
  const repo = useWorkspaceStore((s) => s.repo);
  const view = useWorkspaceStore((s) => s.view);
  const [sending, setSending] = useState(false);
  const thread = assistantThread ? threadRuns(runs, assistantThread) : [];
  const live = thread.find((r) => r.status === "running");
  const resume = [...thread].reverse().find((r) => r.sessionId)?.sessionId ?? null;
  const agentName = agent === "codex" ? "Codex" : "Claude Code";

  const send = async (message: string, images: string[] = []) => {
    if (!agent || sending) return;
    setSending(true);
    let prompt = message;
    if (!assistantThread || !resume) {
      // First message: say where the user is. Later ones continue the same conversation.
      const page = view === "preview" ? await gitBackend.previewViewUrl().catch(() => null) : null;
      const facts = [
        `Context from gitflow, the user's Git client: repository ${repo?.name} at ${repoPath}.`,
        ...chips.map((c) => c.detail),
        page ? `The page currently shown is ${page}.` : null,
      ].filter(Boolean);
      prompt = `${facts.join("\n")}${CONTEXT_SEPARATOR}${message}`;
    }
    const id = await startAgentRun(
      repoPath,
      agent,
      { kind: "custom", prompt },
      message.slice(0, 80),
      assistantThread ? { resume, thread: assistantThread } : undefined,
      images,
    );
    if (id && !assistantThread) setAssistantThread(id);
    setSending(false);
  };

  return (
    <div data-tauri-drag-region className="h-full shrink-0 pt-[45px] pr-1.5 pb-1.5">
      <aside
        aria-label={t("assistant.title")}
        className="flex h-full w-[380px] flex-col overflow-hidden rounded-[10px] border border-white/[0.06] bg-background shadow-[0_1px_3px_rgb(0_0_0/0.35)]"
      >
        <header
          data-tauri-drag-region
          className="flex h-[46px] shrink-0 items-center gap-1 border-b border-white/[0.06] px-3"
        >
          <Sparkles aria-hidden className="size-4 text-primary" />
          <h2 className="mr-auto pl-1 text-[13px] font-medium">{t("assistant.title")}</h2>
          <HeaderButton label={t("assistant.new")} onClick={() => setAssistantThread(null)}>
            <MessageSquarePlus />
          </HeaderButton>
          {assistantThread && (
            <HeaderButton
              label={t("assistant.expand")}
              onClick={() => {
                select({ type: "run", id: assistantThread });
                useWorkspaceStore.getState().setView("agents");
              }}
            >
              <Maximize2 />
            </HeaderButton>
          )}
          <HeaderButton label={t("common.dismiss")} onClick={() => setOpen(false)}>
            <X />
          </HeaderButton>
        </header>
        <ChatThread
          compact
          placeholder={assistantThread ? undefined : t("assistant.placeholder")}
          steps={thread.flatMap((r) => r.steps)}
          running={!!live || sending}
          agentLabel={agentName}
          settings={agent && <RunSettingsBar agent={agent} />}
          onStop={live ? () => void gitBackend.cancelAgentRun(live.id) : undefined}
          onSend={agent ? (m, images) => void send(m, images) : undefined}
          empty={
            <div className="px-1 pt-8">
              <span className="grid size-9 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03]">
                <Sparkles aria-hidden className="size-4.5 text-primary" />
              </span>
              <p className="mt-4 font-display text-[19px]">{t("assistant.emptyTitle")}</p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">{t("assistant.emptyHint")}</p>
              <p className="mt-6 mb-1 text-[11.5px] font-medium text-muted-foreground">{t("agents.suggestions")}</p>
              <ul className="-mx-2">
                {suggestions.map(({ key, Icon }) => (
                  <li key={key}>
                    <button
                      type="button"
                      disabled={!agent || sending}
                      onClick={() => void send(t(key))}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] text-foreground/90 outline-none transition-colors hover:enabled:bg-white/[0.05] hover:enabled:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      {t(key)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          }
          context={
            !assistantThread &&
            chips.map((chip) => (
              <span
                key={chip.label}
                className="flex items-center gap-1 rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[11.5px] text-foreground/90"
              >
                {chip.icon}
                {chip.label}
              </span>
            ))
          }
        />
      </aside>
    </div>
  );
}

export default AssistantPanel;
