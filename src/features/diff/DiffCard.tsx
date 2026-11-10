import { useThemeKind } from "@/features/settings/use-apply-appearance";
import { useShallow } from "zustand/react/shallow";
import { Fragment, useEffect, useMemo, useState, type ReactNode, type Ref } from "react";
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronsUpDown } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { FileIcon } from "@/components/file-icon";
import { MiddleTruncate } from "@/components/middle-truncate";
import { useViewSettings } from "@/stores/view-settings-store";
import { LIGHT_SYNTAX_THEMES, useAppearance } from "@/stores/appearance-store";
import { toGitError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import type { DiffLine, FileDiff, FileStatus } from "@/types/git";
import { buildSegments, CONTEXT_LINES, EXPAND_STEP, revealGap, type GapReveal, type Segment } from "./diff-model";
import { parseUnifiedDiff } from "./parse-unified-diff";
import { highlightDiff, type LineTokens, cachedTokens } from "./syntax-client";
import { toSplitRows } from "./split-rows";
import { useT } from "@/i18n";
import { ImageDiff, isImage, type ImageSource } from "./ImageDiff";
import { CommentButton, LineThreads } from "./LineComments";

const MAX_RENDERED_LINES = 3000;

/** Changed rows get a tint plus a thin edge bar, so they stay visible even with syntax colors on top. */
const ROW_STYLES: Record<DiffLine["kind"], { row: string; number: string }> = {
  added: { row: "bg-diff-added shadow-[inset_2px_0_0] shadow-added/70", number: "text-diff-added-number" },
  removed: { row: "bg-diff-removed shadow-[inset_2px_0_0] shadow-removed/70", number: "text-diff-removed-number" },
  context: { row: "", number: "text-muted-foreground" },
};

type TokenOf = (line: DiffLine) => LineTokens[number] | undefined;

/** Everything a row needs to render, resolved once per file. */
type RenderContext = { tokenOf: TokenOf; gutter: string; wrap: boolean; split: boolean };

function Code({ line, tokenOf }: { line: DiffLine; tokenOf: TokenOf }) {
  const tokens = tokenOf(line);
  if (!tokens) return <>{line.content}</>;
  return (
    <>
      {tokens.map((token, i) => (
        <span key={i} style={{ color: token.color }}>
          {token.content}
        </span>
      ))}
    </>
  );
}

function codeClass(wrap: boolean) {
  return cn("min-w-0 flex-1 pr-4 text-[#d4d4d8]", wrap ? "break-words whitespace-pre-wrap" : "whitespace-pre");
}

function LineNumber({ value, kind, gutter }: { value: number | null; kind: DiffLine["kind"]; gutter: string }) {
  return (
    <span
      style={{ width: gutter }}
      className={cn("shrink-0 pr-4 text-right tabular-nums select-none", ROW_STYLES[kind].number)}
    >
      {value}
    </span>
  );
}

function Line({ line, ctx }: { line: DiffLine; ctx: RenderContext }) {
  return (
    <>
      <div className={cn("group/line relative flex", ROW_STYLES[line.kind].row)}>
        <CommentButton line={line} />
        <LineNumber
          value={line.kind === "removed" ? line.oldLine : line.newLine}
          kind={line.kind}
          gutter={ctx.gutter}
        />
        <span className="sr-only">{line.kind === "context" ? "" : `${line.kind}:`}</span>
        <span className={codeClass(ctx.wrap)}>
          <Code line={line} tokenOf={ctx.tokenOf} />
        </span>
      </div>
      <LineThreads line={line} />
    </>
  );
}

function Half({ line, side, ctx }: { line: DiffLine | null; side: "left" | "right"; ctx: RenderContext }) {
  if (!line) return <div aria-hidden className="bg-white/[0.015]" />;
  return (
    <div className={cn("group/line relative flex min-w-0", ROW_STYLES[line.kind].row)}>
      {/* A context line appears on both sides: only the new one takes comments. */}
      {(side === "right" || line.kind === "removed") && <CommentButton line={line} />}
      <LineNumber value={side === "left" ? line.oldLine : line.newLine} kind={line.kind} gutter={ctx.gutter} />
      <span className="sr-only">{line.kind === "context" ? "" : `${line.kind}:`}</span>
      <span className={codeClass(true)}>
        <Code line={line} tokenOf={ctx.tokenOf} />
      </span>
    </div>
  );
}

function Lines({ lines, ctx }: { lines: DiffLine[]; ctx: RenderContext }) {
  if (!ctx.split) {
    return lines.map((line, i) => <Line key={i} line={line} ctx={ctx} />);
  }
  return toSplitRows(lines).map((row, i) => (
    <Fragment key={i}>
      <div className="grid grid-cols-2 divide-x divide-white/6">
        <Half line={row.left} side="left" ctx={ctx} />
        <Half line={row.right} side="right" ctx={ctx} />
      </div>
      {row.left?.kind === "removed" && <LineThreads line={row.left} />}
      {row.right && <LineThreads line={row.right} />}
    </Fragment>
  ));
}

function GutterButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-5 place-items-center rounded text-muted-foreground outline-none hover:bg-white/[0.14] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

const PILL_ICON = { start: ArrowUpToLine, middle: ChevronsUpDown, end: ArrowDownToLine } as const;

type GapProps = {
  gap: Extract<Segment, { kind: "gap" }>;
  reveal: GapReveal;
  onReveal: (reveal: GapReveal) => void;
  ctx: RenderContext;
};

function Gap({ gap, reveal, onReveal, ctx }: GapProps) {
  const t = useT();
  const { head, hidden, tail } = revealGap(gap.lines, reveal);
  const step = Math.min(EXPAND_STEP, hidden);
  const PillIcon = PILL_ICON[gap.position];
  return (
    <>
      <Lines lines={head} ctx={ctx} />
      {hidden > 0 && (
        <div className="h-6 font-sans text-[11px]">
          {/* Pinned to the visible width so controls stay in view when long lines scroll horizontally. */}
          <div className="sticky left-0 flex h-full w-[100cqw] items-center">
            <div style={{ width: ctx.gutter }} className="flex shrink-0 gap-0.5 pl-3">
              {gap.position !== "end" && (
                <GutterButton
                  label={t("diff.showAbove", { count: step })}
                  onClick={() => onReveal({ ...reveal, bottom: reveal.bottom + step })}
                >
                  <ArrowUpToLine />
                </GutterButton>
              )}
              {gap.position !== "start" && (
                <GutterButton
                  label={t("diff.showBelow", { count: step })}
                  onClick={() => onReveal({ ...reveal, top: reveal.top + step })}
                >
                  <ArrowDownToLine />
                </GutterButton>
              )}
            </div>
            <button
              type="button"
              title={t("diff.expandHidden", { count: hidden })}
              onClick={() => onReveal({ top: gap.lines.length, bottom: 0 })}
              className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/12 px-2.5 py-0.5 text-muted-foreground outline-none hover:border-white/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PillIcon aria-hidden className="size-3" />
              {t.plural("diff.unchanged", hidden)}
            </button>
          </div>
        </div>
      )}
      <Lines lines={tail} ctx={ctx} />
    </>
  );
}

export function useTokens(path: string, lines: DiffLine[], enabled: boolean): TokenOf {
  const chosen = useAppearance((s) => s.syntaxTheme);
  // A dark code theme is unreadable on a light interface (and the reverse): fall back to a matching one.
  const kind = useThemeKind();
  const theme = kind === "light" && !LIGHT_SYNTAX_THEMES.has(chosen) ? "github-light" : chosen;
  // Starts from the cache: a card scrolled back into view doesn't flash uncolored.
  const [tokens, setTokens] = useState<{ lines: DiffLine[]; theme: string; tokens: LineTokens } | null>(() => {
    const hit = enabled ? cachedTokens(lines, theme) : null;
    return hit ? { lines, theme, tokens: hit } : null;
  });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    highlightDiff(path, lines, theme)
      .then((result) => !cancelled && result && setTokens({ lines, theme, tokens: result }))
      .catch(() => undefined); // highlighting is cosmetic: plain text is a fine fallback
    return () => {
      cancelled = true;
    };
  }, [path, lines, enabled, theme]);
  const index = useMemo(() => new Map(lines.map((line, i) => [line, i])), [lines]);
  const current = enabled && tokens?.lines === lines && tokens.theme === theme ? tokens.tokens : null;
  return (line: DiffLine) => current?.[index.get(line) ?? -1];
}

/** Caps rendered lines so a generated or minified file can't freeze the UI. */
function capSegments(segments: Segment[]): { segments: Segment[]; truncated: boolean } {
  let budget = MAX_RENDERED_LINES;
  const kept: Segment[] = [];
  for (const segment of segments) {
    if (budget <= 0) return { segments: kept, truncated: true };
    if (segment.kind === "lines") {
      kept.push({ ...segment, lines: segment.lines.slice(0, budget) });
      budget -= segment.lines.length;
    } else kept.push(segment);
  }
  return { segments: kept, truncated: budget < 0 };
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-xs text-muted-foreground">{children}</p>;
}

function DiffLines({ path, lines, expandAll }: { path: string; lines: DiffLine[]; expandAll: boolean }) {
  const t = useT();
  const { layout, wrapLines, syntaxHighlighting } = useViewSettings(
    useShallow((s) => ({ layout: s.layout, wrapLines: s.wrapLines, syntaxHighlighting: s.syntaxHighlighting })),
  );
  const { segments, truncated } = useMemo(
    () => capSegments(buildSegments(lines, expandAll ? Number.MAX_SAFE_INTEGER : CONTEXT_LINES)),
    [lines, expandAll],
  );
  const [reveals, setReveals] = useState<Record<number, GapReveal>>({});
  const tokenOf = useTokens(path, lines, syntaxHighlighting);
  const maxLine = lines.reduce((max, l) => Math.max(max, l.newLine ?? 0, l.oldLine ?? 0), 0);
  const split = layout === "split";
  // Split halves always wrap: two independent horizontal scrolls would be unusable.
  const ctx: RenderContext = {
    tokenOf,
    gutter: `${Math.max(String(maxLine).length, 3) + 4}ch`,
    wrap: wrapLines || split,
    split,
  };

  return (
    <div
      className={cn(
        "@container font-mono text-(length:--code-size) leading-[1.55] select-text",
        !ctx.wrap && "overflow-x-auto",
      )}
    >
      <div className={cn("py-1.5", !ctx.wrap && "w-max min-w-full")}>
        {segments.map((segment, i) =>
          segment.kind === "lines" ? (
            <Lines key={i} lines={segment.lines} ctx={ctx} />
          ) : (
            <Gap
              key={segment.id}
              gap={segment}
              reveal={reveals[segment.id] ?? { top: 0, bottom: 0 }}
              onReveal={(reveal) => setReveals((prev) => ({ ...prev, [segment.id]: reveal }))}
              ctx={ctx}
            />
          ),
        )}
      </div>
      {truncated && <Note>{t("diff.truncated", { count: MAX_RENDERED_LINES })}</Note>}
    </div>
  );
}

type DiffBodyProps = {
  path: string;
  diff?: FileDiff;
  error?: unknown;
  loading: boolean;
  expandAll?: boolean;
  /** Where to read a binary image from, to show it instead of "binary file". */
  image?: ImageSource & { status: FileStatus };
};

export function DiffBody({ path, diff, error, loading, expandAll = false, image }: DiffBodyProps) {
  const t = useT();
  const lines = useMemo(() => parseUnifiedDiff(diff?.patch ?? "").flatMap((h) => h.lines), [diff?.patch]);
  if (error) return <Note>{t("diff.loadError", { message: toGitError(error).message })}</Note>;
  if (loading || !diff) {
    return (
      <Note>
        <BrailleLoader className="mr-1.5 text-primary" label={t("diff.loadingDiff")} />
        {t("diff.loadingDiff")}
      </Note>
    );
  }
  if (diff.binary && image && isImage(path)) return <ImageDiff path={path} status={image.status} source={image} />;
  if (diff.binary) return <Note>{t("diff.binary")}</Note>;
  if (lines.length === 0) return <Note>{t("diff.noText")}</Note>;
  return <DiffLines path={path} lines={lines} expandAll={expandAll} />;
}

export type DiffCardFile = {
  path: string;
  previousPath: string | null;
  status: FileStatus;
  additions?: number | null;
  deletions?: number | null;
};

type DiffCardProps = {
  file: DiffCardFile;
  open: boolean;
  onToggle: () => void;
  highlighted?: boolean;
  cardRef?: Ref<HTMLElement>;
  id?: string;
  /** Controls on the right of the header (reviewed checkbox, file menu). */
  actions?: ReactNode;
  children: ReactNode;
};

export function DiffCard({ file, open, onToggle, highlighted = false, cardRef, id, actions, children }: DiffCardProps) {
  const t = useT();
  const showLineCounts = useViewSettings((s) => s.showLineCounts);
  const slash = file.path.lastIndexOf("/");
  return (
    <article
      ref={cardRef}
      id={id}
      aria-label={file.path}
      className={cn("overflow-hidden rounded-lg border border-white/8 bg-card", highlighted && "border-primary/60")}
    >
      <div className={cn("flex h-10 items-center bg-card pr-2", open && "border-b border-white/8")}>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left outline-none hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <ChevronDown
            aria-hidden
            className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
          />
          <FileIcon path={file.path} className="size-3.5" />
          <span
            className={cn("truncate text-[12px] font-semibold", file.status === "added" && "text-added-foreground")}
          >
            {file.path.slice(slash + 1)}
          </span>
          <MiddleTruncate
            className="text-[11.5px] text-muted-foreground"
            tail={18}
            text={
              file.previousPath
                ? t("diff.renamedFrom", { path: file.previousPath })
                : file.path.slice(0, Math.max(slash, 0))
            }
          />
          {showLineCounts && (
            <span className="ml-auto flex shrink-0 gap-2 pl-2 font-mono text-[11px]">
              {!!file.additions && <span className="text-added-foreground">+{file.additions}</span>}
              {!!file.deletions && <span className="text-removed-foreground">-{file.deletions}</span>}
            </span>
          )}
        </button>
        {actions}
      </div>
      {open && children}
    </article>
  );
}
