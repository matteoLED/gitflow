import { create } from "zustand";
import { createJSONStorage, persist, type PersistStorage } from "zustand/middleware";
import type {
  AgentScope,
  AgentKind,
  AgentRunEvent,
  AgentStep,
  AgentTask,
  AgentUsage,
  RunSettings,
  Worktree,
} from "@/types/git";

export type RunStatus = "running" | "done" | "failed" | "cancelled";

export type AgentRun = {
  id: string;
  repoPath: string;
  agent: AgentKind;
  task: AgentTask | null;
  title: string;
  status: RunStatus;
  steps: AgentStep[];
  startedAt: string;
  /** The agent's own conversation id, set once it starts: continuing the chat resumes it. */
  sessionId: string | null;
  /** Runs of one conversation share a thread: the first run's id, or `session:<id>` for a Claude Code session. */
  thread: string;
  /** The isolated worktree the conversation works in, if it was started in one. */
  worktree?: Worktree;
  /** Shared by conversations launched together on the same prompt ("Run on N agents"), to compare them. */
  group?: string;
  /** Latest known context fill and cost of this run. */
  usage?: Partial<AgentUsage>;
  /** Run in the user's own checkout: snapshots around it, to review its edits file by file (Zed-like). */
  edits?: RunEdits;
};

/** Tree ids of the working tree before and after the run; `settled`: files accepted or rejected since. */
export type RunEdits = { before: string; after?: string; settled?: string[] };

/** Null fields mean "not reported this time": the previous value stays. */
function mergeUsage(previous: Partial<AgentUsage> | undefined, next: AgentUsage): Partial<AgentUsage> {
  const known = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== null));
  return { ...previous, ...known };
}

/** What the Agents view shows: a run started here, a saved Claude Code session, a GitHub Actions run. */
export type AgentSelection =
  | { type: "new" }
  | { type: "usage" }
  | { type: "board" }
  | { type: "definition"; scope: AgentScope; name: string }
  | { type: "new-definition" }
  | { type: "run"; id: string }
  | { type: "session"; id: string }
  | { type: "workflow"; id: number };

export type AgentsListTab = "runs" | "agents" | "actions";

type AgentsState = {
  runs: AgentRun[];
  selection: AgentSelection;
  preferredAgent: AgentKind;
  /** Mode, model and effort picked in the composer; reused for every run until changed. */
  runSettings: RunSettings;
  setRunSettings: (settings: Partial<RunSettings>) => void;
  /** Conversation shown in the side panel; null starts a new one. */
  assistantThread: string | null;
  setAssistantThread: (thread: string | null) => void;
  addRun: (run: Omit<AgentRun, "status" | "steps" | "sessionId">) => void;
  applyEvent: (event: AgentRunEvent) => void;
  setEdits: (id: string, edits: RunEdits) => void;
  select: (selection: AgentSelection) => void;
  /** Tab of the Agents list: runs and sessions, sub-agent definitions, or GitHub Actions. */
  listTab: AgentsListTab;
  setListTab: (tab: AgentsListTab) => void;
  setPreferredAgent: (agent: AgentKind) => void;
};

const placeholder = (id: string): AgentRun => ({
  id,
  repoPath: "",
  agent: "claude",
  task: null,
  title: "",
  status: "running",
  steps: [],
  startedAt: new Date().toISOString(),
  sessionId: null,
  thread: id,
});

/**
 * Runs continued from a saved session whose turns its file doesn't hold yet. Resuming appends to that file,
 * so once a run's turns are in it (the file's last step is newer than the run) they would show twice.
 */
export function unsavedFollowUps(fileSteps: readonly AgentStep[], runs: readonly AgentRun[]): AgentRun[] {
  const last = fileSteps.reduce((latest, step) => (step.at && step.at > latest ? step.at : latest), "");
  return runs.filter((run) => run.status === "running" || !last || run.startedAt > last);
}

/** Runs of a conversation, oldest first. */
export const threadRuns = (runs: AgentRun[], thread: string) => runs.filter((r) => r.thread === thread).reverse();

/** The agent's final answer: the result text when it gives one, else its last message. */
export function finalAnswer(run: AgentRun): string | null {
  const answer = [...run.steps].reverse().find((s) => (s.kind === "result" || s.kind === "message") && s.detail);
  return answer?.detail ?? null;
}

/**
 * Steps stream in several times a second and the saved copy holds every step of 30 runs: it is serialized and
 * written at most once a second, and right away when the window goes away.
 * ponytail: a quit within that second can lose the last steps; persist per run if that ever matters.
 */
function throttledStorage<S>(delay: number): PersistStorage<S> | undefined {
  const json = createJSONStorage<S>(() => localStorage);
  if (!json) return undefined;
  let pending: { name: string; value: Parameters<typeof json.setItem>[1] } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (pending) void json.setItem(pending.name, pending.value);
    pending = null;
  };
  globalThis.addEventListener?.("pagehide", flush);
  globalThis.addEventListener?.("beforeunload", flush);
  return {
    getItem: json.getItem,
    setItem: (name, value) => {
      pending = { name, value };
      timer ??= setTimeout(flush, delay);
    },
    removeItem: (name) => {
      pending = null;
      return json.removeItem(name);
    },
  };
}

/** Steps can arrive before `start_agent_run` returns: unknown ids get a placeholder that `addRun` completes. */
export const useAgentsStore = create<AgentsState>()(
  persist(
    (set) => ({
      runs: [],
      selection: { type: "new" },
      preferredAgent: "claude",
      assistantThread: null,
      runSettings: { mode: "plan", model: null, effort: null, isolated: false },
      setRunSettings: (settings) => set(({ runSettings }) => ({ runSettings: { ...runSettings, ...settings } })),
      setAssistantThread: (thread) => set({ assistantThread: thread }),
      addRun: (run) =>
        set(({ runs }) => {
          // Events can arrive before startAgentRun resolves, even the end of a CLI that failed at once: that
          // placeholder (no repository yet) keeps its steps, status and session. A run already added is replaced.
          const existing = runs.find((r) => r.id === run.id && r.repoPath === "");
          if (existing)
            return {
              runs: runs.map((r) =>
                r === existing
                  ? { ...r, ...run, status: existing.status, steps: existing.steps, sessionId: existing.sessionId }
                  : r,
              ),
            };
          runs = runs.filter((r) => r.id !== run.id);
          return { runs: [{ ...run, status: "running", steps: [], sessionId: null }, ...runs] };
        }),
      applyEvent: (event) =>
        set(({ runs }) => {
          const known = runs.some((r) => r.id === event.runId);
          const list = known ? runs : [placeholder(event.runId), ...runs];
          return {
            runs: list.map((r) => {
              if (r.id !== event.runId) return r;
              if (event.type === "step") return { ...r, steps: [...r.steps, event.step] };
              if (event.type === "session") return { ...r, sessionId: event.sessionId };
              if (event.type === "usage") return { ...r, usage: mergeUsage(r.usage, event.usage) };
              return { ...r, status: event.status };
            }),
          };
        }),
      setEdits: (id, edits) => set(({ runs }) => ({ runs: runs.map((r) => (r.id === id ? { ...r, edits } : r)) })),
      select: (selection) => set({ selection }),
      listTab: "runs",
      setListTab: (listTab) => set({ listTab }),
      setPreferredAgent: (agent) => set({ preferredAgent: agent }),
    }),
    {
      name: "gitflow.agents",
      storage: throttledStorage(1000),
      // Finished runs survive a restart (capped); a run still going when the app quit can't resume.
      partialize: ({ runs, preferredAgent, runSettings, listTab }) => ({
        preferredAgent,
        listTab,
        runSettings,
        runs: runs.slice(0, 30).map((r) => (r.status === "running" ? { ...r, status: "cancelled" as const } : r)),
      }),
    },
  ),
);
