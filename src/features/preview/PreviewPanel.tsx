import { useShallow } from "zustand/react/shallow";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  SquareTerminal,
  Maximize2,
  Minimize2,
  Globe,
  Monitor,
  Play,
  RotateCw,
  ScrollText,
  Server,
  Smartphone,
  Sparkles,
  Square,
  Tablet,
} from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { EmptyState } from "@/components/states";
import { PanelHeader } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT, type MessageKey } from "@/i18n";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { runOf, usePreviewStore, type Device, type LogLine } from "@/stores/preview-store";
import { startBackground, startPreview, usePreviewTargets } from "./PreviewList";
import { WorkspaceTasks } from "./WorkspaceTasks";
import { useUiStore } from "@/stores/ui-store";
import { NativeView } from "./NativeView";
import { InputBar } from "./InputBar";

/** CSS sizes of the simulated screens; desktop fills the panel. */
const DEVICES: { device: Device; label: MessageKey; Icon: typeof Monitor; size: [number, number] | null }[] = [
  { device: "desktop", label: "preview.desktop", Icon: Monitor, size: null },
  { device: "tablet", label: "preview.tablet", Icon: Tablet, size: [820, 1180] },
  { device: "mobile", label: "preview.mobile", Icon: Smartphone, size: [390, 844] },
];

function DeviceSwitch() {
  const t = useT();
  const { device, setDevice } = usePreviewStore(useShallow((s) => ({ device: s.device, setDevice: s.setDevice })));
  return (
    <div role="radiogroup" aria-label={t("preview.device")} className="flex gap-0.5 rounded-full bg-black/30 p-0.5">
      {DEVICES.map(({ device: d, label, Icon }) => (
        <Tooltip key={d}>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="radio"
              aria-checked={device === d}
              aria-label={t(label)}
              onClick={() => setDevice(d)}
              className={cn(
                "grid h-7 w-8 place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                device === d && "bg-white/12 text-foreground",
              )}
            >
              <Icon aria-hidden className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t(label)}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

/** Scales a fixed-size screen down to fit the panel, never up. */
function useFitScale(size: [number, number] | null) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el || !size) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setScale(Math.min(1, (width - 48) / (size[0] + 24), (height - 48) / (size[1] + 24)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [size]);
  return { ref, scale };
}

const BEZEL = 12;

function Screen({ url }: { url: string }) {
  const device = usePreviewStore((s) => s.device);
  const size = DEVICES.find((d) => d.device === device)?.size ?? null;
  const { ref, scale } = useFitScale(size);
  if (!size) {
    return (
      <div className="min-h-0 flex-1 p-3 pt-0">
        <NativeView
          url={url}
          zoom={1}
          className="size-full overflow-hidden rounded-xl border border-white/8 bg-white"
        />
      </div>
    );
  }
  // The device keeps its CSS size: the native view is shrunk to fit and zoomed out by the same factor.
  const [w, h] = [size[0] * scale, size[1] * scale];
  return (
    <div ref={ref} className="grid min-h-0 flex-1 place-items-center overflow-hidden">
      <div
        style={{ padding: BEZEL }}
        className={cn(
          "relative shrink-0 bg-[#111214] shadow-2xl ring-1 ring-white/15",
          device === "mobile" ? "rounded-[48px]" : "rounded-[28px]",
        )}
      >
        <NativeView
          url={url}
          zoom={scale}
          style={{ width: w, height: h }}
          className={cn("bg-white", device === "mobile" ? "rounded-[36px]" : "rounded-[16px]")}
        />
      </div>
    </div>
  );
}

/** A backend has no screen: its address and its logs are the preview. */
function ServerStatus({ url }: { url: string | null }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
      <span className="size-2 rounded-full bg-added-foreground" />
      <span className="text-[13px] font-medium">{t("preview.serverRunning")}</span>
      {url && (
        <button
          type="button"
          onClick={() => void gitBackend.openGithubUrl(url)}
          className="font-mono text-[12.5px] text-primary hover:underline"
        >
          {url}
        </button>
      )}
    </div>
  );
}

/** Front-ends usually need their API: offers to start the stopped backends in one click. */
function BackendHint({ repoPath }: { repoPath: string }) {
  const t = useT();
  const runs = usePreviewStore((s) => s.runs);
  const targets = usePreviewTargets(repoPath).data ?? [];
  // A backend may already run inside a monorepo run (turbo, start.sh…): its task shows up in that run's logs.
  const workspaceTasks = new Set(
    targets
      .filter((x) => x.kind === "workspace" && runOf(runs, x.id).status === "ready")
      .flatMap((x) => runOf(runs, x.id).logs.map((l) => l.task)),
  );
  const runsElsewhere = (name: string) => workspaceTasks.has(name) || workspaceTasks.has(name.split("/").pop() ?? name);
  const stopped = targets.filter(
    (b) => b.kind === "server" && !["starting", "ready"].includes(runOf(runs, b.id).status) && !runsElsewhere(b.name),
  );
  if (stopped.length === 0) return null;
  return (
    <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-white/8 bg-card px-3 py-1.5 text-[12.5px] text-muted-foreground">
      <Server aria-hidden className="size-3.5" />
      <span className="min-w-0 flex-1 truncate">
        {t("preview.backendsStopped", { names: stopped.map((b) => b.name).join(", ") })}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => stopped.forEach((b) => void startBackground(repoPath, b))}
        className="h-6 rounded-full text-[12px]"
      >
        {t("preview.startBackends")}
      </Button>
    </div>
  );
}

function Logs({ lines, tall = false }: { lines: LogLine[]; tall?: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => ref.current?.scrollTo({ top: ref.current.scrollHeight }), [lines.length]);
  return (
    <pre
      ref={ref}
      className={cn(
        tall ? "min-h-0 flex-1" : "h-44 shrink-0",
        "overflow-auto border-t border-white/8 bg-black/30 px-4 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-foreground/85 select-text",
      )}
    >
      {lines.map((l) => l.line).join("\n")}
    </pre>
  );
}

function HeaderButton({
  label,
  onClick,
  children,
  pressed,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  pressed?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn("text-muted-foreground", pressed && "bg-white/10 text-foreground")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** "localhost:3006/coach/page" from what's typed: a path, a host or a full address. */
export function resolveAddress(typed: string, base: string): string | null {
  const text = typed.trim();
  if (!text) return null;
  try {
    if (text.startsWith("/")) return new URL(text, base).toString();
    return new URL(/^https?:\/\//.test(text) ? text : `http://${text}`).toString();
  } catch {
    return null;
  }
}

/** Arc/Dia-style bar: history buttons and an address that follows the page and can be typed into. */
function AddressBar({ base, live }: { base: string | null; live: boolean }) {
  const t = useT();
  const [page, setPage] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null); // non-null while the user types
  useEffect(() => {
    if (!live) return;
    const poll = () =>
      void gitBackend
        .previewViewUrl()
        .then(setPage)
        .catch(() => undefined);
    poll();
    const timer = setInterval(poll, 800);
    return () => clearInterval(timer);
  }, [live]);
  const shown = ((live ? page : null) ?? base ?? "").replace(/^https?:\/\//, "");
  const go = () => {
    const url = draft !== null && base ? resolveAddress(draft, base) : null;
    setDraft(null);
    if (url) void gitBackend.previewViewNavigate(url).catch(() => undefined);
  };
  return (
    <div className="mx-1 flex min-w-0 flex-1 items-center gap-0.5">
      <HeaderButton label={t("preview.back")} onClick={() => void gitBackend.previewViewGo(false)}>
        <ArrowLeft />
      </HeaderButton>
      <HeaderButton label={t("preview.forward")} onClick={() => void gitBackend.previewViewGo(true)}>
        <ArrowRight />
      </HeaderButton>
      <HeaderButton label={t("preview.reload")} onClick={() => void gitBackend.previewViewReload()}>
        <RotateCw />
      </HeaderButton>
      <label className="ml-1 flex h-7 min-w-0 flex-1 items-center gap-2 rounded-lg bg-white/[0.05] px-3 text-[12.5px] focus-within:bg-white/[0.08] focus-within:ring-1 focus-within:ring-ring">
        <Globe aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={draft ?? shown}
          disabled={!live}
          spellCheck={false}
          aria-label={t("preview.address")}
          onFocus={(e) => {
            setDraft(shown);
            e.currentTarget.select();
          }}
          onBlur={() => setDraft(null)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              go();
              e.currentTarget.blur();
            } else if (e.key === "Escape") e.currentTarget.blur();
          }}
          className="min-w-0 flex-1 truncate bg-transparent text-foreground outline-none disabled:text-muted-foreground"
        />
      </label>
    </div>
  );
}

/** Main panel of the Preview view: the running app in a desktop, tablet or phone frame. */
export function PreviewPanel({ repoPath }: { repoPath: string }) {
  const t = useT();
  const { runs, selected } = usePreviewStore(useShallow((s) => ({ runs: s.runs, selected: s.selected })));
  const targets = usePreviewTargets(repoPath).data ?? [];
  const target = targets.find((x) => x.id === selected) ?? targets[0];
  const run = runOf(runs, target?.id ?? null);
  const [showLogs, setShowLogs] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);
  const { assistantOpen, setAssistantOpen } = useUiStore(
    useShallow((s) => ({ assistantOpen: s.assistantOpen, setAssistantOpen: s.setAssistantOpen })),
  );

  if (!target) return <EmptyState icon={<Globe />} title={t("preview.noApps")} description={t("preview.noAppsHint")} />;
  const failed = run.status === "failed" || run.status === "stopped";

  const panel = (
    <section
      aria-label={t("view.preview")}
      className={cn("flex h-full flex-col", fullscreen && "fixed inset-0 z-40 bg-background")}
    >
      {/* Full screen covers the title bar: leave room for the traffic lights and keep the window draggable. */}
      <PanelHeader className={cn("gap-2", fullscreen && "pl-20")} data-tauri-drag-region={fullscreen || undefined}>
        <DeviceSwitch />
        {target.kind === "server" || !run.url ? (
          <div className="mx-2 flex h-7 min-w-0 flex-1 items-center gap-2 rounded-lg bg-white/[0.05] px-3 text-[12.5px] text-muted-foreground">
            <Globe aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate select-text">{run.url ?? `${target.name} · ${target.command}`}</span>
          </div>
        ) : (
          <AddressBar base={run.url} live={run.status === "ready"} />
        )}
        {run.inWorkspace ? (
          <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[12px] text-muted-foreground">
            {t("preview.viaMonorepo")}
          </span>
        ) : run.status === "starting" || run.status === "ready" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void gitBackend.stopPreview(target.id)}
            className="h-7 gap-1.5 rounded-full text-[12.5px]"
          >
            <Square aria-hidden className="size-3" />
            {t("preview.stop")}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => void startPreview(repoPath, target)}
            className="h-7 gap-1.5 rounded-full text-[12.5px]"
          >
            <Play aria-hidden className="size-3.5" />
            {t("preview.start")}
          </Button>
        )}
        <HeaderButton label={t("preview.inspect")} onClick={() => void gitBackend.previewViewInspect()}>
          <SquareTerminal />
        </HeaderButton>
        <HeaderButton
          label={t("preview.openBrowser")}
          onClick={() => run.url && void gitBackend.openGithubUrl(run.url)}
        >
          <ExternalLink />
        </HeaderButton>
        <HeaderButton
          label={`${t("assistant.toggle")} ⌘I`}
          pressed={assistantOpen}
          onClick={() => setAssistantOpen(!assistantOpen)}
        >
          <Sparkles />
        </HeaderButton>
        <HeaderButton label={t("preview.logs")} pressed={showLogs} onClick={() => setShowLogs((s) => !s)}>
          <ScrollText />
        </HeaderButton>
        <HeaderButton
          label={fullscreen ? `${t("preview.exitFullscreen")} Esc` : t("preview.fullscreen")}
          pressed={fullscreen}
          onClick={() => setFullscreen((f) => !f)}
        >
          {fullscreen ? <Minimize2 /> : <Maximize2 />}
        </HeaderButton>
      </PanelHeader>
      {target.kind === "workspace" && (run.status === "ready" || run.logs.length > 0) ? (
        <WorkspaceTasks repoPath={repoPath} logs={run.logs} targetId={target.id} running={run.status === "ready"} />
      ) : (
        <>
          {target.kind !== "server" && <BackendHint repoPath={repoPath} />}
          {target.kind === "server" && run.status === "ready" ? (
            <ServerStatus url={run.url} />
          ) : run.status === "ready" && run.url ? (
            <Screen url={run.url} />
          ) : run.status === "starting" ? (
            <EmptyState
              icon={<BrailleLoader variant="grid-pulse" dotSize={3} dotGap={2} className="text-primary" />}
              title={t("preview.starting", { name: target.name })}
              description={<code className="font-mono text-[12px]">{target.command}</code>}
            />
          ) : (
            <EmptyState
              icon={target.kind === "web" ? <Monitor /> : <Smartphone />}
              title={failed ? t("preview.exited") : t("preview.ready", { name: target.name })}
              description={
                failed ? t("preview.exitedHint") : <code className="font-mono text-[12px]">{target.command}</code>
              }
              action={
                <Button onClick={() => void startPreview(repoPath, target)} className="gap-1.5">
                  <Play aria-hidden className="size-4" />
                  {t("preview.start")}
                </Button>
              }
            />
          )}
          {(showLogs || failed || run.status === "starting" || target.kind === "server") && run.logs.length > 0 && (
            <Logs lines={run.logs} tall={target.kind === "server"} />
          )}
          {target.kind === "server" && (run.status === "starting" || run.status === "ready") && (
            <InputBar targetId={target.id} />
          )}
        </>
      )}
    </section>
  );
  // Portaled so no panel around it can clip or offset a fixed layer.
  return fullscreen ? createPortal(panel, document.body) : panel;
}
