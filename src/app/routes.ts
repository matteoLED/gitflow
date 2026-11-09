import type { View } from "@/stores/workspace-store";

/** One route per page; kept apart from the router so components can link without importing it. */
export const VIEW_PATHS = {
  home: "/",
  work: "/work",
  history: "/history",
  changes: "/changes",
  github: "/pulls",
  ci: "/ci",
  linear: "/linear",
  preview: "/preview",
  agents: "/agents",
  browser: "/browser",
  graph: "/graph",
} as const satisfies Record<View, string>;

export const VIEWS = Object.keys(VIEW_PATHS) as View[];

export const viewAt = (pathname: string): View | null => VIEWS.find((v) => VIEW_PATHS[v] === pathname) ?? null;
