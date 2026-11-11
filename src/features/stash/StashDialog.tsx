import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ask } from "@tauri-apps/plugin-dialog";
import { Archive, GitBranchPlus } from "lucide-react";
import { DataUnavailable, EmptyState } from "@/components/states";
import { DiffSkeleton, RowSkeleton, SkeletonList } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DiffBody, DiffCard } from "@/features/diff/DiffCard";
import { useGitAction } from "@/features/operations/use-git-action";
import { useT } from "@/i18n";
import { formatAge } from "@/lib/format-date";
import { repoKey, useCommitDiff, useCommitFiles } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useNoticesStore } from "@/stores/notices-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { ChangedFile, StashEntry } from "@/types/git";
import { useStashStore } from "./stash-store";

function useStashes(repoPath: string) {
  return useQuery({
    queryKey: [...repoKey(repoPath), "stashes"],
    queryFn: () => gitBackend.listStashes(repoPath),
  });
}

/** The stashes: list on the left, the selected one's diff on the right, and what can be done with it. */
export function StashDialog({ repoPath }: { repoPath: string }) {
  const t = useT();
  const open = useStashStore((s) => s.open);
  const setOpen = useStashStore((s) => s.setOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[82vh] flex-col gap-0 overflow-hidden rounded-xl border-white/10 p-0 sm:max-w-[1180px]"
      >
        <DialogTitle className="border-b border-white/[0.07] px-5 py-3.5 text-[14px]">{t("stash.title")}</DialogTitle>
        {/* Mounted only while open: nothing is queried for a closed dialog. */}
        {open && <StashBody repoPath={repoPath} />}
      </DialogContent>
    </Dialog>
  );
}

function StashBody({ repoPath }: { repoPath: string }) {
  const t = useT();
  const stashes = useStashes(repoPath);
  const selectedHash = useStashStore((s) => s.selected);
  const list = stashes.data ?? [];
  const selected = list.find((s) => s.hash === selectedHash) ?? list[0] ?? null;
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[300px] shrink-0 flex-col border-r border-white/[0.07]">
        <CreateStash repoPath={repoPath} />
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {stashes.isError ? (
            <DataUnavailable
              title={t("stash.loadError")}
              error={stashes.error}
              onRetry={() => void stashes.refetch()}
            />
          ) : !stashes.data ? (
            <SkeletonList rows={6} row={(i) => <RowSkeleton i={i} height={48} lead={null} trail={false} />} />
          ) : list.length === 0 ? (
            <EmptyState size="sm" icon={<Archive />} title={t("stash.empty")} hint={t("stash.emptyHint")} />
          ) : (
            list.map((stash) => <StashRow key={stash.hash} stash={stash} selected={stash.hash === selected?.hash} />)
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {selected && <StashDetail key={selected.hash} repoPath={repoPath} stash={selected} />}
      </div>
    </div>
  );
}

function CreateStash({ repoPath }: { repoPath: string }) {
  const t = useT();
  const [message, setMessage] = useState("");
  const [untracked, setUntracked] = useState(true);
  const create = useGitAction(repoPath, {
    run: () => gitBackend.createStash(repoPath, message, untracked),
    success: t("stash.created"),
    failure: t("stash.createFailed"),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(undefined, { onSuccess: () => setMessage("") });
  };
  return (
    <form onSubmit={submit} className="space-y-2 border-b border-white/[0.07] p-3">
      <Input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t("stash.messagePlaceholder")}
        aria-label={t("stash.message")}
        className="h-8 text-[12.5px] md:text-[12.5px]"
      />
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Checkbox checked={untracked} onCheckedChange={(v) => setUntracked(v === true)} />
          {t("stash.includeUntracked")}
        </label>
        <Button type="submit" size="xs" disabled={create.isPending}>
          {t("stash.create")}
        </Button>
      </div>
    </form>
  );
}

function StashRow({ stash, selected }: { stash: StashEntry; selected: boolean }) {
  const t = useT();
  const select = useStashStore((s) => s.select);
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={() => select(stash.hash)}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left outline-none hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-white/[0.07] hover:bg-white/[0.07]",
      )}
    >
      <span className="truncate text-[12.5px]">{stash.message || `stash@{${stash.index}}`}</span>
      <span className="flex gap-1.5 truncate text-[11.5px] text-muted-foreground">
        <span className="truncate font-mono">{stash.branch ?? t("changes.detached")}</span>·
        <span className="shrink-0">{formatAge(stash.createdAt, undefined, t.locale)}</span>·
        <span className="shrink-0">{t.plural("stash.files", stash.fileCount)}</span>
      </span>
    </button>
  );
}

function useStashActions(repoPath: string, stash: StashEntry) {
  const t = useT();
  const notify = useNoticesStore((s) => s.notify);
  const apply = useGitAction<boolean>(repoPath, {
    run: async (pop) => {
      const outcome = await gitBackend.applyStash(repoPath, stash.index, stash.hash, pop);
      if (!outcome.conflicts) {
        notify({ tone: "success", title: t(pop ? "stash.popped" : "stash.applied") });
        return;
      }
      // Conflicts wait in the working tree, where the Changes view resolves them; the stash stays.
      notify({
        tone: "error",
        title: t("stash.conflicts"),
        detail: t("stash.conflictsHint"),
        action: {
          label: t("stash.openChanges"),
          run: () => {
            useStashStore.getState().setOpen(false);
            useWorkspaceStore.getState().setView("changes");
          },
        },
      });
    },
    failure: t("stash.applyFailed"),
  });
  const drop = useGitAction(repoPath, {
    run: () => gitBackend.dropStash(repoPath, stash.index, stash.hash),
    success: t("stash.dropped"),
    failure: t("stash.dropFailed"),
  });
  const branch = useGitAction<string>(repoPath, {
    run: (name) => gitBackend.branchFromStash(repoPath, stash.index, stash.hash, name),
    success: t("stash.branched"),
    failure: t("stash.branchFailed"),
  });
  const confirmDrop = async () => {
    const sure = await ask(t("stash.dropConfirm", { message: stash.message }), {
      kind: "warning",
      okLabel: t("stash.drop"),
    });
    if (sure) drop.mutate();
  };
  return { apply, branch, confirmDrop, busy: apply.isPending || drop.isPending || branch.isPending };
}

function StashDetail({ repoPath, stash }: { repoPath: string; stash: StashEntry }) {
  const t = useT();
  const { apply, branch, confirmDrop, busy } = useStashActions(repoPath, stash);
  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-white/[0.07] px-4">
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{stash.message}</p>
        <Button size="xs" variant="secondary" disabled={busy} onClick={() => apply.mutate(false)}>
          {t("stash.apply")}
        </Button>
        <Button size="xs" variant="secondary" disabled={busy} onClick={() => apply.mutate(true)}>
          {t("stash.pop")}
        </Button>
        <BranchFromStash disabled={busy} onCreate={(name) => branch.mutate(name)} />
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => void confirmDrop()}>
          {t("stash.drop")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-2.5 pt-2.5 pb-3">
        <StashFiles repoPath={repoPath} hash={stash.hash} />
        {stash.untracked && (
          <>
            <h3 className="px-1 pt-1 text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">
              {t("stash.untracked")}
            </h3>
            <StashFiles repoPath={repoPath} hash={stash.untracked} />
          </>
        )}
      </div>
    </>
  );
}

function BranchFromStash({ disabled, onCreate }: { disabled: boolean; onCreate: (name: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim());
    setOpen(false);
    setName("");
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="xs" variant="secondary" disabled={disabled}>
          <GitBranchPlus />
          {t("stash.branch")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <form onSubmit={submit} className="space-y-2">
          <p className="text-[12px] text-muted-foreground">{t("stash.branchHint")}</p>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("stash.branchName")}
            aria-label={t("stash.branchName")}
            className="h-8 font-mono text-[12.5px] md:text-[12.5px]"
          />
          <Button type="submit" size="xs" className="w-full" disabled={!name.trim()}>
            {t("stash.branchCreate")}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** A stash's changes against the commit it was taken on (or, for its untracked part, all added files). */
function StashFiles({ repoPath, hash }: { repoPath: string; hash: string }) {
  const t = useT();
  const files = useCommitFiles(repoPath, hash);
  if (files.isError)
    return (
      <DataUnavailable title={t("diff.loadFilesError")} error={files.error} onRetry={() => void files.refetch()} />
    );
  if (!files.data) return <DiffSkeleton />;
  return files.data.map((file) => <StashFileDiff key={file.path} repoPath={repoPath} hash={hash} file={file} />);
}

function StashFileDiff({ repoPath, hash, file }: { repoPath: string; hash: string; file: ChangedFile }) {
  const [open, setOpen] = useState(true);
  const diff = useCommitDiff(repoPath, hash, file.path, file.previousPath, open);
  return (
    <DiffCard file={file} open={open} onToggle={() => setOpen((o) => !o)}>
      <DiffBody
        path={file.path}
        diff={diff.data}
        error={diff.error}
        loading={diff.isPending}
        image={{ repoPath, hash, base: null, status: file.status }}
      />
    </DiffCard>
  );
}
