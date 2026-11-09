import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getT } from "@/i18n";
import { gitBackend } from "@/lib/tauri-git";
import type { TerminalEvent } from "@/types/git";

const THEME = {
  background: "#1b1c1f",
  foreground: "#e6e7e9",
  cursor: "#e6e7e9",
  selectionBackground: "#7770c855",
  black: "#1b1c1f",
  brightBlack: "#6c6e74",
  red: "#e39a9f",
  green: "#9ccb9e",
  yellow: "#e0d5b2",
  blue: "#a6c2dd",
  magenta: "#b6aae6",
  cyan: "#acd2d1",
  white: "#d6d7da",
};

/** The user's login shell in the repository, through a real PTY on the Rust side. */
export default function TerminalView({ repoPath }: { repoPath: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const styles = getComputedStyle(document.documentElement);
    const term = new Terminal({
      fontFamily: styles.getPropertyValue("--code-font") || "monospace",
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      allowProposedApi: false,
      theme: THEME,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    let id: string | null = null;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const start = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<TerminalEvent>("terminal", ({ payload }) => {
        if (payload.id !== id) return;
        if (payload.type === "output") term.write(payload.data);
        else term.write(`\r\n\x1b[2m${getT()("terminal.exited")}\x1b[0m\r\n`);
      });
      id = await gitBackend.terminalOpen(repoPath, term.cols, term.rows);
      if (disposed) void gitBackend.terminalClose(id);
    };
    start().catch((error: unknown) => term.write(`\x1b[31m${String(error)}\x1b[0m\r\n`));

    const input = term.onData((data) => id && void gitBackend.terminalWrite(id, data));
    const observer = new ResizeObserver(() => {
      if (!el.offsetParent) return; // hidden: keep the last size
      fit.fit();
      if (id) void gitBackend.terminalResize(id, term.cols, term.rows);
    });
    observer.observe(el);
    term.focus();

    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      unlisten?.();
      if (id) void gitBackend.terminalClose(id);
      term.dispose();
    };
  }, [repoPath]);
  return <div ref={host} className="size-full px-3 pt-1.5" />;
}
