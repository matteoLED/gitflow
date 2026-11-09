import { useEffect, useRef, useState } from "react";
import { gitBackend } from "@/lib/tauri-git";
import { useAppearance } from "@/stores/appearance-store";
import { useUiStore } from "@/stores/ui-store";

/** True while a menu, popover or dialog is open: the native view would cover it, so it steps aside. */
function useOverlayOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(!!document.querySelector("[data-radix-popper-content-wrapper], [role=dialog]"));
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: false });
    check();
    return () => observer.disconnect();
  }, []);
  return open;
}

type NativeViewProps = { url: string; zoom: number; className?: string; style?: React.CSSProperties };

/**
 * Reserves a box in the layout and lays the native preview webview exactly over it, following it while
 * panels resize. Positions only cross to Rust when they change.
 */
export function NativeView({ url, zoom, className, style }: NativeViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const uiScale = useAppearance((s) => s.uiScale);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const overlay = useOverlayOpen();
  const hidden = settingsOpen || overlay;

  useEffect(() => {
    if (hidden) {
      void gitBackend.previewViewHide();
      return;
    }
    let frame = 0;
    let last = "";
    const follow = () => {
      const el = box.current;
      if (el) {
        const r = el.getBoundingClientRect();
        // CSS pixels → window points: the whole app may itself be zoomed (Settings › Interface size).
        const bounds = {
          x: r.left * uiScale,
          y: r.top * uiScale,
          width: r.width * uiScale,
          height: r.height * uiScale,
          zoom: zoom * uiScale,
        };
        const key = JSON.stringify(bounds) + url;
        if (key !== last && r.width > 0) {
          last = key;
          void gitBackend.previewViewShow(url, bounds).catch(() => undefined);
        }
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => {
      cancelAnimationFrame(frame);
      void gitBackend.previewViewHide();
    };
  }, [url, zoom, uiScale, hidden]);

  return <div ref={box} className={className} style={style} />;
}
