import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Undo2 } from "lucide-react";
import { FileIcon } from "@/components/file-icon";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { invalidateRepo } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useAgentsStore, type AgentRun } from "@/stores/agents-store";
import { useEditorStore } from "@/stores/editor-store";
import { useNoticesStore } from "@/stores/notices-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { EditedFile } from "@/types/git";

/** Runs whose closing snapshot is being taken, so a re-render doesn't take it twice. */
const closing = new Set<string>();

/** Snapshots the checkout when a run that edits it ends, then returns the latest one with edits to review. */
export function useRunEdits(repoPath: string, runs: AgentRun[]): AgentRun | null {
  useEffect(() => {
    for (const run of runs) {
      const edits = run.edits;
      if (!edits || edits.after || run.status === "running" || closing.has(run.id)) continue;
      closing.add(run.id);
      gitBackend
        .snapshotWorkingTree(repoPath)
        .then((after) => useAgentsStore.getState().setEdits(run.id, { ...edits, after }))
        .catch(() => undefined) // no review then: the edits stay, as they would without it
        .finally(() => closing.delete(run.id));
    }
  }, [repoPath, runs]);
  return [...runs].reverse().find((r) => r.edits?.after) ?? null;
}

/** Zed's "edits" bar above the composer: what the agent changed, each file kept or put back. */
export function AgentEdits({ repoPath, run }: { repoPath: string; run: AgentRun }) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const edits = run.edits;
  const before = edits?.before ?? "";
  const after = edits?.after ?? "";
  const files = useQuery({
    queryKey: ["agent-edits", repoPath, before, after],
    queryFn: () => gitBackend.agentEdits(repoPath, before, after),
    enabled: !!after,
    staleTime: Infinity,
  });
  const pending = (files.data ?? []).filter((f) => !edits?.settled?.includes(f.path));
  if (!edits || pending.length === 0) return null;

  const settle = (paths: string[]) =>
    useAgentsStore.getState().setEdits(run.id, { ...edits, settled: [...(edits.settled ?? []), ...paths] });
  const reject = async (list: EditedFile[]) => {
    setBusy(true);
    const done: string[] = [];
    for (const file of list) {
      try {
        await gitBackend.rejectAgentEdit(repoPath, before, after, file.path);
        done.push(file.path);
      } catch (error) {
        notify({ tone: "error", title: t("edits.rejectFailed"), detail: toGitError(error).message });
      }
    }
    settle(done);
    setBusy(false);
    void invalidateRepo(client, repoPath);
  };
  const openFile = (path: string) => {
    useEditorStore.getState().open(repoPath, path);
    useWorkspaceStore.getState().setView("editor");
  };
  const added = pending.reduce((n, f) => n + (f.additions ?? 0), 0);
  const removed = pending.reduce((n, f) => n + (f.deletions ?? 0), 0);

  return (
    <div className="border-b border-white/[0.07] text-[12px]">
      <div className="flex h-8 items-center gap-1.5 pr-1.5 pl-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-1.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            aria-hidden
            className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")}
          />
          <span className="font-medium">{t.plural("edits.files", pending.length)}</span>
          <Counts additions={added} deletions={removed} />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void reject(pending)}
          className="ml-auto h-6 rounded-md px-2 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground disabled:opacity-50"
        >
          {t("edits.rejectAll")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => settle(pending.map((f) => f.path))}
          className="h-6 rounded-md bg-white/[0.08] px-2 text-foreground hover:bg-white/[0.12] disabled:opacity-50"
        >
          {t("edits.acceptAll")}
        </button>
      </div>
      {open && (
        <ul className="max-h-40 overflow-y-auto pb-1">
          {pending.map((file) => (
            <li key={file.path} className="group flex h-7 items-center gap-1.5 pr-1.5 pl-3">
              <button
                type="button"
                onClick={() => openFile(file.path)}
                title={file.path}
                className="flex min-w-0 items-center gap-1.5 rounded text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FileIcon path={file.path} className="size-3.5 shrink-0" />
                <span className={cn("truncate", file.status === "deleted" && "line-through")}>
                  {file.path.slice(file.path.lastIndexOf("/") + 1)}
                </span>
                <span className="truncate text-muted-foreground">
                  {file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ""}
                </span>
              </button>
              <Counts additions={file.additions} deletions={file.deletions} />
              <span className="ml-auto flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                <IconButton label={t("edits.reject")} disabled={busy} onClick={() => void reject([file])}>
                  <Undo2 />
                </IconButton>
                <IconButton label={t("edits.accept")} disabled={busy} onClick={() => settle([file.path])}>
                  <Check />
                </IconButton>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Counts({ additions, deletions }: { additions: number | null; deletions: number | null }) {
  if (additions === null && deletions === null) return null;
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums">
      <span className="text-added-foreground">+{additions ?? 0}</span>{" "}
      <span className="text-removed-foreground">−{deletions ?? 0}</span>
    </span>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}
