import { useState, type ReactNode } from "react";
import { Download, ExternalLink, FolderGit2, HardDrive, Plus, RefreshCw } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useGitAction } from "@/features/operations/use-git-action";
import { useOpenRepository } from "@/features/repositories/use-open-repository";
import { useLfsPaths, useLfsStatus, useSubmodules } from "@/lib/git-queries";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import type { Submodule, SubmoduleState } from "@/types/git";

const STATE_CLASS: Record<SubmoduleState, string> = {
  upToDate: "text-muted-foreground",
  uninitialized: "text-muted-foreground",
  outOfDate: "text-primary",
  modified: "text-ring",
  conflicted: "text-removed-foreground",
};

const needsUpdate = (s: Submodule) => s.state === "uninitialized" || s.state === "outOfDate";

function SectionHeader({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <header className="flex h-7 items-center gap-1.5 px-2 text-[12px] font-medium text-muted-foreground [&>svg]:size-3.5">
      {icon}
      <span className="mr-auto">{title}</span>
      {children}
    </header>
  );
}

function SubmoduleRow({ repoPath, sub }: { repoPath: string; sub: Submodule }) {
  const t = useT();
  const { reopen } = useOpenRepository();
  const update = useGitAction(repoPath, {
    run: () => gitBackend.updateSubmodules(repoPath, sub.path),
    success: t("submodules.updated"),
    failure: t("submodules.updateFailed"),
  });
  const shas = t("submodules.shas", {
    recorded: sub.recorded.slice(0, 7),
    checkedOut: sub.checkedOut?.slice(0, 7) ?? "—",
  });
  return (
    <li className="group/row flex h-7 items-center gap-2 rounded-md pr-1 pl-2 hover:bg-white/[0.05]" title={shas}>
      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{sub.path}</span>
      <span className={cn("shrink-0 text-[11.5px]", STATE_CLASS[sub.state])}>{t(`submodules.state.${sub.state}`)}</span>
      {needsUpdate(sub) && (
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={update.isPending}
          aria-label={`${t("submodules.initUpdate")} · ${sub.path}`}
          title={t("submodules.initUpdate")}
          onClick={() => update.mutate()}
        >
          {update.isPending ? <BrailleLoader /> : <RefreshCw />}
        </Button>
      )}
      {sub.state !== "uninitialized" && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("submodules.open", { path: sub.path })}
          title={t("submodules.open", { path: sub.path })}
          onClick={() => void reopen(`${repoPath}/${sub.path}`)}
        >
          <ExternalLink />
        </Button>
      )}
    </li>
  );
}

/** Submodules with recorded vs checked-out commits; init/update only on click (it may clone). */
export function SubmodulesSection({ repoPath }: { repoPath: string }) {
  const t = useT();
  const subs = useSubmodules(repoPath).data ?? [];
  const updateAll = useGitAction(repoPath, {
    run: () => gitBackend.updateSubmodules(repoPath, null),
    success: t("submodules.updated"),
    failure: t("submodules.updateFailed"),
  });
  if (subs.length === 0) return null;
  return (
    <section aria-label={t("submodules.title")} className="mb-3">
      <SectionHeader icon={<FolderGit2 aria-hidden />} title={`${t("submodules.title")} ${subs.length}`}>
        {subs.some(needsUpdate) && (
          <Button variant="ghost" size="xs" disabled={updateAll.isPending} onClick={() => updateAll.mutate()}>
            {updateAll.isPending && <BrailleLoader />}
            {t("submodules.initUpdateAll")}
          </Button>
        )}
      </SectionHeader>
      <ul>
        {subs.map((sub) => (
          <SubmoduleRow key={sub.path} repoPath={repoPath} sub={sub} />
        ))}
      </ul>
    </section>
  );
}

function TrackPattern({ repoPath }: { repoPath: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pattern, setPattern] = useState("");
  const track = useGitAction<string>(repoPath, {
    run: (value) => gitBackend.lfsTrack(repoPath, value),
    failure: t("lfs.trackFailed"),
  });
  const submit = () => {
    const value = pattern.trim();
    if (!value) return;
    track.mutate(value, {
      onSuccess: () => {
        setPattern("");
        setOpen(false);
      },
    });
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs">
          <Plus aria-hidden />
          {t("lfs.track")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            autoFocus
            aria-label={t("lfs.pattern")}
            placeholder={t("lfs.pattern")}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            className="h-7 font-mono text-[12px] md:text-[12px]"
          />
          <p className="text-[11px] leading-snug text-muted-foreground">{t("lfs.trackHint")}</p>
          <Button type="submit" size="sm" disabled={!pattern.trim() || track.isPending}>
            {track.isPending && <BrailleLoader />}
            {t("lfs.trackSubmit")}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Tracked patterns and explicit actions; renders nothing when git-lfs isn't installed. */
export function LfsSection({ repoPath }: { repoPath: string }) {
  const t = useT();
  const status = useLfsStatus(repoPath).data;
  const pull = useGitAction(repoPath, {
    run: () => gitBackend.lfsPull(repoPath),
    success: t("lfs.pulled"),
    failure: t("lfs.pullFailed"),
  });
  if (!status) return null;
  return (
    <section aria-label={t("lfs.title")} className="mb-3">
      <SectionHeader icon={<HardDrive aria-hidden />} title={t("lfs.title")}>
        {status.patterns.length > 0 && (
          <Button variant="ghost" size="xs" disabled={pull.isPending} onClick={() => pull.mutate()}>
            {pull.isPending ? <BrailleLoader /> : <Download aria-hidden />}
            {t("lfs.pull")}
          </Button>
        )}
        <TrackPattern repoPath={repoPath} />
      </SectionHeader>
      <p className="flex flex-wrap gap-1 px-2 text-[11.5px] text-muted-foreground">
        {status.patterns.length === 0
          ? t("lfs.noPatterns")
          : status.patterns.map((p) => (
              <span key={p} className="rounded border border-white/10 px-1.5 font-mono text-foreground/85">
                {p}
              </span>
            ))}
      </p>
    </section>
  );
}

function RepoLfsBadge({ repoPath, path }: { repoPath: string; path: string }) {
  const t = useT();
  if (!useLfsPaths(repoPath).has(path)) return null;
  return (
    <span
      title={t("lfs.badge")}
      className="shrink-0 rounded border border-white/12 px-1 font-sans text-[10px] leading-4 text-muted-foreground"
    >
      LFS
    </span>
  );
}

/** "LFS" next to a working-tree file that Git LFS stores (per `.gitattributes`). */
export function LfsBadge({ path }: { path: string }) {
  const repoPath = useWorkspaceStore((s) => s.repo?.path);
  return repoPath ? <RepoLfsBadge repoPath={repoPath} path={path} /> : null;
}
