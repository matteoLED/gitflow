import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { MessageKey } from "@/i18n";

/** Labels of accents and of the Berkeley entry are translation keys; other font names are proper nouns. */
export const ACCENTS = {
  violet: { label: "accent.violet", color: "#7770c8", ring: "#8e88d8" },
  blue: { label: "accent.blue", color: "#4f7fd6", ring: "#6f97e0" },
  teal: { label: "accent.teal", color: "#2f9a95", ring: "#4fb3ad" },
  green: { label: "accent.green", color: "#4f9b68", ring: "#6db585" },
  orange: { label: "accent.orange", color: "#c9783f", ring: "#da9160" },
  pink: { label: "accent.pink", color: "#c0619a", ring: "#d27fb0" },
} as const satisfies Record<string, { label: MessageKey; color: string; ring: string }>;

/** Each stack falls back to bundled JetBrains Mono, then system monospace. */
export const CODE_FONTS = {
  berkeley: { label: "font.berkeley", stack: '"Berkeley Mono", "Berkeley Mono Trial Fixed"' },
  jetbrains: { label: "JetBrains Mono", stack: '"JetBrains Mono Variable"' },
  sfmono: { label: "SF Mono", stack: '"SF Mono", ui-monospace' },
  menlo: { label: "Menlo", stack: "Menlo" },
} as const;

export const SYNTAX_THEMES = {
  gitflow: "gitflow (muted)",
  "dark-plus": "Dark+ (VS Code)",
  "github-dark": "GitHub Dark",
  "one-dark-pro": "One Dark Pro",
  "vitesse-dark": "Vitesse Dark",
  "catppuccin-mocha": "Catppuccin Mocha",
  "tokyo-night": "Tokyo Night",
} as const;

export type Accent = keyof typeof ACCENTS;
export type CodeFont = keyof typeof CODE_FONTS;
export type SyntaxTheme = keyof typeof SYNTAX_THEMES;

export type Appearance = {
  accent: Accent;
  /** Whole-interface zoom, applied natively by the webview. */
  uiScale: number;
  codeFont: CodeFont;
  codeSize: number;
  syntaxTheme: SyntaxTheme;
};

export const APPEARANCE_DEFAULTS: Appearance = {
  accent: "violet",
  uiScale: 1,
  codeFont: "berkeley",
  codeSize: 11,
  syntaxTheme: "gitflow",
};

type AppearanceState = Appearance & {
  set: <K extends keyof Appearance>(key: K, value: Appearance[K]) => void;
  reset: () => void;
};

export const useAppearance = create<AppearanceState>()(
  persist(
    (set) => ({
      ...APPEARANCE_DEFAULTS,
      set: (key, value) => set({ [key]: value } as Pick<Appearance, typeof key>),
      reset: () => set(APPEARANCE_DEFAULTS),
    }),
    { name: "gitflow.appearance" },
  ),
);
