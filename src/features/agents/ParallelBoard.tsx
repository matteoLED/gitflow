import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Columns2, GitMerge, GitPullRequestArrow, MessageSquare, Trash2 } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { PanelHeader } from "@/components/layout/panel";
import { DataUnavailable, EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DiffBody, DiffCard } from "@/features/diff/DiffCard";
import { useT, type MessageKey } from "@/i18n";
import { formatAge } from "@/lib/format-date";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useAgentsStore, type RunStatus } from "@/stores/agents-store";
import { ClaudeIcon, CodexIcon } from "./agent-icons";
import {
  boardRows,
  compareTouched,
  splitPatch,
  totals,
  type BoardRow,
  type FileCounts,
  type PatchFile,
} from "./parallel-board";
import { StatusIcon } from "./status";
import { useWorktreeActions } from "./use-worktree-actions";

const STATUS_LABEL: Record<RunStatus, MessageKey> = {
  running: "board.running",
  done: "board.done",
  failed: "board.failed",
  cancelled: "board.cancelled",
};

const ICON_BUTTON =
  "grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-white/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35";

/** Collapsed past this many files, so a big branch doesn't render every file at once. */
const OPEN_LIMIT = 10;

function useWorktreeDiff(repoPath: string, path: string, running: boolean) {
  return useQuery({
    queryKey: ["agent-worktree-diff", repoPath, path],
    queryFn: async () => splitPatch(await gitBackend.agentWorktreeDiff(repoPath, path)),
    refetchInterval: running ? 10_000 : false,
    retry: false,
  });
}

function Counts({ counts }: { counts: FileCounts | null }) {
  if (!counts) return <span className="text-muted-foreground/50">—</span>;
  return (
    <span className="font-mono text-[11px] tabular-nums">
      <span className="text-added-foreground">+{counts.additions}</span>{" "}
      <span className="text-removed-foreground">-{counts.deletions}</span>
    </span>
  );
}

function PatchList({ files }: { files: PatchFile[] }) {
  const t = useT();
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const toggle = (path: string) =>
    setToggled((set) => {
      const next = new Set(set);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  if (files.length === 0) return <p className="py-3 text-[12.5px] text-muted-foreground">{t("board.noDiff")}</p>;
  return (
    <div className="space-y-2">
      {files.map((file) => (
        <DiffCard
          key={file.path}
          file={file}
          open={files.length <= OPEN_LIMIT !== toggled.has(file.path)}
          onToggle={() => toggle(file.path)}
        >
          <DiffBody path={file.path} diff={file} loading={false} />
        </DiffCard>
      ))}
    </div>
  );
}

function Section({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 flex items-center gap-2 text-[12.5px] font-medium">
        {title}
        <span className="ml-auto">{aside}</span>
      </h3>
      {children}
    </section>
  );
}

function WorktreeDiff({ repoPath, row }: { repoPath: string; row: BoardRow }) {
  const t = useT();
  const { worktree } = row;
  const diff = useWorktreeDiff(repoPath, worktree.path, row.status === "running");
  return (
    <Section
      title={t("board.diffOf", { branch: worktree.branch })}
      aside={diff.data ? <Counts counts={totals(diff.data)} /> : diff.isPending && <BrailleLoader />}
    >
      {diff.isError && <DataUnavailable title={t("board.diffOf", { branch: worktree.branch })} error={diff.error} />}
      {diff.data && <PatchList files={diff.data} />}
    </Section>
  );
}

function ComparePanel({ repoPath, a, b }: { repoPath: string; a: BoardRow; b: BoardRow }) {
  const t = useT();
  const [wa, wb] = [a.worktree, b.worktree];
  const diffA = useWorktreeDiff(repoPath, wa.path, a.status === "running");
  const diffB = useWorktreeDiff(repoPath, wb.path, b.status === "running");
  const between = useQuery({
    queryKey: ["agent-worktree-diff", repoPath, "compare", wa.path, wb.path],
    queryFn: async () => splitPatch(await gitBackend.compareAgentWorktrees(repoPath, wa.path, wb.path)),
    retry: false,
  });
  const touched = diffA.data && diffB.data ? compareTouched(diffA.data, diffB.data) : null;
  const head = "px-2 py-1.5 text-left text-[11.5px] font-medium text-muted-foreground";
  return (
    <>
      <Section title={t("board.touched")} aside={!touched && <BrailleLoader />}>
        {touched && diffA.data && diffB.data && (
          <table className="w-full table-fixed text-[12px]">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className={head} />
                {[
                  { worktree: wa, files: diffA.data },
                  { worktree: wb, files: diffB.data },
                ].map((side) => (
                  <th key={side.worktree.path} className={cn(head, "w-44")}>
                    <code className="font-mono">{side.worktree.branch}</code>
                    <span className="block font-normal">
                      <Counts counts={totals(side.files)} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {touched.map((f) => (
                <tr key={f.path} className="border-b border-white/[0.04]">
                  <td className="truncate px-2 py-1 font-mono text-[11.5px]" title={f.path}>
                    {f.path}
                  </td>
                  <td className="px-2 py-1">
                    <Counts counts={f.a} />
                  </td>
                  <td className="px-2 py-1">
                    <Counts counts={f.b} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <Section
        title={t("board.between", { a: wa.branch, b: wb.branch })}
        aside={between.isPending && <BrailleLoader />}
      >
        {between.isError && <DataUnavailable title={t("board.compare")} error={between.error} />}
        {between.data && <PatchList files={between.data} />}
      </Section>
    </>
  );
}

type RowProps = {
  repoPath: string;
  row: BoardRow;
  selected: boolean;
  comparing: boolean;
  picked: boolean;
  onSelect: () => void;
  onPick: () => void;
};

function Row({ repoPath, row, selected, comparing, picked, onSelect, onPick }: RowProps) {
  const t = useT();
  const open = useAgentsStore((s) => s.select);
  const { run, worktree, status: runStatus } = row;
  const running = runStatus === "running";
  const { status, changes, busy, merge, publish, remove } = useWorktreeActions(repoPath, worktree, run.title, running);
  if (status.isError) return null; // removed, here or by hand
  const Icon = run.agent === "claude" ? ClaudeIcon : CodexIcon;
  const cell = "px-2 py-1.5";
  return (
    <tr
      onClick={comparing ? onPick : onSelect}
      className={cn(
        "cursor-default border-b border-white/[0.04] text-[12.5px] hover:bg-white/[0.03]",
        (comparing ? picked : selected) && "bg-white/[0.06] hover:bg-white/[0.06]",
      )}
    >
      <td className={cn(cell, "border-l-2", run.group ? "border-l-primary/60" : "border-l-transparent")}>
        <div className="flex min-w-0 items-center gap-2">
          {comparing && (
            <Checkbox
              checked={picked}
              onClick={(e) => e.stopPropagation()}
              onCheckedChange={onPick}
              aria-label={t("board.pick", { branch: worktree.branch })}
            />
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (comparing) onPick();
              else onSelect();
            }}
            title={run.group ? `${t("board.group")} · ${run.title}` : run.title}
            className="min-w-0 truncate rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {run.title}
          </button>
        </div>
      </td>
      <td className={cell}>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className={cn("size-3.5 shrink-0", run.agent === "claude" && "text-[#d97757]")} />
          {run.agent === "claude" ? "Claude" : "Codex"}
        </span>
      </td>
      <td className={cell}>
        <span className="flex items-center gap-1.5">
          <StatusIcon status={runStatus} />
          {t(STATUS_LABEL[runStatus])}
        </span>
      </td>
      <td className={cn(cell, "truncate")}>
        <code className="rounded bg-white/[0.06] px-1.5 font-mono text-[11.5px]">{worktree.branch}</code>
      </td>
      <td className={cn(cell, "text-muted-foreground")}>
        {status.data
          ? [t.plural("worktree.changed", status.data.changed), t.plural("worktree.commits", status.data.ahead)].join(
              " · ",
            )
          : "…"}
      </td>
      <td className={cn(cell, "text-muted-foreground")}>{formatAge(row.lastActivity, undefined, t.locale)}</td>
      <td className={cell} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-0.5">
          {busy && <BrailleLoader className="mr-1 text-primary" />}
          <button
            type="button"
            aria-label={t("board.openConversation")}
            title={t("board.openConversation")}
            onClick={() => open({ type: "run", id: run.id })}
            className={ICON_BUTTON}
          >
            <MessageSquare aria-hidden className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={t("worktree.pr")}
            title={running ? t("worktree.waitAgent") : t("worktree.pr")}
            disabled={running || changes === 0 || busy}
            onClick={publish}
            className={ICON_BUTTON}
          >
            <GitPullRequestArrow aria-hidden className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={t("worktree.merge")}
            title={running ? t("worktree.waitAgent") : t("worktree.merge")}
            disabled={running || changes === 0 || busy}
            onClick={merge}
            className={ICON_BUTTON}
          >
            <GitMerge aria-hidden className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={t("worktree.remove")}
            title={t("worktree.remove")}
            disabled={running || busy}
            onClick={() => void remove()}
            className={cn(ICON_BUTTON, "hover:bg-removed/20 hover:text-removed-foreground")}
          >
            <Trash2 aria-hidden className="size-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Every agent working in its own worktree, live: status, branch, what it changed, and the ways out. Selecting a
 * row shows its diff; Compare puts two side by side (e.g. the same prompt run by Claude and Codex).
 */
export function ParallelBoard({ repoPath }: { repoPath: string }) {
  const t = useT();
  const rows = boardRows(
    useAgentsStore((s) => s.runs),
    repoPath,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const select = useAgentsStore((s) => s.select);
  const [comparing, setComparing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const pick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));
  const selectedRow = rows.find((r) => r.run.id === selected);
  const [a, b] = picked.map((id) => rows.find((r) => r.run.id === id));
  const head = "px-2 py-1.5 text-left text-[11.5px] font-medium text-muted-foreground";
  return (
    <>
      <PanelHeader className="gap-2 px-4">
        <h2 className="text-[13px] font-medium">{t("board.open")}</h2>
        <Button
          variant={comparing ? "secondary" : "ghost"}
          size="xs"
          aria-pressed={comparing}
          onClick={() => setComparing((c) => !c)}
          className="ml-auto text-[12px]"
        >
          <Columns2 aria-hidden />
          {t("board.compare")}
        </Button>
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-10">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Columns2 />}
            title={t("board.emptyTitle")}
            hint={t("board.empty")}
            action={{ label: t("agents.startTask"), onClick: () => select({ type: "new" }) }}
          />
        ) : (
          <p className="mb-3 text-[12.5px] text-muted-foreground">{t("board.hint")}</p>
        )}
        {rows.length > 0 && (
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className={head}>{t("board.colTask")}</th>
                <th className={cn(head, "w-24")}>{t("board.colAgent")}</th>
                <th className={cn(head, "w-28")}>{t("board.colStatus")}</th>
                <th className={cn(head, "w-40")}>{t("board.colBranch")}</th>
                <th className={cn(head, "w-44")}>{t("board.colChanges")}</th>
                <th className={cn(head, "w-24")}>{t("board.colActivity")}</th>
                <th className={cn(head, "w-32")} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row
                  key={row.run.id}
                  repoPath={repoPath}
                  row={row}
                  selected={row.run.id === selected}
                  comparing={comparing}
                  picked={picked.includes(row.run.id)}
                  onSelect={() => setSelected(row.run.id === selected ? null : row.run.id)}
                  onPick={() => pick(row.run.id)}
                />
              ))}
            </tbody>
          </table>
        )}
        {comparing ? (
          a && b ? (
            <ComparePanel key={`${a.run.id}:${b.run.id}`} repoPath={repoPath} a={a} b={b} />
          ) : (
            rows.length > 1 && <p className="mt-4 text-[12.5px] text-muted-foreground">{t("board.pickTwo")}</p>
          )
        ) : (
          selectedRow && <WorktreeDiff key={selectedRow.run.id} repoPath={repoPath} row={selectedRow} />
        )}
      </div>
    </>
  );
}
