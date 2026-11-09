import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PreviewEvent } from "@/types/git";

export type PreviewStatus = "idle" | "starting" | "ready" | "stopped" | "failed";
export type Device = "desktop" | "tablet" | "mobile";

export type LogLine = { task: string | null; line: string };
export type PreviewRun = {
  status: PreviewStatus;
  url: string | null;
  logs: LogLine[];
  /** Up because a monorepo run started it: not ours to start or stop on its own. */
  inWorkspace?: boolean;
};

// A whole monorepo can be chatty: enough history to scroll back, bounded memory.
const MAX_LOG_LINES = 3000;
const idle: PreviewRun = { status: "idle", url: null, logs: [] };

type PreviewState = {
  runs: Record<string, PreviewRun>;
  selected: string | null;
  device: Device;
  start: (id: string) => void;
  apply: (event: PreviewEvent) => void;
  select: (id: string) => void;
  setDevice: (device: Device) => void;
};

export const runOf = (runs: Record<string, PreviewRun>, id: string | null) => (id && runs[id]) || idle;

export const usePreviewStore = create<PreviewState>()(
  persist(
    (set) => ({
      runs: {},
      selected: null,
      device: "desktop",
      start: (id) => set(({ runs }) => ({ runs: { ...runs, [id]: { status: "starting", url: null, logs: [] } } })),
      apply: (event) =>
        set(({ runs }) => {
          const run = runOf(runs, event.targetId);
          const next: PreviewRun =
            event.type === "log"
              ? { ...run, logs: [...run.logs.slice(-(MAX_LOG_LINES - 1)), { task: event.task, line: event.line }] }
              : event.type === "ready"
                ? // Ready without having been started here: a monorepo run brought it up.
                  { ...run, status: "ready", url: event.url, inWorkspace: run.inWorkspace || run.status !== "starting" }
                : {
                    ...run,
                    status: event.code === 0 || event.code === null ? "stopped" : "failed",
                    url: null,
                    inWorkspace: false,
                  };
          return { runs: { ...runs, [event.targetId]: next } };
        }),
      select: (id) => set({ selected: id }),
      setDevice: (device) => set({ device }),
    }),
    // Servers don't survive a restart: only the chosen app and device are remembered.
    { name: "gitflow.preview", partialize: ({ selected, device }) => ({ selected, device }) },
  ),
);
