import { useShallow } from "zustand/react/shallow";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Eye, Globe, Play, Server, Smartphone, Square } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { DataUnavailable, EmptyState } from "@/components/states";
import { PanelLoading } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useNoticesStore } from "@/stores/notices-store";
import { runOf, usePreviewStore } from "@/stores/preview-store";
import type { PreviewTarget } from "@/types/git";

export function usePreviewTargets(repoPath: string) {
  return useQuery({ queryKey: ["preview-targets", repoPath], queryFn: () => gitBackend.listPreviewTargets(repoPath) });
}

/** Starts a target and shows it. An app already up inside a monorepo run is only shown: a second
 * copy would grab the next free port, possibly another service's (e.g. the API's), and break it. */
export function startPreview(repoPath: string, target: PreviewTarget) {
  const { select, setDevice, runs } = usePreviewStore.getState();
  select(target.id);
  if (target.kind === "expo" || target.kind === "flutter") setDevice("mobile");
  if (runOf(runs, target.id).inWorkspace) return Promise.resolve();
  return startBackground(repoPath, target);
}

/** Starts a target without leaving the current one (e.g. the API behind a front-end). */
export async function startBackground(repoPath: string, target: PreviewTarget) {
  usePreviewStore.getState().start(target.id);
  try {
    await gitBackend.startPreview(repoPath, target.id);
  } catch (error) {
    const { message, detail } = toGitError(error);
    usePreviewStore.getState().apply({ type: "exited", targetId: target.id, code: 1 });
    useNoticesStore.getState().notify({ tone: "error", title: message, detail });
  }
}

function Row({ repoPath, target }: { repoPath: string; target: PreviewTarget }) {
  const t = useT();
  // Primitives only: the app's log lines don't re-render the list.
  const run = usePreviewStore(
    useShallow((s) => {
      const { status, inWorkspace } = runOf(s.runs, target.id);
      return { status, inWorkspace };
    }),
  );
  const selected = usePreviewStore((s) => s.selected === target.id);
  const select = usePreviewStore((s) => s.select);
  const live = run.status === "starting" || run.status === "ready";
  const Icon = { server: Server, web: Globe, workspace: Boxes, expo: Smartphone, flutter: Smartphone }[target.kind];
  return (
    <li
      className={cn(
        "group/app flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.06]",
        selected && "bg-white/10",
      )}
    >
      <button
        type="button"
        onClick={() => select(target.id)}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none"
      >
        <span className="relative">
          <Icon aria-hidden className="size-4 text-muted-foreground" />
          {run.status === "ready" && (
            <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-added-foreground ring-2 ring-sidebar" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12.5px]">{target.name}</span>
          <span className="block truncate text-[11.5px] text-muted-foreground">
            {target.framework} · {run.inWorkspace ? t("preview.viaMonorepo") : target.dir}
          </span>
        </span>
      </button>
      {run.status === "starting" && <BrailleLoader className="text-primary" />}
      {
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={run.inWorkspace ? t("preview.open") : live ? t("preview.stop") : t("preview.start")}
          title={run.inWorkspace ? t("preview.viaMonorepo") : undefined}
          onClick={() =>
            run.inWorkspace
              ? select(target.id)
              : live
                ? void gitBackend.stopPreview(target.id)
                : void startPreview(repoPath, target)
          }
          className="size-7 text-muted-foreground"
        >
          {run.inWorkspace ? (
            <Eye className="size-3.5" />
          ) : live ? (
            <Square className="size-3.5" />
          ) : (
            <Play className="size-3.5" />
          )}
        </Button>
      }
    </li>
  );
}

/** Sidebar of the Preview view: every runnable app found in the repository. */
export function PreviewList({ repoPath }: { repoPath: string }) {
  const t = useT();
  const targets = usePreviewTargets(repoPath);
  if (targets.isError)
    return (
      <DataUnavailable title={t("preview.detectError")} error={targets.error} onRetry={() => void targets.refetch()} />
    );
  if (!targets.data) return <PanelLoading title={t("preview.detecting")} variant="grid-searching" />;
  if (targets.data.length === 0) {
    return <EmptyState size="sm" icon={<Globe />} title={t("preview.noApps")} hint={t("preview.noAppsHint")} />;
  }
  return (
    <nav aria-label={t("view.preview")} className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {(["monorepo", "apps", "backends"] as const).map((group) => {
        const groupOf = (kind: PreviewTarget["kind"]) =>
          kind === "workspace" ? "monorepo" : kind === "server" ? "backends" : "apps";
        const members = targets.data.filter((x) => groupOf(x.kind) === group);
        if (members.length === 0) return null;
        return (
          <section key={group} className="mb-3">
            <h3 className="px-2.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {t(`preview.${group}`)}
            </h3>
            <ul>
              {members.map((target) => (
                <Row key={target.id} repoPath={repoPath} target={target} />
              ))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
