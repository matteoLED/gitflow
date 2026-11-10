import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  FileText,
  GitCommitHorizontal,
  GitPullRequest,
  Globe,
  History,
  ListChecks,
  Bot,
  Maximize2,
  MessageSquarePlus,
  Sparkles,
  X,
} from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT, type MessageKey } from "@/i18n";
import { gitBackend } from "@/lib/tauri-git";
import { formatAge } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { useAgentsStore, threadRuns, unsavedFollowUps, type AgentRun } from "@/stores/agents-store";
import { runOf, usePreviewStore } from "@/stores/preview-store";
import { useUiStore, type CodeSelection } from "@/stores/ui-store";
import { editorOf, useEditorStore } from "@/stores/editor-store";
import { FileIcon } from "@/components/file-icon";
import { selectionPrompt } from "@/features/editor/AskAgent";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { usePreviewTargets } from "@/features/preview/PreviewList";
import { pickAgent } from "./AgentButton";
import { LinearIcon } from "@/features/linear/LinearIcon";
import { useOpenIssue } from "@/features/linear/linear-queries";
import { ContextMeter } from "./ContextMeter";
import { RunSettingsBar } from "./RunSettingsBar";
import { ClaudeIcon, CodexIcon } from "./agent-icons";
import { ChatThread, CONTEXT_SEPARATOR } from "./ChatThread";
import { startAgentRun, useInstalledAgents } from "./use-agents";

/** Keeps prompts under the agents' 20,000-character limit. */
const clipText = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n…` : text);

type Chip = { kind: "preview" | "pr" | "commit" | "issue" | "file"; icon: ReactNode; label: string; detail: string };

/** What the user is looking at right now, as chips for them and as plain facts for the agent. */
function useContextChips(repoPath: string): Chip[] {
  const { view, pullRequest, selectedCommitHash, compareBase } = useWorkspaceStore();
  const { runs, selected } = usePreviewStore();
  const targets = usePreviewTargets(repoPath).data ?? [];
  const chips: Chip[] = [];
  const issue = useOpenIssue().data;
  const file = useEditorStore((s) => editorOf(s, repoPath).active);
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
  if (view === "editor" && file) {
    chips.push({
      kind: "file",
      icon: <FileIcon path={file} className="size-3" />,
      label: file.slice(file.lastIndexOf("/") + 1),
      detail: `The user has ${file} open in the editor.`,
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
      detail: `The user is looking at the Linear issue ${issue.identifier} "${issue.title}" (status ${issue.state.name}, team ${issue.team.name}${issue.project ? `, project ${issue.project.name}` : ""}). Its branch name is ${issue.branchName}. Description:\n${clipText(issue.description ?? "(none)", 4_000)}`,
    });
  }
  return chips;
}

/** Code attached from the editor (⌘L), as a card above the message: Arc/Dia's page card for a selection. */
function SelectionCard({ selection, onRemove }: { selection: CodeSelection; onRemove: () => void }) {
  const t = useT();
  const name = selection.path.slice(selection.path.lastIndexOf("/") + 1);
  const lines =
    selection.to > selection.from
      ? t("assistant.lines", { from: selection.from, to: selection.to })
      : t("assistant.line", { line: selection.from });
  return (
    <div
      title={`${selection.path}\n\n${selection.code}`}
      className="group/card relative flex max-w-[260px] items-center gap-2.5 rounded-xl bg-white/[0.06] py-1.5 pr-3 pl-1.5"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-black/40">
        <FileIcon path={selection.path} className="size-4" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[12.5px] text-foreground">{name}</span>
        <span className="block truncate text-[11.5px] text-muted-foreground">{lines}</span>
      </span>
      <button
        type="button"
        aria-label={t("assistant.removeSelection")}
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-popover text-muted-foreground opacity-0 shadow ring-1 ring-white/10 group-hover/card:opacity-100 hover:text-foreground focus-visible:opacity-100"
      >
        <X className="size-2.5" />
      </button>
    </div>
  );
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

type Conversation = { thread: string; title: string; last: string; assistant: boolean; running: boolean };

/** One entry per conversation of the repository (assistant chats and agent tasks), latest activity first. */
export function conversationsOf(runs: readonly AgentRun[], repoPath: string): Conversation[] {
  const byThread = new Map<string, AgentRun[]>();
  for (const run of runs) {
    if (run.repoPath !== repoPath) continue;
    byThread.set(run.thread, [...(byThread.get(run.thread) ?? []), run]);
  }
  return [...byThread]
    .map(([thread, list]) => {
      const sorted = [...list].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      const first = sorted[0];
      const prompt = first.task?.kind === "custom" ? first.task.prompt : "";
      return {
        thread,
        title: first.title,
        last: sorted[sorted.length - 1].startedAt,
        assistant: prompt.includes(CONTEXT_SEPARATOR),
        running: list.some((r) => r.status === "running"),
      };
    })
    .sort((a, b) => b.last.localeCompare(a.last));
}

const PAGE = 30;
type Entry = Conversation & { session: boolean };

/** Previous conversations, to pick one back up: the app's own, then older Claude Code sessions as you scroll. */
function HistoryMenu({ repoPath, current }: { repoPath: string; current: string | null }) {
  const t = useT();
  const runs = useAgentsStore((s) => s.runs);
  const setAssistantThread = useAgentsStore((s) => s.setAssistantThread);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const sessions = useInfiniteQuery({
    queryKey: ["agent-sessions-page", repoPath],
    queryFn: ({ pageParam }) => gitBackend.listAgentSessionsPage(repoPath, pageParam, PAGE),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length < PAGE ? undefined : pages.length * PAGE),
    enabled: open,
    staleTime: 30_000,
  });
  const entries = useMemo(() => {
    const own: Entry[] = conversationsOf(runs, repoPath).map((c) => ({ ...c, session: false }));
    // A session continued from the app is already listed as that conversation.
    const known = new Set(runs.filter((r) => r.repoPath === repoPath).map((r) => r.sessionId));
    const past: Entry[] = (sessions.data?.pages.flat() ?? [])
      .filter((s) => !known.has(s.id))
      .map((s) => ({
        // Codex sessions carry their agent in the thread, so the follow-up resumes them with Codex.
        thread: s.agent === "codex" ? `session:codex:${s.id}` : `session:${s.id}`,
        title: s.title,
        last: s.updatedAt ?? s.startedAt ?? "",
        assistant: false,
        running: false,
        session: true,
      }));
    return [...own, ...past].sort((a, b) => b.last.localeCompare(a.last));
  }, [runs, repoPath, sessions.data]);
  const needle = query.trim().toLowerCase();
  const shown = needle ? entries.filter((c) => c.title.toLowerCase().includes(needle)) : entries;

  // Infinite scroll: reaching the end of the list loads the next page (also while a search narrows it).
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = sessions;
  const sentinel = useCallback(
    (node: HTMLLIElement | null) => {
      if (!node) return;
      const observer = new IntersectionObserver((seen) => {
        if (seen.some((e) => e.isIntersecting) && hasNextPage && !isFetchingNextPage) void fetchNextPage();
      });
      observer.observe(node);
      return () => observer.disconnect();
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("assistant.history")}
              className="size-7 text-muted-foreground data-[state=open]:bg-white/[0.08] data-[state=open]:text-foreground"
            >
              <History />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("assistant.history")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" sideOffset={6} className="w-80 overflow-hidden rounded-xl p-0 shadow-2xl">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("assistant.historyFilter")}
          aria-label={t("assistant.historyFilter")}
          className="h-10 w-full border-b border-white/[0.07] bg-transparent px-3.5 text-[13px] outline-none placeholder:text-muted-foreground"
        />
        <ul className="max-h-[420px] overflow-y-auto p-1">
          {shown.length === 0 && !sessions.isFetching && (
            <li className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">{t("assistant.historyEmpty")}</li>
          )}
          {shown.map((c) => (
            <li key={c.thread}>
              <button
                type="button"
                onClick={() => {
                  setAssistantThread(c.thread);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-white/[0.06]",
                  c.thread === current && "bg-white/[0.06]",
                )}
              >
                {c.running ? (
                  <BrailleLoader className="shrink-0 text-primary" />
                ) : c.session && c.thread.startsWith("session:codex:") ? (
                  <CodexIcon className="size-3.5 shrink-0" />
                ) : c.session ? (
                  <ClaudeIcon className="size-3.5 shrink-0 text-[#d97757]" />
                ) : c.assistant ? (
                  <Sparkles aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <Bot aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">{c.title || t("assistant.untitled")}</span>
                {c.last && (
                  <span className="shrink-0 text-[11.5px] text-muted-foreground">
                    {formatAge(c.last, undefined, t.locale)}
                  </span>
                )}
              </button>
            </li>
          ))}
          {hasNextPage && <li ref={sentinel} className="h-1" />}
          {sessions.isFetching && (
            <li className="flex justify-center py-2">
              <BrailleLoader className="text-primary" />
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Side-panel assistant (⌘I), like a browser's AI sidebar: it stays next to the preview, a diff or the
 * history, and knows what's on screen. Read-only, through the user's own Claude Code / Codex.
 */
const WIDTH_KEY = "gitflow.assistantWidth";
const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 320;
const clampWidth = (width: number) => Math.round(Math.min(Math.max(width, MIN_WIDTH), window.innerWidth - 360));
const storedWidth = () => clampWidth(Number(localStorage.getItem(WIDTH_KEY)) || DEFAULT_WIDTH);

/** The panel's left edge: drag to widen the chat, double-click to bring it back to its default width. */
function ResizeEdge({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const t = useT();
  const save = (value: number) => localStorage.setItem(WIDTH_KEY, String(value));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("assistant.resize")}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const start = width;
        let last = start;
        const move = (ev: PointerEvent) => {
          last = clampWidth(start + startX - ev.clientX);
          onResize(last);
        };
        const up = () => {
          save(last);
          document.body.style.cursor = "";
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        document.body.style.cursor = "col-resize";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      onDoubleClick={() => {
        onResize(DEFAULT_WIDTH);
        save(DEFAULT_WIDTH);
      }}
      onKeyDown={(e) => {
        const step = e.key === "ArrowLeft" ? 40 : e.key === "ArrowRight" ? -40 : 0;
        if (!step) return;
        e.preventDefault();
        const next = clampWidth(width + step);
        onResize(next);
        save(next);
      }}
      className="group absolute inset-y-0 left-0 z-10 w-2 -translate-x-1 cursor-col-resize outline-none"
    >
      <span className="absolute inset-y-[45px] left-1/2 w-px -translate-x-1/2 bg-primary/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </div>
  );
}

export function AssistantPanel({ repoPath }: { repoPath: string }) {
  const [width, setWidth] = useState(storedWidth);
  const t = useT();
  const setOpen = useUiStore((s) => s.setAssistantOpen);
  const { runs, assistantThread, setAssistantThread, preferredAgent, select } = useAgentsStore();
  const installed = useInstalledAgents().data;
  const past = assistantThread?.startsWith("session:") ? assistantThread.slice(8) : null;
  const pastCodex = !!past?.startsWith("codex:");
  const pastSession = pastCodex ? (past?.slice(6) ?? null) : past;
  const agent = pastSession ? (pastCodex ? "codex" : "claude") : pickAgent(installed, preferredAgent);
  const chips = useContextChips(repoPath);
  const askSelection = useUiStore((s) => s.askSelection);
  const suggestions = useSuggestions(chips);
  const repo = useWorkspaceStore((s) => s.repo);
  const view = useWorkspaceStore((s) => s.view);
  const [sending, setSending] = useState(false);
  const thread = assistantThread ? threadRuns(runs, assistantThread) : [];
  const live = thread.find((r) => r.status === "running");
  const resume = [...thread].reverse().find((r) => r.sessionId)?.sessionId ?? pastSession ?? null;
  // A Claude Code session picked from the history: its past turns, then what was said here since.
  const sessionSteps = useQuery({
    queryKey: ["agent-session", repoPath, pastSession],
    queryFn: () => gitBackend.getAgentSession(repoPath, pastSession ?? ""),
    enabled: !!pastSession,
  });
  const agentName = agent === "codex" ? "Codex" : "Claude Code";

  const send = async (message: string, images: string[] = []) => {
    if (!agent || sending) return;
    setSending(true);
    let prompt = message;
    // A slash command must open the message for Claude Code to run it: no context preamble then.
    if ((!assistantThread || !resume) && !message.startsWith("/")) {
      // First message: say where the user is. Later ones continue the same conversation.
      const page = view === "preview" ? await gitBackend.previewViewUrl().catch(() => null) : null;
      const facts = [
        `Context from gitflow, the user's Git client: repository ${repo?.name} at ${repoPath}.`,
        ...chips.map((c) => c.detail),
        page ? `The page currently shown is ${page}.` : null,
      ].filter(Boolean);
      prompt = `${facts.join("\n")}${CONTEXT_SEPARATOR}${message}`;
    }
    if (askSelection) prompt = `${prompt}\n\n${selectionPrompt(askSelection)}`;
    const id = await startAgentRun(
      repoPath,
      agent,
      { kind: "custom", prompt },
      message.slice(0, 80),
      assistantThread ? { resume, thread: assistantThread } : undefined,
      images,
    );
    // Kept when the run couldn't start (e.g. too long a prompt): the user can trim and resend.
    if (id && askSelection) useUiStore.getState().askAbout(null);
    if (id && !assistantThread) setAssistantThread(id);
    setSending(false);
  };

  return (
    <div data-tauri-drag-region className="relative flex h-full shrink-0 pt-[45px] pr-1.5 pb-1.5">
      <ResizeEdge width={width} onResize={setWidth} />
      <aside
        aria-label={t("assistant.title")}
        style={{ width }}
        className="flex h-full flex-col overflow-hidden rounded-[10px] border border-white/[0.06] bg-background shadow-[0_1px_3px_rgb(0_0_0/0.35)]"
      >
        <header
          data-tauri-drag-region
          className="flex h-[46px] shrink-0 items-center gap-1 border-b border-white/[0.06] px-3"
        >
          <Sparkles aria-hidden className="size-4 text-primary" />
          <h2 className="mr-auto pl-1 text-[13px] font-medium">{t("assistant.title")}</h2>
          <HistoryMenu repoPath={repoPath} current={assistantThread} />
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
          placeholder={askSelection ? t("assistant.askCode") : assistantThread ? undefined : t("assistant.placeholder")}
          steps={[
            ...(sessionSteps.data ?? []),
            ...unsavedFollowUps(sessionSteps.data ?? [], thread).flatMap((r) => r.steps),
          ]}
          running={!!live || sending}
          agentLabel={agentName}
          settings={
            agent && (
              <>
                <RunSettingsBar agent={agent} canIsolate={!assistantThread} />
                <ContextMeter runs={thread} agent={agent} />
              </>
            )
          }
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
          focusKey={askSelection}
          context={
            (askSelection || !assistantThread) && [
              askSelection && (
                <SelectionCard
                  key="selection"
                  selection={askSelection}
                  onRemove={() => useUiStore.getState().askAbout(null)}
                />
              ),
              ...(assistantThread ? [] : chips)
                // The card already names the file the code comes from.
                .filter((chip) => !(askSelection && chip.kind === "file"))
                .map((chip) => (
                  <span
                    key={chip.label}
                    className="flex items-center gap-1 rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[11.5px] text-foreground/90"
                  >
                    {chip.icon}
                    {chip.label}
                  </span>
                )),
            ]
          }
        />
      </aside>
    </div>
  );
}

export default AssistantPanel;
