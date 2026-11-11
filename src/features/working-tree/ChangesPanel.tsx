import { useShallow } from "zustand/react/shallow";
import { DataUnavailable, EmptyState } from "@/components/states";
import { RowSkeleton, SkeletonList } from "@/components/skeletons";
import { useMemo, useState } from "react";
import { ArrowDown, CircleCheck, GitBranch, Minus, Plus, Sparkles, Split } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { pickAgent } from "@/features/agents/AgentButton";
import { startAgentRun, useInstalledAgents } from "@/features/agents/use-agents";
import { finalAnswer, useAgentsStore } from "@/stores/agents-store";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { PanelHeader } from "@/components/layout/panel";
import { useCommits, useRefs, useWorkingTree } from "@/lib/git-queries";
import { formatAge } from "@/lib/format-date";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useGitAction } from "@/features/operations/use-git-action";
import { FILE_STATUS } from "@/features/changed-files/file-status";
import { groupChanges, pathsOf, type ChangeItem } from "./group-changes";
import { useT } from "@/i18n";
import { BranchStatus, RecentCommits } from "./BranchContext";
import { LfsBadge, LfsSection, SubmodulesSection } from "./RepoModules";
import { StashButton } from "@/features/stash/StashButton";
import { parseCommitPlan } from "./commit-plan";
import { SplitPlanDialog } from "./SplitPlanDialog";
import { useNoticesStore } from "@/stores/notices-store";
import type { AgentTask, CommitGroup } from "@/types/git";

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
        <LfsBadge path={item.path} />
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

/** Runs a one-shot task on the preferred agent, then hands its final answer to `onAnswer`. */
function useAgentAnswer(repoPath: string, task: AgentTask, title: string, onAnswer: (answer: string) => void) {
  const installed = useInstalledAgents().data;
  const preferred = useAgentsStore((s) => s.preferredAgent);
  const [pending, setPending] = useState(false);
  const agent = pickAgent(installed, preferred);

  const generate = async () => {
    if (!agent) return;
    setPending(true);
    const id = await startAgentRun(repoPath, agent, task, title);
    if (!id) return setPending(false);
    // Waits for the run to end, then hands over the agent's answer.
    const settle = () => {
      const run = useAgentsStore.getState().runs.find((r) => r.id === id);
      if (!run || run.status === "running") return false;
      const answer = run.status === "done" ? finalAnswer(run) : null;
      if (answer) onAnswer(answer.trim());
      setPending(false);
      return true;
    };
    if (settle()) return;
    const unsubscribe = useAgentsStore.subscribe(() => settle() && unsubscribe());
  };
  return { available: agent !== null, pending, generate };
}

/** "Split into commits with AI": asks the agent for a plan, validates it, then shows it for editing. */
function AiSplit({ repoPath, changed }: { repoPath: string; changed: string[] }) {
  const t = useT();
  const notify = useNoticesStore((s) => s.notify);
  const [plan, setPlan] = useState<CommitGroup[] | null>(null);
  const planner = useAgentAnswer(repoPath, { kind: "split-commits" }, t("aiSplit.agentTitle"), (answer) => {
    try {
      setPlan(parseCommitPlan(answer, new Set(changed)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify({ tone: "error", title: t("aiSplit.invalid", { message }), detail: answer });
    }
  });
  if (!planner.available) return null;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={changed.length === 0 || planner.pending}
        onClick={() => void planner.generate()}
        className="h-7 gap-1.5 text-[13px]"
      >
        {planner.pending ? <BrailleLoader /> : <Sparkles aria-hidden className="size-3.5 text-primary" />}
        {planner.pending ? t("aiSplit.pending") : t("aiSplit.button")}
      </Button>
      {plan && <SplitPlanDialog repoPath={repoPath} plan={plan} changed={changed} onClose={() => setPlan(null)} />}
    </>
  );
}

/** Split mode: one commit at a time from what is staged; the step number tells which commit is next. */
function SplitBanner({ step, onStop }: { step: number; onStop: () => void }) {
  const t = useT();
  return (
    <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/[0.06] px-2.5 py-2">
      <p className="flex-1 text-[12px] text-muted-foreground">
        <span className="font-medium text-foreground">{t("split.step", { number: step })}</span> · {t("split.hint")}
      </p>
      <Button type="button" variant="ghost" size="xs" onClick={onStop}>
        {t("split.stop")}
      </Button>
    </div>
  );
}

/** Whether HEAD can be amended without rewriting published history: not when its upstream already has it. */
function useAmendable(repoPath: string) {
  const refs = useRefs(repoPath).data;
  const branch = refs?.branches.find((b) => b.name === refs.head.branch);
  return {
    available: refs !== undefined && !refs.head.unborn,
    pushed: !!branch?.upstream && branch.ahead === 0,
  };
}

function CommitForm({ repoPath, stagedCount, changed }: { repoPath: string; stagedCount: number; changed: string[] }) {
  const t = useT();
  const [message, setMessage] = useState("");
  // The message typed before turning Amend on, given back when it's turned off.
  const [draft, setDraft] = useState<string | null>(null);
  const [splitStep, setSplitStep] = useState<number | null>(null);
  const amendable = useAmendable(repoPath);
  const amend = draft !== null && amendable.available && !amendable.pushed;
  const generated = useAgentAnswer(repoPath, { kind: "commit-message" }, t("agents.commitMessage"), setMessage);
  const commit = useGitAction(repoPath, {
    run: () => (amend ? gitBackend.amendCommit(repoPath, message) : gitBackend.createCommit(repoPath, message)),
    success: amend ? t("changes.amended") : t("changes.committed"),
    failure: amend ? t("changes.amendFailed") : t("changes.commitFailed"),
  });
  const canCommit = (amend || stagedCount > 0) && message.trim().length > 0 && !commit.isPending;
  const submit = () =>
    canCommit &&
    commit.mutate(undefined, {
      onSuccess: () => {
        setMessage("");
        setDraft(null);
        setSplitStep((step) => (step === null ? null : step + 1));
      },
    });
  const toggleAmend = (on: boolean) => {
    if (!on) {
      setMessage(draft ?? "");
      return setDraft(null);
    }
    setDraft(message);
    gitBackend.headMessage(repoPath).then(setMessage, () => undefined);
  };

  return (
    <form
      className="flex flex-col gap-2 border-t p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {splitStep !== null && <SplitBanner step={splitStep} onStop={() => setSplitStep(null)} />}
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
        {amend
          ? t("changes.amendSubmit")
          : stagedCount === 0
            ? t("changes.stageFirst")
            : t.plural("changes.commit", stagedCount)}
      </Button>
      <div className="flex flex-wrap gap-1">
        {splitStep === null && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={changed.length === 0}
            onClick={() => setSplitStep(1)}
            className="h-7 gap-1.5 text-[13px]"
          >
            <Split aria-hidden className="size-3.5" />
            {t("split.start")}
          </Button>
        )}
        <AiSplit repoPath={repoPath} changed={changed} />
        {amendable.available && (
          <label
            title={t(amendable.pushed ? "changes.amendPushed" : "changes.amendHint")}
            className={cn(
              "ml-auto flex h-7 items-center gap-2 px-2 text-[12.5px] text-muted-foreground",
              amendable.pushed && "opacity-50",
            )}
          >
            <Checkbox checked={amend} disabled={amendable.pushed} onCheckedChange={(v) => toggleAmend(v === true)} />
            {t("changes.amend")}
          </label>
        )}
      </div>
    </form>
  );
}

/** Clean working tree: says so, recalls the last commit, and offers what usually comes next. */
function CleanTree({ repoPath }: { repoPath: string }) {
  const t = useT();
  const last = useCommits(repoPath, null).data?.pages[0]?.[0];
  const refs = useRefs(repoPath).data;
  const upstream = refs?.branches.find((b) => b.name === refs.head.branch)?.upstream;
  const setView = useWorkspaceStore((s) => s.setView);
  const pull = useGitAction(repoPath, {
    run: () => gitBackend.pull(repoPath),
    success: t("sync.pulled"),
    failure: t("sync.pullFailed"),
  });
  return (
    <EmptyState
      size="sm"
      className="h-auto"
      icon={<CircleCheck className="text-added-foreground" />}
      title={t("changes.clean")}
      hint={t("changes.cleanHint")}
      action={
        upstream
          ? {
              label: t("sync.pull"),
              icon: pull.isPending ? <BrailleLoader /> : <ArrowDown aria-hidden />,
              onClick: () => pull.mutate(),
              disabled: pull.isPending,
            }
          : undefined
      }
      secondary={{
        label: t("changes.switchBranch"),
        icon: <GitBranch aria-hidden />,
        onClick: () => setView("work"),
      }}
    >
      {last && (
        <p className="mt-2 flex max-w-full min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
          <span className="shrink-0">{t("changes.lastCommit")}</span>
          <span className="min-w-0 truncate text-foreground/85">{last.subject}</span>
          <span className="shrink-0 tabular-nums">· {formatAge(last.authoredAt, undefined, t.locale)}</span>
        </p>
      )}
    </EmptyState>
  );
}

export function ChangesPanel({ repoPath }: { repoPath: string }) {
  const t = useT();
  const tree = useWorkingTree(repoPath);
  const groups = useMemo(() => groupChanges(tree.data ?? []), [tree.data]);
  // What a commit may take (both sides of a rename): the same set the backend checks a split plan against.
  const changed = useMemo(
    () =>
      (tree.data ?? [])
        .filter((e) => !e.conflicted)
        .flatMap((e) => [e.path, ...(e.previousPath ? [e.previousPath] : [])]),
    [tree.data],
  );
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
        <StashButton repoPath={repoPath} />
      </PanelHeader>
      <BranchStatus repoPath={repoPath} />
      {tree.isError ? (
        <DataUnavailable title={t("changes.readError")} error={tree.error} onRetry={() => void tree.refetch()} />
      ) : !tree.data ? (
        <SkeletonList
          rows={8}
          className="mt-3 min-h-0 flex-1 px-2"
          row={(i) => <RowSkeleton i={i} height={28} lines={1} trail={false} className="pl-2" />}
        />
      ) : (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2">
          {empty && <CleanTree repoPath={repoPath} />}
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
          <SubmodulesSection repoPath={repoPath} />
          <LfsSection repoPath={repoPath} />
          <RecentCommits repoPath={repoPath} />
        </div>
      )}
      <CommitForm repoPath={repoPath} stagedCount={groups.staged.length} changed={changed} />
    </section>
  );
}
