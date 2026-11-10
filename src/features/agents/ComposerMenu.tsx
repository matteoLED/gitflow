import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, SquareSlash } from "lucide-react";
import { FileIcon } from "@/components/file-icon";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { fuzzyFilter } from "@/features/editor/fuzzy";
import { StateIcon } from "@/features/github/PullRequestList";
import { StateDot } from "@/features/linear/LinearList";
import { useWorkspaceIssues } from "@/features/linear/linear-queries";
import { usePullRequests } from "@/lib/git-queries";
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
  type Mention,
  type Mentions,
} from "./composer-menu";

type Item = { key: string; value: string; node: ReactNode; mention?: Mention };

/** A tagged item's icon: the file's, the pull request's state, the issue's status. */
function MentionIcon({ mention, className }: { mention: Mention; className?: string }) {
  if (mention.kind === "file") return <FileIcon path={mention.path} className={cn("size-3.5", className)} />;
  if (mention.kind === "pr")
    return (
      <span className={cn("grid size-3.5 place-items-center", className)}>
        <StateIcon pr={mention} />
      </span>
    );
  return (
    <span className={cn("grid size-3.5 place-items-center", className)}>
      <StateDot state={{ type: mention.stateType, color: mention.color, name: "" }} />
    </span>
  );
}

const SHOWN = { pr: 6, issue: 6, file: 30 };

/**
 * Completion in the agent composer, as in Claude Code: `/` opening the message lists custom commands and
 * skills, `@` anywhere lists pull requests, Linear issues and the repository's files. ↑↓ to pick, ↵ or ⇥ to insert, esc to dismiss.
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
  const prs = usePullRequests(repoPath ?? "").data;
  const issues = useWorkspaceIssues().data;
  const candidates = useMemo(() => {
    const all: { label: string; detail: string; mention: Mention }[] = [];
    for (const pr of prs ?? [])
      if (pr.state === "OPEN")
        all.push({
          label: pr.title,
          detail: `#${pr.number}`,
          mention: {
            kind: "pr",
            number: pr.number,
            title: pr.title,
            url: pr.url,
            state: pr.state,
            isDraft: pr.isDraft,
          },
        });
    for (const issue of issues ?? [])
      all.push({
        label: issue.title,
        detail: issue.identifier,
        mention: {
          kind: "issue",
          identifier: issue.identifier,
          title: issue.title,
          url: issue.url,
          color: issue.state.color,
          stateType: issue.state.type,
        },
      });
    return all;
  }, [prs, issues]);
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
    // Pull requests and issues match on "#770 title" / "MNT-897 title"; files on their path.
    const byKey = new Map(candidates.map((c) => [`${c.detail} ${c.label}`, c]));
    const q = trigger.query;
    const pick = (keys: string[], max: number) => (q ? fuzzyFilter(q, keys, max) : keys.slice(0, max));
    const work = pick([...byKey.keys()], q ? 12 : SHOWN.pr + SHOWN.issue).flatMap((key) => {
      const c = byKey.get(key);
      return c ? [c] : [];
    });
    const paths = pick(files.data ?? [], q ? 30 : SHOWN.file);
    return [
      ...work.map((c) => ({
        key: `${c.mention.kind}:${c.detail}`,
        value: c.detail,
        mention: c.mention,
        node: (
          <>
            <MentionIcon mention={c.mention} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[12.5px]">{c.label}</span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{c.detail}</span>
          </>
        ),
      })),
      ...paths.map((path) => {
        const slash = path.lastIndexOf("/");
        return {
          key: path,
          value: path,
          mention: { kind: "file", path } as const,
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
      }),
    ];
  }, [candidates, commands.data, files.data, t, trigger]);
  const open = !!trigger && dismissed !== draft && items.length > 0;
  const current = Math.min(index, items.length - 1);

  const pick = (item: Item) => {
    if (!trigger) return;
    let value = item.value;
    if (trigger.kind === "mention" && item.mention) {
      value = mentionName(item.mention, mentions);
      setMentions({ ...mentions, [value]: item.mention });
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
          aria-label={t(trigger?.kind === "mention" ? "slash.mentions" : "slash.title")}
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
        part.mention === undefined ? (
          part.text
        ) : (
          <span key={i} className="rounded-[4px] bg-white/[0.08] outline-2 outline-white/[0.08] outline-solid">
            <span className="relative">
              <span className="invisible">@</span>
              <MentionIcon mention={part.mention} className="absolute top-1/2 left-0 -translate-y-1/2" />
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
