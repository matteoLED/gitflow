import { lazy, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { shallow } from "zustand/shallow";
import { useComposerMenu } from "./ComposerMenu";
import {
  ArrowUp,
  Brain,
  ChevronRight,
  CircleCheck,
  CircleX,
  FileText,
  GitFork,
  Globe,
  MessagesSquare,
  Pencil,
  Search,
  Square,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { AttachButton, AttachmentStrip, SentImages, splitImages, useAttachments } from "./attachments";
import { countByCategory, toChat, type ChatItem, type ToolCall, type ToolCategory } from "./steps-model";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { useKnownRefs } from "@/features/refs/use-known-refs";
import { cn } from "@/lib/utils";
import type { AgentStep } from "@/types/git";

const Markdown = lazy(() => import("./Markdown"));
const AgentGraph = lazy(() => import("./AgentGraph"));

const TOOL_ICONS: Record<ToolCategory, typeof Wrench> = {
  read: FileText,
  search: Search,
  command: SquareTerminal,
  edit: Pencil,
  web: Globe,
  other: Wrench,
};

const CATEGORY_TONE: Record<ToolCategory, string> = {
  read: "text-sky-300/80",
  search: "text-violet-300/80",
  command: "text-amber-300/80",
  edit: "text-added-foreground",
  web: "text-teal-300/80",
  other: "text-muted-foreground",
};

function Detail({ text }: { text: string }) {
  return (
    <pre className="mt-1 mb-2 ml-6 max-h-72 overflow-auto rounded-lg border border-white/8 bg-black/25 p-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap select-text">
      {text}
    </pre>
  );
}

// Memoized like every transcript entry below: a streamed step re-renders only what it changed, not the whole
// conversation (toChat rebuilds the call objects, hence the field-by-field comparison).
const CallRow = memo(
  function CallRow({ call }: { call: ToolCall }) {
    const [open, setOpen] = useState(false);
    const Icon = call.failed ? CircleX : TOOL_ICONS[call.category];
    return (
      <li className="[content-visibility:auto]">
        <button
          type="button"
          disabled={!call.detail}
          onClick={() => setOpen((o) => !o)}
          className="group/call flex w-full items-center gap-2 rounded-md px-2 py-[3px] text-left text-[12.5px] outline-none hover:enabled:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon
            aria-hidden
            className={cn("size-3.5 shrink-0", call.failed ? "text-removed-foreground" : CATEGORY_TONE[call.category])}
          />
          <span className="w-12 shrink-0 text-muted-foreground">{call.tool}</span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-mono text-[12px] text-foreground/85",
              call.failed && "text-removed-foreground/90",
            )}
          >
            {call.target || "…"}
          </span>
          {call.repeat > 1 && (
            <span className="shrink-0 rounded bg-white/[0.06] px-1.5 text-[11px] text-muted-foreground">
              ×{call.repeat}
            </span>
          )}
          {call.detail && (
            <ChevronRight
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover/call:opacity-100",
                open && "rotate-90 opacity-100",
              )}
            />
          )}
        </button>
        {open && call.detail && <Detail text={call.detail} />}
      </li>
    );
  },
  (a, b) => shallow(a.call, b.call),
);

/** A run of tool calls as one line ("4 commands · 3 files read · 1 error"), unfolded on demand. */
const sameCalls = (a: ToolCall[], b: ToolCall[]) => a.length === b.length && a.every((c, i) => shallow(c, b[i]));
const sameItem = (a: ChatItem, b: ChatItem) =>
  a.type === "tools" && b.type === "tools" ? a.key === b.key && sameCalls(a.calls, b.calls) : shallow(a, b);

const ToolGroup = memo(
  function ToolGroup({ calls, live }: { calls: ToolCall[]; live: boolean }) {
    const t = useT();
    const counts = countByCategory(calls);
    const [open, setOpen] = useState<boolean | null>(null);
    // Short groups and the one being written stay open; long finished ones fold.
    const expanded = open ?? (live || calls.length <= 3);
    const parts = (["read", "search", "command", "edit", "web", "other"] as const)
      .filter((c) => counts[c] > 0)
      .map((c) => ({ c, label: t.plural(`agents.cat.${c}`, counts[c]) }));
    return (
      <div className="my-1.5 rounded-lg border border-white/[0.06] bg-card">
        <button
          type="button"
          onClick={() => setOpen(!expanded)}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-90")} />
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
            {parts.map(({ c, label }) => {
              const Icon = TOOL_ICONS[c];
              return (
                <span key={c} className="flex items-center gap-1">
                  <Icon aria-hidden className={cn("size-3.5", CATEGORY_TONE[c])} />
                  {label}
                </span>
              );
            })}
            {counts.failed > 0 && (
              <span className="flex items-center gap-1 text-removed-foreground">
                <CircleX aria-hidden className="size-3.5" />
                {t.plural("agents.cat.failed", counts.failed)}
              </span>
            )}
          </span>
          {live && <BrailleLoader className="text-primary" />}
        </button>
        {expanded && (
          <ul className="px-1 pb-1.5">
            {calls.map((call) => (
              <CallRow key={call.key} call={call} />
            ))}
          </ul>
        )}
      </div>
    );
  },
  (a, b) => a.live === b.live && sameCalls(a.calls, b.calls),
);

/** The user's request: long ones (with the app's instructions) are clamped. */
const Prompt = memo(function Prompt({ text }: { text: string }) {
  const t = useT();
  const { text: withoutImages, images } = splitImages(text);
  const typed = typedText(withoutImages);
  const long = typed.split("\n").length > 4 || typed.length > 360;
  const [open, setOpen] = useState(false);
  return (
    <div className="my-4 ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-white/[0.06] px-3.5 py-2.5 text-[13.5px]">
      <p className={cn("whitespace-pre-wrap select-text", long && !open && "line-clamp-4")}>{typed}</p>
      <SentImages count={images.length} />
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          {open ? t("agents.showLess") : t("agents.showMore")}
        </button>
      )}
    </div>
  );
});

const Thinking = memo(function Thinking({ step }: { step: AgentStep }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        disabled={!step.detail}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left text-[12.5px] text-muted-foreground italic hover:enabled:text-foreground"
      >
        <Brain aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{step.title}</span>
      </button>
      {open && step.detail && <Detail text={step.detail} />}
    </div>
  );
});

/** An agent's reply: the repository's PRs, issues and commits it names preview on hover. */
const AgentMessage = memo(function AgentMessage({ text }: { text: string }) {
  const repoPath = useWorkspaceStore((s) => s.repo?.path ?? null);
  return repoPath ? <LinkedMessage text={text} repoPath={repoPath} /> : <Markdown text={text} />;
});

function LinkedMessage({ text, repoPath }: { text: string; repoPath: string }) {
  const { known } = useKnownRefs(repoPath);
  return <Markdown text={text} refs={{ repoPath, known }} />;
}

const Entry = memo(
  function Entry({ item, live }: { item: ChatItem; live: boolean }) {
    switch (item.type) {
      case "prompt":
        return <Prompt text={item.text} />;
      case "message":
        return (
          <div className="px-2 py-1.5 text-[14px]">
            <Suspense fallback={<p className="whitespace-pre-wrap">{item.text}</p>}>
              <AgentMessage text={item.text} />
            </Suspense>
          </div>
        );
      case "thinking":
        return <Thinking step={item.step} />;
      case "tools":
        return <ToolGroup calls={item.calls} live={live} />;
      case "result":
        return (
          <p
            className={cn(
              "mx-2 mt-1 mb-4 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px]",
              item.failed ? "border-removed/40 text-removed-foreground" : "border-white/[0.08] text-muted-foreground",
            )}
          >
            {item.failed ? (
              <CircleX aria-hidden className="size-3" />
            ) : (
              <CircleCheck aria-hidden className="size-3 text-added-foreground" />
            )}
            {item.text}
          </p>
        );
      case "error":
        return (
          <p className="mx-2 my-1.5 flex items-start gap-2 rounded-lg border border-removed/30 bg-removed/10 px-2.5 py-1.5 text-[12.5px] text-removed-foreground">
            <CircleX aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 whitespace-pre-wrap select-text">
              {item.step.detail ?? item.step.title}
            </span>
          </p>
        );
    }
  },
  (a, b) => a.live === b.live && sameItem(a.item, b.item),
);

/** What the user typed, without the context and instructions the app added around it. */
export const CONTEXT_SEPARATOR = "\n\n---\n";
function typedText(prompt: string): string {
  const afterContext = prompt.includes(CONTEXT_SEPARATOR)
    ? prompt.slice(prompt.lastIndexOf(CONTEXT_SEPARATOR) + CONTEXT_SEPARATOR.length)
    : prompt;
  return afterContext.replace(
    /\n\n(Do not modify, create or delete any file|Answer in (French|English)\.)[\s\S]*$/,
    "",
  );
}

type ChatThreadProps = {
  steps: AgentStep[];
  running: boolean;
  /** Absent when the conversation can't be continued (no session id yet, or an agent that can't resume). */
  onSend?: (message: string, images: string[]) => void;
  onStop?: () => void;
  agentLabel: string;
  /** Shown instead of the transcript before the first message. */
  empty?: React.ReactNode;
  /** Chips above the composer: what the agent will be told about. */
  context?: React.ReactNode;
  /** Narrow layout for the side panel. */
  compact?: boolean;
  placeholder?: string;
  /** Mode / model / effort pickers shown under the message. */
  settings?: React.ReactNode;
  /** The composer takes the focus whenever this changes (e.g. code just attached from the editor). */
  focusKey?: unknown;
};

/** Conversation view, like Zed's agent panel: transcript on top, a composer to keep going at the bottom. */
const COMPOSER_FIELD =
  "field-sizing-content max-h-48 min-h-[60px] resize-none rounded-none border-0 bg-transparent px-3.5 pt-3 pb-0 text-[14px] leading-[1.45] shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0 md:text-[14px] dark:bg-transparent";

export function ChatThread({
  steps,
  running,
  onSend,
  onStop,
  agentLabel,
  empty,
  context,
  compact = false,
  placeholder,
  settings,
  focusKey,
}: ChatThreadProps) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const root = useWorkspaceStore((s) => s.repo?.path ?? null);
  const items = useMemo(() => toChat(steps, root), [steps, root]);
  const [mode, setMode] = useState<"chat" | "graph">("chat");
  const attachments = useAttachments();

  // Follows new steps while the user is at the bottom; leaves them alone once they scroll up.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [steps.length]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => (stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Esc stops the agent while it works, unless a menu or dialog is the one being closed.
  useEffect(() => {
    if (!running || !onStop) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[data-radix-popper-content-wrapper], [role=dialog]")) onStop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, onStop]);

  const {
    menu: completion,
    chips,
    onKeyDown: completeKey,
    onSelect: trackCaret,
    onScroll: syncChips,
    expand,
    anchor: composerRef,
    input: inputRef,
  } = useComposerMenu(root, draft, setDraft, COMPOSER_FIELD);
  const send = () => {
    const text = expand(draft.trim());
    const images = attachments.items.map((a) => a.path);
    if ((!text && images.length === 0) || running || !onSend || attachments.saving) return;
    onSend(text || t("attach.lookAtThis"), images);
    setDraft("");
    attachments.clear();
    stick.current = true;
  };
  useEffect(() => {
    if (focusKey) inputRef.current?.focus();
  }, [focusKey, inputRef]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (completeKey(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!compact && items.length > 0 && (
        <div className="flex shrink-0 justify-center pt-2">
          <div role="tablist" className="flex gap-0.5 rounded-full border border-white/[0.07] p-0.5">
            {(
              [
                ["chat", MessagesSquare, t("agents.viewChat")],
                ["graph", GitFork, t("agents.viewGraph")],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className="flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-muted-foreground hover:text-foreground aria-selected:bg-white/[0.08] aria-selected:text-foreground"
              >
                <Icon aria-hidden className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div ref={scrollRef} className={cn("min-h-0 flex-1 overflow-y-auto", compact ? "px-3" : "px-6")}>
        {mode === "graph" && !compact ? (
          <Suspense fallback={null}>
            <AgentGraph items={items} running={running} />
          </Suspense>
        ) : (
          <div className="mx-auto max-w-[780px] pt-2 pb-6">
            {items.length === 0 && !running && empty}
            {items.map((item, i) => (
              <Entry key={item.key} item={item} live={running && i === items.length - 1} />
            ))}
            {running && items[items.length - 1]?.type !== "tools" && (
              <p className="flex items-center gap-2 px-2 py-2 text-[12.5px] text-muted-foreground">
                <BrailleLoader className="text-primary" />
                {t("agents.working")}
              </p>
            )}
          </div>
        )}
      </div>
      <div className={cn("pt-1 pb-3", compact ? "px-3" : "px-6")}>
        {running && onStop && (
          <div className="mb-2 flex justify-center">
            <button
              type="button"
              onClick={onStop}
              className="flex h-7 items-center gap-1.5 rounded-full border border-white/[0.1] bg-popover px-3 text-[12.5px] text-foreground shadow-lg hover:bg-accent"
            >
              <Square aria-hidden className="size-3 fill-current" />
              {t("agents.stop")}
              <kbd className="kbd ml-1">esc</kbd>
            </button>
          </div>
        )}
        <div
          ref={composerRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={attachments.onDrop}
          className="relative mx-auto max-w-[780px] rounded-xl border border-white/[0.07] bg-[color-mix(in_oklab,var(--foreground)_5%,var(--background))] transition-colors focus-within:border-white/[0.14]"
        >
          {completion}
          {context && <div className="flex flex-wrap gap-1.5 px-2.5 pt-2.5">{context}</div>}
          <AttachmentStrip attachments={attachments} />
          <div className="relative">
            {chips}
            <Textarea
              ref={inputRef}
              onSelect={trackCaret}
              onScroll={syncChips}
              onPaste={attachments.onPaste}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={!onSend}
              aria-label={t("agents.message")}
              placeholder={onSend ? (placeholder ?? t("agents.continuePlaceholder")) : t("agents.cannotContinue")}
              className={cn(COMPOSER_FIELD, "relative text-transparent caret-foreground")}
            />
          </div>
          <div className="flex items-center gap-1.5 px-2 pt-1 pb-2">
            {onSend && <AttachButton attachments={attachments} />}
            {/* Grows so a trailing item of `settings` (the context ring) can sit by the send button. */}
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              {settings ?? <span className="text-[11.5px] text-muted-foreground">{agentLabel}</span>}
            </div>
            {running && onStop ? (
              <Button
                size="icon-sm"
                variant="secondary"
                aria-label={t("agents.stop")}
                onClick={onStop}
                className="ml-auto size-8 shrink-0 rounded-full"
              >
                <Square className="size-3" />
              </Button>
            ) : (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t("agents.send")}
                disabled={(!draft.trim() && attachments.items.length === 0) || !onSend || attachments.saving}
                onClick={send}
                // Linear's send: a quiet grey circle, brighter once there's something to send.
                className="ml-auto size-8 shrink-0 rounded-full bg-white/[0.12] text-foreground hover:bg-white/[0.18] disabled:bg-white/[0.06] disabled:text-muted-foreground disabled:opacity-100"
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
