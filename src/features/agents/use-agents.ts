import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getT, useLocaleStore } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { useAgentsStore } from "@/stores/agents-store";
import { useNoticesStore } from "@/stores/notices-store";
import type { AgentKind, AgentRunEvent, AgentTask, PreviewEvent } from "@/types/git";
import { usePreviewStore } from "@/stores/preview-store";

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

/** Feeds backend events (agent runs, preview servers) into their stores, for the whole app lifetime. */
export function useAgentEvents() {
  useBackendEvent("agent-run", applyAgentEvent);
  useBackendEvent("preview", applyPreviewEvent);
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
) {
  try {
    const locale = useLocaleStore.getState().locale;
    // Ready-made tasks (review, explain, commit message) only read; free requests use the composer's mode.
    const { runSettings } = useAgentsStore.getState();
    const settings = { ...(task.kind === "custom" ? runSettings : { ...runSettings, mode: "plan" as const }), images };
    const id = await gitBackend.startAgentRun(repoPath, agent, task, locale, continuation?.resume ?? null, settings);
    const thread = continuation?.thread ?? id;
    useAgentsStore.getState().addRun({ id, repoPath, agent, task, title, startedAt: new Date().toISOString(), thread });
    return id;
  } catch (error) {
    const { message, detail } = toGitError(error);
    useNoticesStore.getState().notify({ tone: "error", title: getT()("agents.startFailed", { message }), detail });
    return null;
  }
}
