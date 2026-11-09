import { useShallow } from "zustand/react/shallow";
import { DataUnavailable } from "@/components/states";
import { useMemo, useState } from "react";
import { CircleCheck, Minus, Plus, Sparkles } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { pickAgent } from "@/features/agents/AgentButton";
import { startAgentRun, useInstalledAgents } from "@/features/agents/use-agents";
import { finalAnswer, useAgentsStore } from "@/stores/agents-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PanelHeader, PanelLoading } from "@/components/layout/panel";
import { useWorkingTree } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useGitAction } from "@/features/operations/use-git-action";
import { FILE_STATUS } from "@/features/changed-files/file-status";
import { groupChanges, pathsOf, type ChangeItem } from "./group-changes";
import { useT } from "@/i18n";
import { BranchStatus, RecentCommits } from "./BranchContext";

type ChangeRowProps = { item: ChangeItem; action: "stage" | "unstage" | null; onAction: () => void; busy: boolean };

function ChangeRow({ item, action, onAction, busy }: ChangeRowProps) {
  const t = useT();
  const { selectedChange, selectChange } = useWorkspaceStore(
    useShallow((s) => ({ selectedChange: s.selectedChange, selectChange: s.selectChange })),
  );
  const selected = selectedChange?.path === item.path && selectedChange.side === item.side;
  const status = FILE_STATUS[item.status];
  const slash = item.path.lastIndexOf("/");
  return (
    <li className="group/row relative">
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => selectChange({ path: item.path, previousPath: item.previousPath, side: item.side })}
        title={item.previousPath ? `${item.previousPath} → ${item.path}` : item.path}
        className={cn(
          "flex h-7 w-full items-center gap-2 rounded-md pr-9 pl-2 text-left outline-none hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-ring",
          selected && "bg-white/[0.06]",
        )}
      >
        <span
          aria-label={t(status.label)}
          className={cn("w-3 shrink-0 font-mono text-[12px] font-semibold", status.className)}
        >
          {status.letter}
        </span>
        <span className="truncate font-mono text-[12.5px]">{item.path.slice(slash + 1)}</span>
        <span className="truncate font-mono text-[11.5px] text-muted-foreground">
          {item.path.slice(0, Math.max(slash, 0))}
        </span>
      </button>
      {action && (
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={busy}
          aria-label={t(action === "stage" ? "changes.stage" : "changes.unstage", { path: item.path })}
          onClick={onAction}
          className="absolute top-0.5 right-1 opacity-60 group-focus-within/row:opacity-100 group-hover/row:opacity-100"
        >
          {action === "stage" ? <Plus /> : <Minus />}
        </Button>
      )}
    </li>
  );
}

type GroupProps = {
  title: string;
  items: ChangeItem[];
  action: "stage" | "unstage" | null;
  run: (paths: string[]) => void;
  busy: boolean;
};

function Group({ title, items, action, run, busy }: GroupProps) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="mb-3">
      <header className="flex h-7 items-center justify-between px-2 text-[12px] font-medium text-muted-foreground">
        <span>
          {title} <span className="font-mono">{items.length}</span>
        </span>
        {action && (
          <Button variant="ghost" size="xs" disabled={busy} onClick={() => run(pathsOf(items))}>
            {action === "stage" ? t("changes.stageAll") : t("changes.unstageAll")}
          </Button>
        )}
      </header>
      <ul>
        {items.map((item) => (
          <ChangeRow
            key={`${item.side}:${item.path}`}
            item={item}
            action={action}
            busy={busy}
            onAction={() => run(pathsOf([item]))}
          />
        ))}
      </ul>
    </section>
  );
}

/** Asks the preferred agent for a message describing the staged changes, then fills it in. */
function useGeneratedMessage(repoPath: string, onMessage: (message: string) => void) {
  const t = useT();
  const installed = useInstalledAgents().data;
  const preferred = useAgentsStore((s) => s.preferredAgent);
  const [pending, setPending] = useState(false);
  const agent = pickAgent(installed, preferred);

  const generate = async () => {
    if (!agent) return;
    setPending(true);
    const id = await startAgentRun(repoPath, agent, { kind: "commit-message" }, t("agents.commitMessage"));
    if (!id) return setPending(false);
    // Waits for the run to end, then fills the message with the agent's answer.
    const settle = () => {
      const run = useAgentsStore.getState().runs.find((r) => r.id === id);
      if (!run || run.status === "running") return false;
      const answer = run.status === "done" ? finalAnswer(run) : null;
      if (answer) onMessage(answer.trim());
      setPending(false);
      return true;
    };
    if (settle()) return;
    const unsubscribe = useAgentsStore.subscribe(() => settle() && unsubscribe());
  };
  return { available: agent !== null, pending, generate };
}

function CommitForm({ repoPath, stagedCount }: { repoPath: string; stagedCount: number }) {
  const t = useT();
  const [message, setMessage] = useState("");
  const generated = useGeneratedMessage(repoPath, setMessage);
  const commit = useGitAction(repoPath, {
    run: () => gitBackend.createCommit(repoPath, message),
    success: t("changes.committed"),
    failure: t("changes.commitFailed"),
  });
  const canCommit = stagedCount > 0 && message.trim().length > 0 && !commit.isPending;
  const submit = () => canCommit && commit.mutate(undefined, { onSuccess: () => setMessage("") });

  return (
    <form
      className="flex flex-col gap-2 border-t p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Textarea
        aria-label={t("changes.message")}
        placeholder={t("changes.messagePlaceholder")}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.metaKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="min-h-20 resize-none bg-transparent text-[13px] md:text-[13px]"
      />
      {generated.available && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={stagedCount === 0 || generated.pending}
          onClick={() => void generated.generate()}
          className="h-7 gap-1.5 text-[13px]"
        >
          {generated.pending ? <BrailleLoader /> : <Sparkles aria-hidden className="size-3.5 text-primary" />}
          {generated.pending ? t("agents.writingMessage") : t("agents.generateMessage")}
        </Button>
      )}
      <Button type="submit" disabled={!canCommit}>
        {commit.isPending && <BrailleLoader />}
        {stagedCount === 0 ? t("changes.stageFirst") : t.plural("changes.commit", stagedCount)}
      </Button>
    </form>
  );
}

export function ChangesPanel({ repoPath }: { repoPath: string }) {
  const t = useT();
  const tree = useWorkingTree(repoPath);
  const groups = useMemo(() => groupChanges(tree.data ?? []), [tree.data]);
  const stage = useGitAction<string[]>(repoPath, {
    run: (paths) => gitBackend.stageFiles(repoPath, paths),
    failure: t("changes.stageFailed"),
  });
  const unstage = useGitAction<string[]>(repoPath, {
    run: (paths) => gitBackend.unstageFiles(repoPath, paths),
    failure: t("changes.unstageFailed"),
  });
  const busy = stage.isPending || unstage.isPending;
  const empty = tree.data && tree.data.length === 0;

  return (
    <section aria-label={t("changes.title")} className="flex h-full flex-col bg-panel">
      <PanelHeader>
        <h2 data-tauri-drag-region className="text-sm font-semibold">
          {t("changes.title")}
        </h2>
      </PanelHeader>
      <BranchStatus repoPath={repoPath} />
      {tree.isError ? (
        <DataUnavailable title={t("changes.readError")} error={tree.error} onRetry={() => void tree.refetch()} />
      ) : !tree.data ? (
        <PanelLoading title={t("changes.reading")} variant="grid-searching" />
      ) : (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2">
          {empty && (
            <p className="mx-1 mb-2 flex items-center gap-2 rounded-md px-2 py-2 text-[12.5px] text-muted-foreground">
              <CircleCheck aria-hidden className="size-3.5 text-added-foreground" />
              {t("changes.clean")} · {t("changes.cleanHint")}
            </p>
          )}
          {groups.conflicted.length > 0 && (
            <p
              role="alert"
              className="mx-2 mb-2 rounded-md border border-removed/50 p-2 text-xs text-removed-foreground"
            >
              {t("changes.conflictsHelp")}
            </p>
          )}
          <Group
            title={t("changes.conflicts")}
            items={groups.conflicted}
            action="stage"
            run={stage.mutate}
            busy={busy}
          />
          <Group title={t("changes.staged")} items={groups.staged} action="unstage" run={unstage.mutate} busy={busy} />
          <Group title={t("changes.unstaged")} items={groups.unstaged} action="stage" run={stage.mutate} busy={busy} />
          <RecentCommits repoPath={repoPath} />
        </div>
      )}
      <CommitForm repoPath={repoPath} stagedCount={groups.staged.length} />
    </section>
  );
}
