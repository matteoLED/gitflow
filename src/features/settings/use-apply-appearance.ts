import { useShallow } from "zustand/react/shallow";
import { useEffect, useSyncExternalStore } from "react";
import { ACCENTS, CODE_FONTS, useAppearance } from "@/stores/appearance-store";
import { ALL_THEME_KEYS, THEMES, resolveTheme, themeTokens, type ThemeId } from "./themes";

const FALLBACK_MONO = '"JetBrains Mono Variable", ui-monospace, Menlo, monospace';

async function setWebviewZoom(scale: number) {
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(scale);
  } catch {
    // Outside the desktop app (browser, tests) there is no native zoom: keep 100%.
  }
}

async function setWindowTheme(kind: "dark" | "light") {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTheme(kind);
  } catch {
    // Browser or tests: no native window.
  }
}

const DARK_QUERY = "(prefers-color-scheme: dark)";
const media = () => (typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null);

function subscribeScheme(onChange: () => void) {
  const query = media();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

/** The theme actually shown: "system" follows macOS live. */
export function useThemeId(): ThemeId {
  const choice = useAppearance((s) => s.theme);
  const prefersDark = useSyncExternalStore(subscribeScheme, () => media()?.matches ?? true);
  return resolveTheme(choice, prefersDark);
}

export const useThemeKind = () => THEMES[useThemeId()].kind;

/** Pushes appearance preferences into CSS variables and the webview zoom, live. */
export function useApplyAppearance() {
  const { accent, codeFont, codeSize, uiScale, contrast } = useAppearance(
    useShallow((s) => ({
      accent: s.accent,
      codeFont: s.codeFont,
      codeSize: s.codeSize,
      uiScale: s.uiScale,
      contrast: s.contrast,
    })),
  );
  const themeId = useThemeId();

  useEffect(() => {
    const html = document.documentElement;
    const kind = THEMES[themeId].kind;
    // Clear first: a dark theme relies on the stylesheet's diff colors, which a light theme overrides.
    for (const key of ALL_THEME_KEYS) html.style.removeProperty(key);
    for (const [key, value] of Object.entries(themeTokens(themeId, contrast))) html.style.setProperty(key, value);
    html.style.colorScheme = kind;
    html.classList.toggle("dark", kind === "dark");
    void setWindowTheme(kind);
  }, [themeId, contrast]);

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
