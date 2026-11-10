import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, SquareSlash } from "lucide-react";
import { FileIcon } from "@/components/file-icon";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { fuzzyFilter } from "@/features/editor/fuzzy";
import { useT } from "@/i18n";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import {
  chipBefore,
  complete,
  expandMentions,
  mentionName,
  segments,
  triggerAt,
  matchCommands,
  type Mentions,
} from "./composer-menu";

type Item = { key: string; value: string; node: ReactNode };

/**
 * Completion in the agent composer, as in Claude Code: `/` opening the message lists custom commands and
 * skills, `@` anywhere lists the repository's files. ↑↓ to pick, ↵ or ⇥ to insert, esc to dismiss.
 * The list floats in a popover anchored to the composer, so it flips and shrinks to stay on screen.
 */
export function useComposerMenu(
  repoPath: string | null,
  draft: string,
  setDraft: (draft: string) => void,
  /** The textarea's own classes: the chips are drawn in a copy of it laid exactly under its text. */
  fieldClass: string,
) {
  const t = useT();
  const anchor = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const [mentions, setMentions] = useState<Mentions>({});
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const trigger = triggerAt(draft, Math.min(caret, draft.length));
  const commands = useQuery({
    queryKey: ["slash-commands", repoPath],
    queryFn: () => gitBackend.listSlashCommands(repoPath ?? ""),
    enabled: !!repoPath && trigger?.kind === "slash",
    staleTime: 60_000,
  });
  const files = useQuery({
    queryKey: ["files", repoPath],
    queryFn: () => gitBackend.listFiles(repoPath ?? ""),
    enabled: !!repoPath && trigger?.kind === "mention",
    staleTime: 30_000,
  });
  const items: Item[] = useMemo(() => {
    if (!trigger) return [];
    if (trigger.kind === "slash")
      return matchCommands(commands.data ?? [], trigger.query)
        .slice(0, 50)
        .map((c) => ({
          key: `${c.scope}:${c.name}`,
          value: c.name,
          node: (
            <>
              {c.skill ? (
                <Sparkles aria-hidden className="size-3.5 shrink-0 text-primary" />
              ) : (
                <SquareSlash aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="shrink-0 font-mono text-[12.5px]">/{c.name}</span>
              {c.argumentHint && (
                <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">{c.argumentHint}</span>
              )}
              <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{c.description}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground/70">
                {t(c.scope === "project" ? "slash.project" : "slash.user")}
              </span>
            </>
          ),
        }));
    return fuzzyFilter(trigger.query, files.data ?? [], 40).map((path) => {
      const slash = path.lastIndexOf("/");
      return {
        key: path,
        value: path,
        node: (
          <>
            <FileIcon path={path} className="size-3.5 shrink-0" />
            <span className="shrink-0 text-[12.5px]">{path.slice(slash + 1)}</span>
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
              {path.slice(0, Math.max(slash, 0))}
            </span>
          </>
        ),
      };
    });
  }, [commands.data, files.data, t, trigger]);
  const open = !!trigger && dismissed !== draft && items.length > 0;
  const current = Math.min(index, items.length - 1);

  const pick = (item: Item) => {
    if (!trigger) return;
    let value = item.value;
    if (trigger.kind === "mention") {
      value = mentionName(item.value, mentions);
      setMentions({ ...mentions, [value]: item.value });
    }
    const [next, at] = complete(draft, caret, trigger, value);
    setDraft(next);
    setIndex(0);
    setCaret(at);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(at, at);
    });
  };
  const moveCaret = (at: number) =>
    requestAnimationFrame(() => {
      input.current?.setSelectionRange(at, at);
      setCaret(at);
    });
  const onKeyDown = (e: KeyboardEvent): boolean => {
    const field = input.current;
    if (e.key === "Backspace" && field && field.selectionStart === field.selectionEnd) {
      const start = chipBefore(draft, field.selectionStart, mentions);
      if (start !== null) {
        e.preventDefault();
        setDraft(draft.slice(0, start) + draft.slice(field.selectionStart));
        moveCaret(start);
        return true;
      }
    }
    if (!open) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((current + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
      return true;
    }
    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
      e.preventDefault();
      pick(items[current]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setDismissed(draft);
      return true;
    }
    return false;
  };

  const menu = (
    <Popover open={open} onOpenChange={(next) => !next && setDismissed(draft)}>
      <PopoverAnchor virtualRef={anchor as RefObject<HTMLElement>} />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // Clicks in the composer keep typing; only a click elsewhere closes the list.
        onInteractOutside={(e) => anchor.current?.contains(e.target as Node) && e.preventDefault()}
        className="w-(--radix-popover-trigger-width) overflow-hidden rounded-xl p-0 shadow-2xl"
      >
        <div
          role="listbox"
          aria-label={t(trigger?.kind === "mention" ? "slash.files" : "slash.title")}
          className="max-h-[min(18rem,calc(var(--radix-popover-content-available-height)-8px))] overflow-y-auto p-1"
        >
          {items.map((item, i) => (
            <button
              key={item.key}
              type="button"
              role="option"
              aria-selected={i === current}
              ref={(el) => {
                if (i === current) el?.scrollIntoView({ block: "nearest" });
              }}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setIndex(i)}
              onClick={() => pick(item)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px]",
                i === current && "bg-white/[0.07]",
              )}
            >
              {item.node}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
  // Behind the textarea, whose own text is transparent: the same text, with tagged files drawn as chips.
  const chips = (
    <div
      ref={mirror}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden border border-transparent px-3 py-2 text-base break-words whitespace-pre-wrap md:text-sm",
        fieldClass,
      )}
    >
      {segments(draft, mentions).map((part, i) =>
        part.path === undefined ? (
          part.text
        ) : (
          <span
            key={i}
            title={part.path}
            className="rounded-[4px] bg-white/[0.08] outline-2 outline-white/[0.08] outline-solid"
          >
            <span className="relative">
              <span className="invisible">@</span>
              <FileIcon path={part.path} className="absolute top-1/2 left-0 size-3.5 -translate-y-1/2" />
            </span>
            {part.text.slice(1)}
          </span>
        ),
      )}
      {/* A trailing newline only takes room once something follows it. */}
      {"\u200b"}
    </div>
  );
  // For the textarea: React's onSelect also fires as the caret moves while typing.
  const onSelect = () => setCaret(input.current?.selectionStart ?? 0);
  const onScroll = () => {
    if (mirror.current && input.current) mirror.current.scrollTop = input.current.scrollTop;
  };
  const expand = (text: string) => expandMentions(text, mentions);
  return { menu, chips, onKeyDown, onSelect, onScroll, expand, anchor, input };
}
