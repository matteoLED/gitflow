/**
 * Interface themes, like Linear's: each is a full set of surface and text tokens. Dark themes keep the
 * reference's cool graphite family; light ones flip the app's white overlays to black ink (see `INK`).
 */
export type ThemeKind = "dark" | "light";
export type ThemeId = "dark" | "midnight" | "noir" | "light" | "pure-light";
export type ThemeChoice = ThemeId | "system";
export type Contrast = "low" | "standard" | "high" | "max";

type Tokens = Record<string, string>;
type Theme = { kind: ThemeKind; tokens: Tokens };

const LIGHT_DIFF: Tokens = {
  "--added": "#2f8a4c",
  "--added-foreground": "#1f7a3c",
  "--removed": "#c4424e",
  "--removed-foreground": "#b3303d",
  "--renamed": "#a87b1f",
  "--diff-added-row": "#e3f4e6",
  "--diff-removed-row": "#fbe6e8",
  "--diff-added-number": "#3f8f55",
  "--diff-removed-number": "#bb4a55",
};

export const THEMES: Record<ThemeId, Theme> = {
  dark: {
    kind: "dark",
    tokens: {
      "--sidebar": "#232428",
      "--background": "#1b1c1f",
      "--panel": "#1b1c1f",
      "--card": "#202125",
      "--popover": "#2a2b30",
      "--secondary": "#2c2d32",
      "--muted": "#24252a",
      "--accent": "#3a3b42",
      "--input": "#36373e",
    },
  },
  midnight: {
    kind: "dark",
    tokens: {
      "--sidebar": "#1a1f33",
      "--background": "#13172a",
      "--panel": "#13172a",
      "--card": "#181d31",
      "--popover": "#20263d",
      "--secondary": "#222944",
      "--muted": "#1b2036",
      "--accent": "#2e3655",
      "--input": "#2c3450",
    },
  },
  // Linear's dark, sampled from the app: near-black frame, panels a step up, cards another, hairline borders.
  noir: {
    kind: "dark",
    tokens: {
      "--sidebar": "#09090a",
      "--background": "#121213",
      "--panel": "#121213",
      "--card": "#1a1a1b",
      "--popover": "#1c1c1e",
      "--secondary": "#1f1f21",
      "--muted": "#161617",
      "--accent": "#28282b",
      "--input": "#222225",
      "--border": "#232326",
      "--foreground": "#f7f8f8",
      // Linear's status colors are saturated, not pastel.
      "--added": "#4d994b",
      "--added-foreground": "#6ccf6a",
      "--removed": "#e15b59",
      "--removed-foreground": "#f3857e",
      "--destructive": "#e15b59",
      "--renamed": "#e8c031",
      "--diff-added-row": "#1b2e1d",
      "--diff-removed-row": "#33191a",
      "--diff-added-number": "#6ccf6a",
      "--diff-removed-number": "#f3857e",
    },
  },
  light: {
    kind: "light",
    tokens: {
      "--sidebar": "#f2f2f4",
      "--background": "#fcfcfd",
      "--panel": "#fcfcfd",
      "--card": "#ffffff",
      "--popover": "#ffffff",
      "--secondary": "#ececf0",
      "--muted": "#f0f0f3",
      "--accent": "#e6e6eb",
      "--input": "#d9d9e0",
      ...LIGHT_DIFF,
    },
  },
  "pure-light": {
    kind: "light",
    tokens: {
      "--sidebar": "#ffffff",
      "--background": "#ffffff",
      "--panel": "#ffffff",
      "--card": "#ffffff",
      "--popover": "#ffffff",
      "--secondary": "#f1f1f4",
      "--muted": "#f5f5f7",
      "--accent": "#ececf0",
      "--input": "#dcdce2",
      ...LIGHT_DIFF,
    },
  },
};

/** Text and border strength per contrast level: `low` is soft, `max` is crisp black-on-white or white-on-black. */
const CONTRAST: Record<ThemeKind, Record<Contrast, Tokens>> = {
  dark: {
    low: {
      "--foreground": "#dcdde1",
      "--muted-foreground": "#8e8f97",
      "--sidebar-foreground": "#a6a7ae",
      "--border": "#2a2b30",
    },
    standard: {
      "--foreground": "#eeeff1",
      "--muted-foreground": "#a2a3ab",
      "--sidebar-foreground": "#b9bac1",
      "--border": "#2f3036",
    },
    high: {
      "--foreground": "#f7f7f8",
      "--muted-foreground": "#bdbec6",
      "--sidebar-foreground": "#d3d4da",
      "--border": "#3b3c44",
    },
    max: {
      "--foreground": "#ffffff",
      "--muted-foreground": "#d2d3da",
      "--sidebar-foreground": "#e8e8ec",
      "--border": "#4b4c55",
    },
  },
  light: {
    low: {
      "--foreground": "#2b2c31",
      "--muted-foreground": "#7c7d86",
      "--sidebar-foreground": "#55565e",
      "--border": "#e6e6eb",
    },
    standard: {
      "--foreground": "#1b1c1f",
      "--muted-foreground": "#666770",
      "--sidebar-foreground": "#43444c",
      "--border": "#dedfe5",
    },
    high: {
      "--foreground": "#0e0e10",
      "--muted-foreground": "#4c4d55",
      "--sidebar-foreground": "#2c2d33",
      "--border": "#cbccd3",
    },
    max: {
      "--foreground": "#000000",
      "--muted-foreground": "#34353b",
      "--sidebar-foreground": "#1a1a1e",
      "--border": "#a9aab3",
    },
  },
};

/** Overlay ink: the app draws hover fills and hairlines as translucent `white`; on light themes that ink is black. */
const INK: Record<ThemeKind, string> = { dark: "#ffffff", light: "#000000" };

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ThemeId {
  return choice === "system" ? (prefersDark ? "dark" : "light") : choice;
}

/** Every CSS variable a theme + contrast pair sets on the document root. */
export function themeTokens(id: ThemeId, contrast: Contrast): Tokens {
  const theme = THEMES[id];
  const text = CONTRAST[theme.kind][contrast];
  // A theme's own text/border values are its "standard"; other contrast levels override them.
  const tokens = contrast === "standard" ? { ...text, ...theme.tokens } : { ...theme.tokens, ...text };
  return {
    ...tokens,
    "--card-foreground": tokens["--foreground"],
    "--popover-foreground": tokens["--foreground"],
    "--secondary-foreground": tokens["--foreground"],
    "--accent-foreground": tokens["--foreground"],
    "--color-white": INK[theme.kind],
  };
}

/** Every variable any theme sets, so switching themes can clear the previous one's leftovers. */
export const ALL_THEME_KEYS = [
  ...new Set((Object.keys(THEMES) as ThemeId[]).flatMap((id) => Object.keys(themeTokens(id, "standard")))),
];

/** Colors shown in the theme picker's "Aa" chips. */
export function themeSwatch(id: ThemeId) {
  const theme = THEMES[id];
  return {
    background: theme.tokens["--background"],
    sidebar: theme.tokens["--sidebar"],
    text: theme.tokens["--foreground"] ?? CONTRAST[theme.kind].standard["--foreground"],
  };
}
