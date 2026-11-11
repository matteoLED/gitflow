import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Button } from "@/components/ui/button";
import { noticeTtl, useNoticesStore, type Notice } from "@/stores/notices-store";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

const GAP = 8;
/** How much of each notice behind the front one shows while the stack is collapsed. */
const PEEK = 9;
const VISIBLE = 3;
const EXIT_MS = 200;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function ToneIcon({ tone }: { tone: Notice["tone"] }) {
  if (tone === "loading")
    return <BrailleLoader variant="grid-syncing" className="mt-[3px] shrink-0 text-foreground/80" />;
  const Icon = tone === "error" ? CircleAlert : tone === "success" ? CheckCircle2 : Info;
  return (
    <Icon
      aria-hidden
      className={cn(
        "mt-0.5 size-4 shrink-0",
        tone === "error"
          ? "text-removed-foreground"
          : tone === "success"
            ? "text-added-foreground"
            : "text-muted-foreground",
      )}
    />
  );
}

type ToastProps = {
  notice: Notice;
  index: number;
  /** Distance from the bottom of the stack, in px. */
  offset: number;
  expanded: boolean;
  paused: boolean;
  /** Height of the front notice: the ones behind take it while collapsed, so their edges line up. */
  frontHeight: number;
  onHeight: (id: number, height: number) => void;
};

function Toast({ notice, index, offset, expanded, paused, frontHeight, onHeight }: ToastProps) {
  const t = useT();
  const dismiss = useNoticesStore((s) => s.dismiss);
  const [leaving, setLeaving] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const ttl = noticeTtl(notice);

  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const observer = new ResizeObserver(() => onHeight(notice.id, el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [notice.id, onHeight]);
  // Restarts on update (a loading notice turned into its outcome) and after a hover.
  useEffect(() => {
    if (ttl === null || paused || leaving) return;
    const timer = setTimeout(() => setLeaving(true), ttl);
    return () => clearTimeout(timer);
  }, [ttl, paused, leaving, notice]);
  // Removed once its exit transition has played.
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => dismiss(notice.id), reducedMotion() ? 0 : EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving, dismiss, notice.id]);

  const behind = !expanded && index > 0;
  const hidden = !expanded && index >= VISIBLE;
  const style = {
    "--y": `${leaving ? 16 - offset : -offset}px`,
    "--s": expanded || leaving ? 1 : 1 - index * 0.05,
    height: behind ? frontHeight : undefined,
    zIndex: VISIBLE + 2 - index,
  } as CSSProperties;
  return (
    <div
      role={notice.tone === "error" ? "alert" : "status"}
      aria-hidden={hidden || undefined}
      style={style}
      className={cn(
        "absolute inset-x-0 bottom-0 origin-top overflow-hidden rounded-lg bg-popover shadow-[0_8px_24px_rgb(0_0_0/0.45)]",
        "[transform:translateY(var(--y))_scale(var(--s))] transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none",
        "starting:[transform:translateY(calc(100%+16px))] starting:opacity-0",
        leaving || hidden ? "pointer-events-none opacity-0" : "opacity-100",
      )}
    >
      <div
        ref={card}
        className={cn(
          "flex gap-2.5 rounded-lg border border-white/[0.1] p-3 text-popover-foreground",
          notice.tone === "error" && "border-removed/60",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 flex-1 gap-2.5 transition-opacity duration-200 motion-reduce:transition-none",
            behind && "opacity-0",
          )}
        >
          <ToneIcon tone={notice.tone} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] leading-5 break-words">{notice.title}</p>
            {notice.detail && (
              <details className="mt-1 text-xs text-muted-foreground">
                <summary className="cursor-default">{t("common.gitOutput")}</summary>
                <pre className="mt-1 max-h-40 overflow-auto font-mono text-[12px] whitespace-pre-wrap select-text">
                  {notice.detail}
                </pre>
              </details>
            )}
            {/* Below the message, never beside it: the text keeps the notice's full width. */}
            {notice.action && (
              <Button
                variant="secondary"
                size="xs"
                className="mt-2"
                tabIndex={behind ? -1 : undefined}
                onClick={() => {
                  notice.action?.run();
                  setLeaving(true);
                }}
              >
                {notice.action.label}
              </Button>
            )}
          </div>
        </div>
        {notice.tone !== "loading" && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="-mt-0.5 -mr-1 text-muted-foreground"
            tabIndex={behind ? -1 : undefined}
            aria-label={t("common.dismiss")}
            onClick={() => setLeaving(true)}
          >
            <X />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Sonner-like stack, newest in front: collapsed when several, spread out (and timers paused) on hover or focus. */
export function Notices() {
  const t = useT();
  const notices = useNoticesStore((s) => s.notices);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [heights, setHeights] = useState<Record<number, number>>({});
  const onHeight = (id: number, height: number) => setHeights((h) => (h[id] === height ? h : { ...h, [id]: height }));
  const paused = hovered || focused;
  const newestFirst = [...notices].reverse();
  const expanded = paused && notices.length > 1;
  const frontHeight = heights[newestFirst[0]?.id ?? -1] ?? 0;

  // Expanded, each notice sits on top of the newer ones: its offset is their heights plus the gaps.
  const tops = newestFirst.map((n) => (heights[n.id] ?? 0) + GAP);
  const spread = (index: number) => tops.slice(0, index).reduce((sum, h) => sum + h, 0);
  const placed = newestFirst.map((notice, index) => ({
    notice,
    index,
    offset: expanded ? spread(index) : index * PEEK,
  }));
  const shown = Math.min(notices.length, VISIBLE);
  const height = notices.length === 0 ? 0 : expanded ? spread(notices.length) - GAP : frontHeight + (shown - 1) * PEEK;

  return (
    <section
      aria-label={t("notices.label")}
      aria-live="polite"
      style={{ height }}
      className="fixed right-4 bottom-9 z-50 w-96"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFocused(false)}
    >
      {placed.map(({ notice, index, offset }) => (
        <Toast
          key={notice.id}
          notice={notice}
          index={index}
          offset={offset}
          expanded={expanded}
          paused={paused}
          frontHeight={frontHeight}
          onHeight={onHeight}
        />
      ))}
    </section>
  );
}
