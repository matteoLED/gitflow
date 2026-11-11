import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCw,
  SquareTerminal,
  X,
} from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { PanelHeader } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useBrowserStore, type BrowserShortcut, type BrowserTab } from "@/stores/browser-store";
import { useLayoutStore } from "@/stores/layout-store";
import { NativeView, type ViewBounds } from "@/features/preview/NativeView";
import { displayUrl, hostOf, toWebAddress } from "./address";

function Favicon({ url, className }: { url: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const host = hostOf(url);
  if (!host || failed) return <Globe aria-hidden className={cn("size-3.5 text-muted-foreground", className)} />;
  return (
    <img
      alt=""
      src={`${new URL(url).origin}/favicon.ico`}
      onError={() => setFailed(true)}
      className={cn("size-3.5 rounded-[3px]", className)}
    />
  );
}

/** Arc's vertical tabs, in the list column. */
export function BrowserTabs({ query }: { query: string }) {
  const t = useT();
  const { tabs, active, select, close } = useBrowserStore(
    useShallow((s) => ({ tabs: s.tabs, active: s.active, select: s.select, close: s.close })),
  );
  const needle = query.toLowerCase();
  const shown = tabs.filter((tab) => `${tab.title} ${tab.url}`.toLowerCase().includes(needle));
  const remove = (tab: BrowserTab) => {
    void gitBackend.browserClose(tab.id);
    close(tab.id);
  };
  return (
    <nav aria-label={t("browser.tabs")} className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      <button
        type="button"
        onClick={() => select(null)}
        className={cn(
          "mb-1 flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-sidebar-foreground outline-none hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          active === null && "bg-white/[0.08] text-foreground",
        )}
      >
        <Plus aria-hidden className="size-3.5 text-primary" />
        {t("browser.newTab")}
      </button>
      <ul className="space-y-px">
        {shown.map((tab) => (
          <li key={tab.id} className="group relative">
            <button
              type="button"
              aria-current={tab.id === active ? "page" : undefined}
              onClick={() => select(tab.id)}
              onAuxClick={(e) => e.button === 1 && remove(tab)}
              title={tab.url}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-md pr-7 pl-2 text-left text-[12.5px] outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring",
                tab.id === active && "bg-white/[0.08]",
              )}
            >
              {tab.loading ? <BrailleLoader className="size-3.5 text-primary" /> : <Favicon url={tab.url} />}
              <span className="min-w-0 flex-1 truncate">{tab.title || displayUrl(tab.url)}</span>
            </button>
            <button
              type="button"
              aria-label={t("browser.closeTab")}
              onClick={() => remove(tab)}
              className="absolute top-1/2 right-1 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-foreground focus-visible:opacity-100"
            >
              <X aria-hidden className="size-3" />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function BarButton({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="text-muted-foreground"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Dia-style address: "alan.com / Alan – Carte Alan" at rest, the full address once clicked (or ⌘L).
 * Enter opens what was typed: an address, or a web search.
 */
function AddressInput({
  tab,
  autoFocus,
  inputRef,
}: {
  tab: BrowserTab | null;
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const go = () => {
    const url = draft !== null ? toWebAddress(draft) : null;
    setDraft(null);
    if (!url) return;
    if (tab) void gitBackend.browserNavigate(tab.id, url).catch(() => undefined);
    else useBrowserStore.getState().open(url);
  };
  const editing = draft !== null || !tab;
  return (
    <label
      className={cn(
        "relative flex h-7 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-[12.5px] transition-colors",
        editing ? "bg-white/[0.07] ring-1 ring-ring" : "hover:bg-white/[0.05]",
      )}
    >
      {tab ? (
        <Favicon url={tab.url} className="shrink-0" />
      ) : (
        <Globe aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={draft ?? ""}
        spellCheck={false}
        placeholder={tab ? "" : t("browser.placeholder")}
        aria-label={t("browser.address")}
        onFocus={(e) => {
          setDraft(tab?.url ?? "");
          const input = e.currentTarget;
          requestAnimationFrame(() => input.select());
        }}
        onBlur={() => setDraft(null)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            go();
            e.currentTarget.blur();
          } else if (e.key === "Escape") e.currentTarget.blur();
        }}
        className={cn(
          "min-w-0 flex-1 truncate bg-transparent text-foreground outline-none placeholder:text-muted-foreground",
          !editing && "text-transparent",
        )}
      />
      {!editing && tab && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-2.5 left-8 flex min-w-0 items-center gap-1.5"
        >
          <span className="shrink-0 text-foreground">{hostOf(tab.url).replace(/^www\./, "")}</span>
          {tab.title && (
            <>
              <span className="text-muted-foreground/60">/</span>
              <span className="min-w-0 truncate text-muted-foreground">{tab.title}</span>
            </>
          )}
        </span>
      )}
    </label>
  );
}

const hideTabs = () => gitBackend.browserHide();

/** Keeps the active tab's address current: single-page apps change it without loading a page. */
function useFollowUrl(tab: BrowserTab | null) {
  const id = tab?.id;
  useEffect(() => {
    if (!id) return;
    const timer = setInterval(() => {
      if (document.hidden) return; // nobody reads the address of a hidden window
      void gitBackend.browserUrl(id).then((url) => {
        const current = useBrowserStore.getState().tabs.find((x) => x.id === id)?.url;
        if (url && url !== current && /^https?:/.test(url)) useBrowserStore.getState().apply({ type: "url", id, url });
      });
    }, 800);
    return () => clearInterval(timer);
  }, [id]);
}

const SHORTCUT_KEYS: Record<string, BrowserShortcut> = {
  t: "new",
  l: "address",
  w: "close",
  r: "reload",
  "[": "back",
  "]": "forward",
};

/** The page of the active tab under an address bar; with no tab, a start page to type an address. */
export function BrowserPanel() {
  const t = useT();
  const tab = useBrowserStore((s) => s.tabs.find((x) => x.id === s.active) ?? null);
  const shortcut = useBrowserStore((s) => s.shortcut);
  const listCollapsed = useLayoutStore((s) => !!s.collapsedLists.browser);
  const toggleList = useLayoutStore((s) => s.toggleList);
  const address = useRef<HTMLInputElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useFollowUrl(tab);
  // The native tab is created on the address it had when first shown; later moves go through events.
  const [firstUrl] = useState(() => new Map<string, string>());
  if (tab && !firstUrl.has(tab.id)) firstUrl.set(tab.id, tab.url);
  const show = useCallback(
    (id: string, bounds: ViewBounds) => gitBackend.browserShow(id, firstUrl.get(id) ?? "", bounds),
    [firstUrl],
  );

  const act = useCallback((action: BrowserShortcut) => {
    const store = useBrowserStore.getState();
    const current = store.tabs.find((x) => x.id === store.active);
    if (action === "new") return store.select(null);
    if (action === "address") return address.current?.focus();
    if (!current) return;
    if (action === "close") {
      void gitBackend.browserClose(current.id);
      return store.close(current.id);
    }
    void gitBackend.browserCommand(current.id, action);
  }, []);
  // Shortcuts pressed inside the page (reported by the native view)…
  useEffect(() => {
    if (shortcut && Date.now() - shortcut.at < 1000) act(shortcut.action);
  }, [shortcut, act]);
  // …and while the app itself has the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && fullscreen) return setFullscreen(false);
      const action = e.metaKey && !e.ctrlKey && !e.altKey ? SHORTCUT_KEYS[e.key.toLowerCase()] : undefined;
      if (!action) return;
      e.preventDefault();
      act(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, fullscreen]);

  const panel = (
    <section
      aria-label={t("view.browser")}
      className={cn("flex h-full flex-col", fullscreen && "fixed inset-0 z-40 bg-background")}
    >
      <PanelHeader className={cn("gap-0.5 border-b-0", fullscreen && "pl-20")}>
        {!fullscreen && (
          <BarButton label={t("browser.toggleTabs")} onClick={() => toggleList("browser")}>
            {listCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </BarButton>
        )}
        <BarButton label={`${t("preview.back")} ⌘[`} disabled={!tab} onClick={() => act("back")}>
          <ArrowLeft />
        </BarButton>
        <BarButton label={`${t("preview.forward")} ⌘]`} disabled={!tab} onClick={() => act("forward")}>
          <ArrowRight />
        </BarButton>
        <BarButton label={`${t("preview.reload")} ⌘R`} disabled={!tab} onClick={() => act("reload")}>
          {tab?.loading ? <BrailleLoader /> : <RotateCw />}
        </BarButton>
        {tab ? <AddressInput key={tab.id} tab={tab} inputRef={address} /> : <div className="flex-1" />}
        <BarButton
          label={t("preview.inspect")}
          disabled={!tab}
          onClick={() => tab && void gitBackend.browserInspect(tab.id)}
        >
          <SquareTerminal />
        </BarButton>
        <BarButton
          label={t("preview.openBrowser")}
          disabled={!tab}
          onClick={() => tab && void gitBackend.openGithubUrl(tab.url)}
        >
          <ExternalLink />
        </BarButton>
        <BarButton
          label={fullscreen ? `${t("preview.exitFullscreen")} Esc` : t("preview.fullscreen")}
          onClick={() => setFullscreen((f) => !f)}
        >
          {fullscreen ? <Minimize2 /> : <Maximize2 />}
        </BarButton>
      </PanelHeader>
      {tab ? (
        <div className="min-h-0 flex-1 p-1.5 pt-0">
          <NativeView
            url={tab.id}
            zoom={1}
            show={show}
            hide={hideTabs}
            className="size-full overflow-hidden rounded-lg border border-white/8 bg-card"
          />
        </div>
      ) : (
        <div className="grid flex-1 place-content-center justify-items-center gap-4 px-6">
          <Globe aria-hidden className="size-8 text-muted-foreground" />
          <div className="w-[min(560px,80vw)]">
            <AddressInput tab={null} autoFocus inputRef={address} />
          </div>
          <p className="text-[12px] text-muted-foreground">{t("browser.hint")}</p>
        </div>
      )}
    </section>
  );
  return fullscreen ? createPortal(panel, document.body) : panel;
}
