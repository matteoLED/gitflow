import { useShallow } from "zustand/react/shallow";
import { DataUnavailable } from "@/components/states";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  Columns2,
  ExternalLink,
  FileCode2,
  GitCommitHorizontal,
  GitPullRequest,
  Sparkles,
  Square,
} from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PanelHeader, PanelLoading } from "@/components/layout/panel";
import { useT, type MessageKey } from "@/i18n";
import { formatCommitDate } from "@/lib/format-date";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { threadRuns, unsavedFollowUps, useAgentsStore, type AgentRun } from "@/stores/agents-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { AgentKind, AgentTask, WorkflowJob } from "@/types/git";
import { ClaudeIcon, CodexIcon } from "./agent-icons";
import { StatusIcon, ghStatus } from "./status";
import { UsageRing, threadUsage } from "./ContextMeter";
import { contextWindowOf, costOf } from "./pricing";
import { UsageView } from "./UsageView";
import { AgentDefinitionEditor } from "./AgentDefinitions";
import { WorktreeBar } from "./WorktreeBar";
import { useComposerMenu } from "./ComposerMenu";
import { RunSettingsBar } from "./RunSettingsBar";
import { ChatThread } from "./ChatThread";
import { startAgentRun, useInstalledAgents } from "./use-agents";
import { ParallelBoard } from "./ParallelBoard";
import { fanOutAgents, type FanOut } from "./parallel-board";
import { AttachButton, AttachmentStrip, useAttachments } from "./attachments";

const AGENTS: { kind: AgentKind; name: string; Icon: typeof ClaudeIcon; hint: MessageKey }[] = [
  { kind: "claude", name: "Claude Code", Icon: ClaudeIcon, hint: "agents.claudeHint" },
  { kind: "codex", name: "Codex", Icon: CodexIcon, hint: "agents.codexHint" },
];

function Page({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <>
      <PanelHeader className="gap-2">{header}</PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        <div className="mx-auto max-w-[760px]">{children}</div>
      </div>
    </>
  );
}

/** Claude Code or Codex, as a small menu inside the composer. */
function AgentMenu() {
  const t = useT();
  const installed = useInstalledAgents().data;
  const { preferredAgent, setPreferredAgent } = useAgentsStore(
    useShallow((s) => ({ preferredAgent: s.preferredAgent, setPreferredAgent: s.setPreferredAgent })),
  );
  const current = AGENTS.find((a) => a.kind === preferredAgent) ?? AGENTS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("agents.agent")}
        className="flex h-7 items-center gap-1.5 rounded-full border border-white/[0.08] px-2.5 text-[12.5px] outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-white/[0.08]"
      >
        <current.Icon className={cn("size-3.5", current.kind === "claude" ? "text-[#d97757]" : "text-foreground")} />
        {current.name}
        <ChevronDown aria-hidden className="size-3 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 rounded-xl p-1">
        {AGENTS.map(({ kind, name, Icon, hint }) => {
          const info = installed?.find((a) => a.kind === kind);
          const available = info?.installed ?? false;
          return (
            <DropdownMenuItem
              key={kind}
              disabled={!available}
              onSelect={() => setPreferredAgent(kind)}
              className="items-start gap-2.5 px-2 py-1.5"
            >
              <Icon className={cn("mt-0.5 size-4", kind === "claude" ? "text-[#d97757]" : "text-foreground")} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px]">{name}</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">
                  {available ? (info?.version ?? t(hint)) : t("agents.notInstalled")}
                </span>
              </span>
              <Check aria-hidden className={cn("mt-0.5 size-3.5", kind !== preferredAgent && "invisible")} />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const FAN_OUTS: FanOut[] = ["off", "mixed", "twice"];

/** "Run on N agents": the same prompt in two isolated worktrees, side by side on the Parallel agents board. */
function FanOutMenu({ value, onChange }: { value: FanOut; onChange: (value: FanOut) => void }) {
  const t = useT();
  const preferredAgent = useAgentsStore((s) => s.preferredAgent);
  const agent = AGENTS.find((a) => a.kind === preferredAgent)?.name ?? "";
  const labels: Record<FanOut, string> = {
    off: t("run.parallelOff"),
    mixed: t("run.parallelMixed"),
    twice: t("run.parallelTwice", { agent }),
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("run.parallelTitle")}
        title={t("run.parallelHint")}
        className={cn(
          "flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted-foreground outline-none hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-white/10",
          value !== "off" && "text-primary",
        )}
      >
        <Columns2 aria-hidden className="size-3.5" />
        {labels[value]}
        <ChevronDown aria-hidden className="size-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-48 rounded-xl p-1">
        {FAN_OUTS.map((option) => (
          <DropdownMenuItem key={option} onSelect={() => onChange(option)} className="gap-2 px-2 py-1.5 text-[12.5px]">
            <Check aria-hidden className={cn("size-3.5", option !== value && "invisible")} />
            {labels[option]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Preset = { id: string; label: MessageKey; hint: string; Icon: typeof Sparkles; task: AgentTask; title: string };

function usePresets(): Preset[] {
  const t = useT();
  const { pullRequest, selectedCommitHash, compareBase } = useWorkspaceStore(
    useShallow((s) => ({
      pullRequest: s.pullRequest,
      selectedCommitHash: s.selectedCommitHash,
      compareBase: s.compareBase,
    })),
  );
  const presets: Preset[] = [];
  if (pullRequest?.base) {
    presets.push({
      id: "review",
      label: "agents.reviewPr",
      hint: `#${pullRequest.number} ${pullRequest.title}`,
      Icon: GitPullRequest,
      task: { kind: "review-pull-request", number: pullRequest.number, base: pullRequest.base, head: pullRequest.head },
      title: t("agents.reviewTitle", { number: pullRequest.number }),
    });
  }
  if (selectedCommitHash && !compareBase) {
    presets.push({
      id: "explain",
      label: "agents.explainCommit",
      hint: selectedCommitHash.slice(0, 7),
      Icon: GitCommitHorizontal,
      task: { kind: "explain-commit", hash: selectedCommitHash },
      title: t("agents.explainTitle", { hash: selectedCommitHash.slice(0, 7) }),
    });
  }
  presets.push({
    id: "message",
    label: "agents.commitMessage",
    hint: t("agents.commitMessageHint"),
    Icon: FileCode2,
    task: { kind: "commit-message" },
    title: t("agents.commitMessage"),
  });
  return presets;
}

const NEW_TASK_FIELD =
  "max-h-72 min-h-28 resize-none border-0 bg-transparent px-4 pt-3.5 text-[14px] shadow-none focus-visible:ring-0 md:text-[14px] dark:bg-transparent";

function Composer({ repoPath }: { repoPath: string }) {
  const t = useT();
  const { preferredAgent, select } = useAgentsStore(
    useShallow((s) => ({ preferredAgent: s.preferredAgent, select: s.select })),
  );
  const presets = usePresets();
  const [prompt, setPrompt] = useState("");
  const {
    menu: completion,
    chips,
    onKeyDown: completeKey,
    onSelect: trackCaret,
    onScroll: syncChips,
    expand,
    anchor: composerRef,
    input: inputRef,
  } = useComposerMenu(repoPath, prompt, setPrompt, NEW_TASK_FIELD);
  const [starting, setStarting] = useState(false);
  const attachments = useAttachments();
  const [fanOut, setFanOut] = useState<FanOut>("off");
  const run = async (task: AgentTask, title: string, images: string[] = []) => {
    setStarting(true);
    // Only free-form requests fan out: ready-made tasks just read.
    const agents = task.kind === "custom" ? fanOutAgents(fanOut, preferredAgent) : [preferredAgent];
    const group = agents.length > 1 ? crypto.randomUUID() : undefined;
    let first: string | null = null;
    for (const agent of agents) {
      // One after the other: concurrent `git worktree add` would contend for the repository's locks.
      const id = await startAgentRun(repoPath, agent, task, title, undefined, images, group);
      if (first === null) first = id;
    }
    setStarting(false);
    if (group) select({ type: "board" });
    else if (first) select({ type: "run", id: first });
  };
  const runCustom = () => {
    const images = attachments.items.map((a) => a.path);
    if ((!prompt.trim() && images.length === 0) || attachments.saving) return;
    const text = expand(prompt.trim()) || t("attach.lookAtThis");
    attachments.clear();
    void run({ kind: "custom", prompt: text }, text.slice(0, 80), images);
  };

  return (
    <Page header={<h2 className="text-[13px] font-medium">{t("agents.new")}</h2>}>
      <div className="pt-[9vh]">
        <h1 className="font-display text-[28px]">{t("agents.composerTitle")}</h1>
        <p className="mt-1 text-[13.5px] text-muted-foreground">{t("agents.composerHint")}</p>
        <div
          ref={composerRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={attachments.onDrop}
          className="relative mt-7 rounded-xl border border-white/[0.07] bg-[color-mix(in_oklab,var(--foreground)_5%,var(--background))] transition-colors focus-within:border-white/[0.14]"
        >
          {completion}
          <AttachmentStrip attachments={attachments} />
          <div className="relative">
            {chips}
            <Textarea
              ref={inputRef}
              onSelect={trackCaret}
              onScroll={syncChips}
              onPaste={attachments.onPaste}
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (completeKey(e)) return;
                if (e.metaKey && e.key === "Enter") {
                  e.preventDefault();
                  runCustom();
                }
              }}
              aria-label={t("agents.customLabel")}
              placeholder={t("agents.customPlaceholder")}
              className={cn(NEW_TASK_FIELD, "relative text-transparent caret-foreground")}
            />
          </div>
          <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
            <AttachButton attachments={attachments} />
            <AgentMenu />
            <RunSettingsBar agent={preferredAgent} canIsolate />
            <FanOutMenu value={fanOut} onChange={setFanOut} />
            <Button
              size="icon-sm"
              aria-label={t("agents.run")}
              disabled={(!prompt.trim() && attachments.items.length === 0) || starting || attachments.saving}
              onClick={runCustom}
              className="ml-auto size-8 rounded-full"
            >
              {starting ? <BrailleLoader /> : <ArrowUp className="size-4" />}
            </Button>
          </div>
        </div>
        <p className="mt-2 px-1 text-[12px] text-muted-foreground">{t("agents.modeHint")}</p>
        <h2 className="mt-10 mb-1.5 px-1 text-[12px] font-medium text-muted-foreground">{t("agents.suggestions")}</h2>
        <ul className="space-y-px">
          {presets.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={starting}
                onClick={() => void run(p.task, p.title)}
                className="group/preset flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:enabled:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md border border-white/[0.08] bg-white/[0.03]">
                  <p.Icon aria-hidden className="size-3.5 text-primary" />
                </span>
                <span className="min-w-0 flex-1 text-[13.5px]">{t(p.label)}</span>
                <span className="max-w-[45%] truncate text-[12.5px] text-muted-foreground">{p.hint}</span>
                <ArrowRight
                  aria-hidden
                  className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/preset:opacity-100"
                />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Page>
  );
}

/** Everything said in a conversation: the runs of one thread, oldest first. */
function useThread(thread: string) {
  // Only this thread's runs: a step streamed into another conversation doesn't re-render this one.
  const runs = useAgentsStore(useShallow((s) => s.runs.filter((r) => r.thread === thread)));
  return threadRuns(runs, thread);
}

function continueIn(repoPath: string, agent: AgentKind, thread: string, resume: string | null) {
  return (message: string, images: string[]) =>
    void startAgentRun(
      repoPath,
      agent,
      { kind: "custom", prompt: message },
      message.slice(0, 80),
      { resume, thread },
      images,
    );
}

/** Stops a running agent (its whole process group); shown in the header while it works. */
function StopButton({ runId }: { runId: string }) {
  const t = useT();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void gitBackend.cancelAgentRun(runId)}
      className="h-7 gap-1.5 rounded-full border-removed/40 text-[12.5px] text-removed-foreground hover:bg-removed/15 hover:text-removed-foreground"
    >
      <Square aria-hidden className="size-3 fill-current" />
      {t("agents.stop")}
    </Button>
  );
}

function RunView({ repoPath, run }: { repoPath: string; run: AgentRun }) {
  const t = useT();
  const runs = useThread(run.thread);
  // Primitives from here on: a streamed step replaces the run objects, the header and composer stay put.
  const liveId = runs.find((r) => r.status === "running")?.id ?? null;
  const resume = [...runs].reverse().find((r) => r.sessionId)?.sessionId ?? null;
  const status = liveId ? "running" : (runs[runs.length - 1]?.status ?? run.status);
  const agentName = run.agent === "claude" ? "Claude Code" : "Codex";
  const { tokens, window, cost } = threadUsage(runs, run.agent);
  const onStop = liveId ? () => void gitBackend.cancelAgentRun(liveId) : undefined;
  // Its own memo: the compiler would otherwise rebuild it with everything derived from `runs`, at every step.
  const onSend = useMemo(
    () => (resume ? continueIn(repoPath, run.agent, run.thread, resume) : undefined),
    [repoPath, run.agent, run.thread, resume],
  );
  return (
    <>
      <PanelHeader className="gap-2">
        <StatusIcon status={status} />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{run.title}</h2>
        <span className="text-[12px] text-muted-foreground">{agentName}</span>
        {liveId && <StopButton runId={liveId} />}
      </PanelHeader>
      {run.worktree && <WorktreeBar repoPath={repoPath} worktree={run.worktree} title={run.title} running={!!liveId} />}
      <ChatThread
        steps={runs.flatMap((r) => r.steps)}
        running={!!liveId}
        agentLabel={agentName}
        settings={
          <>
            <RunSettingsBar agent={run.agent} />
            <UsageRing tokens={tokens} window={window} cost={cost} />
          </>
        }
        onStop={onStop}
        onSend={onSend}
      />
      {!resume && !liveId && <p className="sr-only">{t("agents.cannotContinue")}</p>}
    </>
  );
}

/** Context and cost of an imported session, from its transcript (follow-ups are appended to it). */
function useSessionUsage(repoPath: string, id: string, followUps: AgentRun[]) {
  const data = useQuery({
    queryKey: ["session-usage", repoPath, id],
    queryFn: () => gitBackend.getSessionUsage(repoPath, id),
    refetchInterval: 15_000,
  }).data;
  const live = threadUsage(followUps, "claude"); // fresher while a follow-up runs
  const costs = data?.byModel.map((m) => costOf(m.model, m.tokens)).filter((c): c is number => c !== null) ?? [];
  return {
    tokens: live.tokens ?? data?.contextTokens ?? null,
    window: contextWindowOf(data?.model ?? null) ?? live.window,
    cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
  };
}

function SessionView({ repoPath, id }: { repoPath: string; id: string }) {
  const t = useT();
  const steps = useQuery({
    queryKey: ["agent-session", repoPath, id],
    queryFn: () => gitBackend.getAgentSession(repoPath, id),
    refetchInterval: 15_000, // a session still in use keeps growing
  });
  const thread = `session:${id}`;
  const followUps = useThread(thread);
  const liveId = followUps.find((r) => r.status === "running")?.id ?? null;
  const resume = [...followUps].reverse().find((r) => r.sessionId)?.sessionId ?? id;
  const title = useQuery({
    queryKey: ["agent-sessions", repoPath],
    enabled: false,
    queryFn: () => gitBackend.listAgentSessions(repoPath),
  }).data?.find((s) => s.id === id)?.title;
  const { tokens, window, cost } = useSessionUsage(repoPath, id, followUps);
  const onStop = liveId ? () => void gitBackend.cancelAgentRun(liveId) : undefined;
  const onSend = useMemo(() => continueIn(repoPath, "claude", thread, resume), [repoPath, thread, resume]);
  if (steps.isError)
    return (
      <DataUnavailable title={t("agents.sessionError")} error={steps.error} onRetry={() => void steps.refetch()} />
    );
  if (!steps.data) return <PanelLoading title={t("agents.loadingSession")} variant="grid-snake" />;
  return (
    <>
      <PanelHeader className="gap-2">
        <ClaudeIcon className="size-3.5 text-[#d97757]" />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{title ?? id}</h2>
        <span className="text-[12px] text-muted-foreground">{t.plural("agents.steps", steps.data.length)}</span>
        {liveId && <StopButton runId={liveId} />}
      </PanelHeader>
      <ChatThread
        steps={[...steps.data, ...unsavedFollowUps(steps.data, followUps).flatMap((r) => r.steps)]}
        running={!!liveId}
        agentLabel="Claude Code"
        settings={
          <>
            <RunSettingsBar agent="claude" />
            <UsageRing tokens={tokens} window={window} cost={cost} />
          </>
        }
        onStop={onStop}
        onSend={onSend}
      />
    </>
  );
}

function duration(start: string, end: string): string {
  const seconds = Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s` : `${Math.round(seconds)}s`;
}

function Job({ job }: { job: WorkflowJob }) {
  const done = job.status === "completed" && job.completedAt;
  return (
    <section className="rounded-xl border border-white/8 bg-card">
      <h3 className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5 text-[13.5px] font-medium">
        <StatusIcon status={ghStatus(job.status, job.conclusion)} />
        <span className="min-w-0 flex-1 truncate">{job.name}</span>
        {done && (
          <span className="text-[12px] font-normal text-muted-foreground">
            {duration(job.startedAt, job.completedAt)}
          </span>
        )}
      </h3>
      <ol className="px-2 py-1.5">
        {job.steps.map((step) => (
          <li key={step.number} className="flex items-center gap-2.5 rounded-md px-2 py-1 text-[13px]">
            <StatusIcon status={ghStatus(step.status, step.conclusion)} />
            <span className={cn("truncate", step.conclusion === "skipped" && "text-muted-foreground")}>
              {step.name}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function WorkflowView({ repoPath, id }: { repoPath: string; id: number }) {
  const t = useT();
  const run = useQuery({
    queryKey: ["workflow-run", repoPath, id],
    queryFn: () => gitBackend.getWorkflowRun(repoPath, id),
    refetchInterval: (q) => (q.state.data?.status === "completed" ? false : 5_000),
  });
  if (run.isError)
    return <DataUnavailable title={t("agents.actionsError")} error={run.error} onRetry={() => void run.refetch()} />;
  if (!run.data) return <PanelLoading title={t("agents.loadingRun")} variant="grid-syncing" />;
  const data = run.data;
  return (
    <Page
      header={
        <>
          <StatusIcon status={ghStatus(data.status, data.conclusion)} />
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{data.displayTitle}</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void gitBackend.openGithubUrl(data.url)}
            className="h-6 gap-1 text-[12.5px] text-muted-foreground"
          >
            <ExternalLink aria-hidden className="size-3" />
            GitHub
          </Button>
        </>
      }
    >
      <p className="mt-2 mb-4 text-[13px] text-muted-foreground">
        {data.workflowName} · {data.headBranch} · {data.event} · {formatCommitDate(data.createdAt, undefined, t.locale)}
      </p>
      <div className="space-y-3">
        {(data.jobs ?? []).map((job) => (
          <Job key={job.url || job.name} job={job} />
        ))}
      </div>
    </Page>
  );
}

/** Main panel of the Agents view. */
export function AgentDetail({ repoPath }: { repoPath: string }) {
  const t = useT();
  const selection = useAgentsStore((s) => s.selection);
  const run = useAgentsStore((s) => (selection.type === "run" ? s.runs.find((r) => r.id === selection.id) : undefined));
  return (
    <section aria-label={t("agents.title")} className="flex h-full flex-col">
      {selection.type === "run" && run ? (
        <RunView repoPath={repoPath} run={run} />
      ) : selection.type === "session" ? (
        <SessionView key={selection.id} repoPath={repoPath} id={selection.id} />
      ) : selection.type === "definition" ? (
        <AgentDefinitionEditor key={`${selection.scope}:${selection.name}`} repoPath={repoPath} target={selection} />
      ) : selection.type === "new-definition" ? (
        <AgentDefinitionEditor key="new" repoPath={repoPath} target={null} />
      ) : selection.type === "usage" ? (
        <UsageView repoPath={repoPath} />
      ) : selection.type === "board" ? (
        <ParallelBoard repoPath={repoPath} />
      ) : selection.type === "workflow" ? (
        <WorkflowView key={selection.id} repoPath={repoPath} id={selection.id} />
      ) : (
        <Composer repoPath={repoPath} />
      )}
    </section>
  );
}
