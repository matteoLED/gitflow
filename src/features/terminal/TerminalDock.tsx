import { useShallow } from "zustand/react/shallow";
import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent } from "react";
import { SquareTerminal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

const TerminalView = lazy(() => import("./TerminalView"));

/** ⌃` toggles the terminal, like in VS Code and Zed. */
function useTerminalShortcut() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.code !== "Backquote") return;
      event.preventDefault();
      const { terminalOpen, setTerminalOpen } = useUiStore.getState();
      setTerminalOpen(!terminalOpen);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** Bottom dock. Once opened, the shell stays alive while hidden, so closing the dock doesn't kill a running command. */
export function TerminalDock({ repoPath }: { repoPath: string }) {
  const t = useT();
  useTerminalShortcut();
  const { terminalOpen, setTerminalOpen } = useUiStore(
    useShallow((s) => ({ terminalOpen: s.terminalOpen, setTerminalOpen: s.setTerminalOpen })),
  );
  const [started, setStarted] = useState(false);
  const [height, setHeight] = useState(280);
  const drag = useRef<{ y: number; height: number } | null>(null);
  if (terminalOpen && !started) setStarted(true);

  const onPointerDown = (e: PointerEvent) => {
    drag.current = { y: e.clientY, height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return;
    setHeight(Math.min(Math.max(drag.current.height + drag.current.y - e.clientY, 120), window.innerHeight - 200));
  };

  if (!started) return null;
  return (
    <section
      aria-label={t("terminal.title")}
      style={{ height }}
      className={cn("flex shrink-0 flex-col border-t border-border bg-background", !terminalOpen && "hidden")}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        className="h-1 shrink-0 cursor-row-resize hover:bg-primary/60"
      />
      <header className="flex h-8 shrink-0 items-center gap-2 px-3 text-[12.5px] text-muted-foreground">
        <SquareTerminal aria-hidden className="size-3.5" />
        <span className="font-medium text-foreground">{t("terminal.title")}</span>
        <span className="text-[11.5px]">⌃`</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("common.dismiss")}
          onClick={() => setTerminalOpen(false)}
          className="ml-auto"
        >
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        <Suspense fallback={null}>
          <TerminalView key={repoPath} repoPath={repoPath} />
        </Suspense>
      </div>
    </section>
  );
}
