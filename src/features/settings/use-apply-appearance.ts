import { useEffect } from "react";
import { ACCENTS, CODE_FONTS, useAppearance } from "@/stores/appearance-store";

const FALLBACK_MONO = '"JetBrains Mono Variable", ui-monospace, Menlo, monospace';

async function setWebviewZoom(scale: number) {
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(scale);
  } catch {
    // Outside the desktop app (browser, tests) there is no native zoom: keep 100%.
  }
}

/** Pushes appearance preferences into CSS variables and the webview zoom, live. */
export function useApplyAppearance() {
  const { accent, codeFont, codeSize, uiScale } = useAppearance();

  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--primary", ACCENTS[accent].color);
    root.setProperty("--selection", ACCENTS[accent].color);
    root.setProperty("--ring", ACCENTS[accent].ring);
  }, [accent]);

  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--code-font", `${CODE_FONTS[codeFont].stack}, ${FALLBACK_MONO}`);
    root.setProperty("--code-size", `${codeSize}px`);
  }, [codeFont, codeSize]);

  useEffect(() => {
    void setWebviewZoom(uiScale);
  }, [uiScale]);
}
