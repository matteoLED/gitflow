import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getT, useLocaleStore } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { useAgentsStore } from "@/stores/agents-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useNoticesStore } from "@/stores/notices-store";
import type { AgentKind, AgentRunEvent, AgentTask, PreviewEvent } from "@/types/git";
import { usePreviewStore } from "@/stores/preview-store";
import { useBrowserStore, type BrowserEvent } from "@/stores/browser-store";

function useBackendEvent<T>(name: string, handle: (payload: T) => void) {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen<T>(name, (e) => handle(e.payload)))
      .then((stop) => (disposed ? stop() : (unlisten = stop)))
      .catch(() => undefined); // outside Tauri (tests, browser preview) there is nothing to listen to
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [name, handle]);
}

const applyAgentEvent = (event: AgentRunEvent) => useAgentsStore.getState().applyEvent(event);
const applyPreviewEvent = (event: PreviewEvent) => usePreviewStore.getState().apply(event);
const applyBrowserEvent = (event: BrowserEvent) => useBrowserStore.getState().apply(event);

/** Feeds backend events (agent runs, preview servers) into their stores, for the whole app lifetime. */
export function useAgentEvents() {
  useBackendEvent("agent-run", applyAgentEvent);
  useBackendEvent("preview", applyPreviewEvent);
  useBackendEvent("browser", applyBrowserEvent);
}

export function useInstalledAgents() {
  return useQuery({ queryKey: ["agents"], queryFn: gitBackend.detectAgents, staleTime: 5 * 60_000 });
}

type Continuation = { resume: string | null; thread: string };

/** Starts a read-only run and returns its id, or null when it couldn't start (the reason is notified). */
export async function startAgentRun(
  repoPath: string,
  agent: AgentKind,
  task: AgentTask,
  title: string,
  continuation?: Continuation,
  /** Paths from saveAttachment, sent with this message only. */
  images: string[] = [],
  /** Launched alongside other runs on the same prompt: always isolated, and grouped on the Parallel board. */
  group?: string,
  /** Works on this branch in a new worktree (a Linear issue's), in a mode that can edit: never "plan". */
  branch?: string,
  /** Works from this commit (a failing PR's head) in a new worktree, in a mode that can edit: never "plan".
   *  Its pull request goes into `target`, the branch being fixed. */
  base?: { commit: string; target: string },
) {
  try {
    const locale = useLocaleStore.getState().locale;
    // Ready-made tasks (review, explain, commit message) only read; free requests use the composer's mode.
    const { runSettings, runs } = useAgentsStore.getState();
    // Isolation: a new free-form conversation gets its own worktree; follow-ups keep working in the same one.
    const worktree = continuation
      ? runs.find((r) => r.thread === continuation.thread && r.worktree)?.worktree
      : task.kind === "custom" && (runSettings.isolated || group || branch || base)
        ? { ...(await gitBackend.createAgentWorktree(repoPath, base?.commit ?? null, branch)), target: base?.target }
        : undefined;
    const editMode = (branch || base) && runSettings.mode === "plan" ? "accept-edits" : runSettings.mode;
    const mode = task.kind === "custom" ? editMode : ("plan" as const);
    const settings = { ...runSettings, mode, images, worktree: worktree?.path ?? null };
    const id = await gitBackend.startAgentRun(repoPath, agent, task, locale, continuation?.resume ?? null, settings);
    const thread = continuation?.thread ?? id;
    useAgentsStore
      .getState()
      .addRun({ id, repoPath, agent, task, title, startedAt: new Date().toISOString(), thread, worktree, group });
    return id;
  } catch (error) {
    const { message, detail } = toGitError(error);
    useNoticesStore.getState().notify({ tone: "error", title: getT()("agents.startFailed", { message }), detail });
    return null;
  }
}

/** Starts an agent on a free-form task, then offers to open it from the notice. False when it couldn't start. */
export async function startAgentWithNotice(repoPath: string, prompt: string, title: string, agent?: AgentKind) {
  const kind = agent ?? useAgentsStore.getState().preferredAgent;
  const id = await startAgentRun(repoPath, kind, { kind: "custom", prompt }, title);
  if (!id) return false; // the reason was already notified
  const t = getT();
  useNoticesStore.getState().notify({
    tone: "success",
    title: t("comments.agentStarted"),
    action: {
      label: t("comments.openAgent"),
      run: () => {
        useAgentsStore.getState().select({ type: "run", id });
        useWorkspaceStore.getState().setView("agents");
      },
    },
  });
  return true;
}
