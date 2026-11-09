import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AgentScope, AgentKind, AgentRunEvent, AgentStep, AgentTask, AgentUsage, RunSettings } from "@/types/git";

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
  /** Latest known context fill and cost of this run. */
  usage?: Partial<AgentUsage>;
};

/** Null fields mean "not reported this time": the previous value stays. */
function mergeUsage(previous: Partial<AgentUsage> | undefined, next: AgentUsage): Partial<AgentUsage> {
  const known = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== null));
  return { ...previous, ...known };
}

/** What the Agents view shows: a run started here, a saved Claude Code session, a GitHub Actions run. */
export type AgentSelection =
  | { type: "new" }
  | { type: "usage" }
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

/** Runs of a conversation, oldest first. */
export const threadRuns = (runs: AgentRun[], thread: string) => runs.filter((r) => r.thread === thread).reverse();

/** The agent's final answer: the result text when it gives one, else its last message. */
export function finalAnswer(run: AgentRun): string | null {
  const answer = [...run.steps].reverse().find((s) => (s.kind === "result" || s.kind === "message") && s.detail);
  return answer?.detail ?? null;
}

/** Steps can arrive before `start_agent_run` returns: unknown ids get a placeholder that `addRun` completes. */
export const useAgentsStore = create<AgentsState>()(
  persist(
    (set) => ({
      runs: [],
      selection: { type: "new" },
      preferredAgent: "claude",
      assistantThread: null,
      runSettings: { mode: "plan", model: null, effort: null },
      setRunSettings: (settings) => set(({ runSettings }) => ({ runSettings: { ...runSettings, ...settings } })),
      setAssistantThread: (thread) => set({ assistantThread: thread }),
      addRun: (run) =>
        set(({ runs }) => {
          // Events can arrive before startAgentRun resolves: keep that placeholder's steps, unless it is a
          // finished run from an earlier launch with the same id (then start clean).
          const existing = runs.find((r) => r.id === run.id && r.status === "running");
          if (existing) return { runs: runs.map((r) => (r === existing ? { ...r, ...run } : r)) };
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
      select: (selection) => set({ selection }),
      listTab: "runs",
      setListTab: (listTab) => set({ listTab }),
      setPreferredAgent: (agent) => set({ preferredAgent: agent }),
    }),
    {
      name: "gitflow.agents",
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
