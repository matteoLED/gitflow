import { useState, type ReactNode } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Package, Pencil, Plus, Tag as TagIcon, Trash2, Upload } from "lucide-react";
import { PanelHeader, PanelLoading } from "@/components/layout/panel";
import { DataUnavailable, EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { LazyMarkdown } from "@/features/agents/LazyMarkdown";
import { LinearIcon } from "@/features/linear/LinearIcon";
import { useActiveAccount } from "@/features/linear/linear-queries";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { formatAge } from "@/lib/format-date";
import { invalidateRepo } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useNoticesStore } from "@/stores/notices-store";
import type { Release, Tag } from "@/types/git";
import { ReleaseForm } from "./ReleaseForm";
import { groupByPipeline, LinearReleaseDetail, StageDot } from "./LinearReleases";
import { releasesKey, useLinearReleases, useReleases, useTags } from "./release-queries";
import { useReleasesStore, type ReleasesSelection } from "./releases-store";
import { TagDialog } from "./TagDialog";

const ROW =
  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-white/[0.06] aria-[current=true]:bg-white/[0.08]";

const same = (a: ReleasesSelection, b: ReleasesSelection) => JSON.stringify(a) === JSON.stringify(b);

function Badge({ children, tone }: { children: string; tone?: string }) {
  return (
    <span className={cn("shrink-0 rounded-full border border-white/15 px-1.5 text-[11px] leading-4", tone)}>
      {children}
    </span>
  );
}

function ReleaseBadges({ release }: { release: Release }) {
  const t = useT();
  if (release.draft) return <Badge>{t("releases.draft")}</Badge>;
  if (release.prerelease) return <Badge tone="text-renamed border-renamed/40">{t("releases.prerelease")}</Badge>;
  return null;
}

/** List column: Linear's releases (when connected), releases on GitHub, then local tags. One failing source leaves the others usable. */
export function ReleasesList({ repoPath, query }: { repoPath: string; query: string }) {
  const t = useT();
  const { selection, select } = useReleasesStore();
  const account = useActiveAccount();
  const linear = useLinearReleases(account?.id);
  const releases = useReleases(repoPath);
  const tags = useTags(repoPath).data ?? [];
  const [tagOpen, setTagOpen] = useState(false);
  const q = query.toLowerCase();
  const shownReleases = (releases.data ?? []).filter((r) => `${r.name ?? ""} ${r.tag_name}`.toLowerCase().includes(q));
  const shownTags = tags.filter((tag) => tag.name.toLowerCase().includes(q));
  const linearGroups = groupByPipeline(
    (linear.data?.releases ?? []).filter((r) => `${r.name} ${r.version ?? ""}`.toLowerCase().includes(q)),
  );
  const row = (target: ReleasesSelection, content: ReactNode) => (
    <li key={JSON.stringify(target)}>
      <button
        type="button"
        aria-current={same(selection, target) ? "true" : undefined}
        onClick={() => select(target)}
        className={ROW}
      >
        {content}
      </button>
    </li>
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2">
      <div className="flex gap-1.5 px-1 pb-2">
        <Button size="xs" variant="outline" onClick={() => select({ kind: "new", tag: null })}>
          <Plus aria-hidden />
          {t("releases.new")}
        </Button>
        <Button size="xs" variant="outline" onClick={() => setTagOpen(true)}>
          <TagIcon aria-hidden />
          {t("tags.new")}
        </Button>
      </div>
      {account && (
        <>
          <p className="flex items-center gap-1.5 px-2 pt-1 pb-1 text-[11.5px] font-medium text-muted-foreground">
            <LinearIcon className="size-3" />
            {t("linearReleases.title")}
          </p>
          {linear.isError && (
            <p className="px-2 text-[12px] text-muted-foreground">{toGitError(linear.error).message}</p>
          )}
          {linear.data && linearGroups.length === 0 && (
            <p className="px-2 text-[12px] text-muted-foreground">{t("linearReleases.none")}</p>
          )}
          {linearGroups.map((group) => (
            <div key={group.id}>
              {linearGroups.length > 1 && (
                <p className="truncate px-2 pt-2 pb-0.5 text-[11px] text-muted-foreground/70">{group.name}</p>
              )}
              <ul className="space-y-px">
                {group.releases.map((r) =>
                  row(
                    { kind: "linear", id: r.id },
                    <>
                      <StageDot stage={r.stage} />
                      <span className="min-w-0 flex-1 truncate">{r.name}</span>
                      {r.version && r.version !== r.name && (
                        <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">{r.version}</span>
                      )}
                    </>,
                  ),
                )}
              </ul>
            </div>
          ))}
        </>
      )}
      <p className={cn("px-2 pb-1 text-[11.5px] font-medium text-muted-foreground", account ? "pt-4" : "pt-1")}>
        {t("releases.title")}
      </p>
      {releases.isError ? (
        <p className="px-2 text-[12px] text-muted-foreground">{toGitError(releases.error).message}</p>
      ) : (
        <ul className="space-y-px">
          {shownReleases.map((r) =>
            row(
              { kind: "release", id: r.id },
              <>
                <Package aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{r.name || r.tag_name}</span>
                <ReleaseBadges release={r} />
              </>,
            ),
          )}
        </ul>
      )}
      <p className="px-2 pt-4 pb-1 text-[11.5px] font-medium text-muted-foreground">{t("tags.title")}</p>
      <ul className="space-y-px">
        {shownTags.map((tag) =>
          row(
            { kind: "tag", name: tag.name },
            <>
              <TagIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{tag.name}</span>
              <span className="shrink-0 text-[11.5px] text-muted-foreground">
                {formatAge(tag.date, undefined, t.locale)}
              </span>
            </>,
          ),
        )}
      </ul>
      <TagDialog repoPath={repoPath} target={null} open={tagOpen} onOpenChange={setTagOpen} />
    </div>
  );
}

/** Runs a Git or GitHub action, reports it and refreshes tags and releases. */
function useAction(repoPath: string) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  return useMutation({
    mutationFn: async ({ run }: { run: () => Promise<unknown>; done: string }) => run(),
    onSuccess: (_, { done }) => notify({ tone: "success", title: done }),
    onError: (error) => notify({ tone: "error", title: t("releases.failed"), detail: toGitError(error).message }),
    onSettled: () => {
      void invalidateRepo(client, repoPath);
      void client.invalidateQueries({ queryKey: releasesKey(repoPath) });
    },
  });
}

function Header({ icon, title }: { icon: ReactNode; title: string }) {
  const t = useT();
  return (
    <PanelHeader className="gap-1.5 text-[13px]">
      {icon}
      <span className="text-muted-foreground">{t("view.releases")}</span>
      <span className="text-muted-foreground/60">/</span>
      <span className="min-w-0 truncate font-medium">{title}</span>
    </PanelHeader>
  );
}

function TagDetail({ repoPath, tag }: { repoPath: string; tag: Tag }) {
  const t = useT();
  const select = useReleasesStore((s) => s.select);
  const action = useAction(repoPath);
  const deleteLocal = async () => {
    if (!(await ask(t("tags.deleteConfirm", { name: tag.name }), { kind: "warning", okLabel: t("tags.delete") })))
      return;
    action.mutate({ run: () => gitBackend.deleteTag(repoPath, tag.name), done: t("tags.deleted", { name: tag.name }) });
    select(null);
  };
  const deleteRemote = async () => {
    const sure = await ask(t("tags.deleteRemoteConfirm", { name: tag.name }), {
      kind: "warning",
      okLabel: t("tags.deleteRemote"),
    });
    if (sure)
      action.mutate({
        run: () => gitBackend.deleteRemoteTag(repoPath, tag.name),
        done: t("tags.deletedRemote", { name: tag.name }),
      });
  };
  return (
    <section className="flex h-full flex-col">
      <Header icon={<TagIcon aria-hidden className="size-3.5 text-muted-foreground" />} title={tag.name} />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-8 pb-12">
        <div className="mx-auto max-w-[760px]">
          <h1 className="font-mono text-[22px]">{tag.name}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {tag.message ? t("tags.annotatedOn") : t("tags.lightweightOn")}{" "}
            <span className="font-mono">{tag.target.slice(0, 10)}</span> · {formatAge(tag.date, undefined, t.locale)}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => select({ kind: "new", tag: tag.name })}>
              <Package aria-hidden />
              {t("releases.fromTag")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={action.isPending}
              onClick={() =>
                action.mutate({
                  run: () => gitBackend.pushTag(repoPath, tag.name),
                  done: t("tags.pushed", { name: tag.name }),
                })
              }
            >
              <Upload aria-hidden />
              {t("tags.push")}
            </Button>
            <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => void deleteLocal()}>
              <Trash2 aria-hidden />
              {t("tags.delete")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={action.isPending}
              onClick={() => void deleteRemote()}
              className="text-removed-foreground"
            >
              <Trash2 aria-hidden />
              {t("tags.deleteRemote")}
            </Button>
          </div>
          {tag.message && (
            <pre className="surface mt-6 px-4 py-3 font-sans text-[13px] whitespace-pre-wrap">{tag.message}</pre>
          )}
        </div>
      </div>
    </section>
  );
}

function ReleaseDetail({ repoPath, release }: { repoPath: string; release: Release }) {
  const t = useT();
  const select = useReleasesStore((s) => s.select);
  const action = useAction(repoPath);
  const [editing, setEditing] = useState(false);
  const title = release.name || release.tag_name;
  if (editing)
    return (
      <section className="flex h-full flex-col">
        <Header icon={<Pencil aria-hidden className="size-3.5 text-muted-foreground" />} title={title} />
        <ReleaseForm
          repoPath={repoPath}
          release={release}
          initialTag={release.tag_name}
          onDone={() => setEditing(false)}
        />
      </section>
    );
  const remove = async () => {
    if (!(await ask(t("releases.deleteConfirm", { name: title }), { kind: "warning", okLabel: t("releases.delete") })))
      return;
    action.mutate({ run: () => gitBackend.deleteRelease(repoPath, release.id), done: t("releases.deleted") });
    select(null);
  };
  return (
    <section className="flex h-full flex-col">
      <Header icon={<Package aria-hidden className="size-3.5 text-muted-foreground" />} title={title} />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-8 pb-12">
        <div className="mx-auto max-w-[760px]">
          <div className="flex items-center gap-2">
            <h1 className="min-w-0 truncate font-display text-[26px]">{title}</h1>
            <ReleaseBadges release={release} />
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            <span className="font-mono">{release.tag_name}</span>
            {release.author && ` · ${release.author.login}`} ·{" "}
            {formatAge(release.published_at ?? release.created_at, undefined, t.locale)}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil aria-hidden />
              {t("releases.edit")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void gitBackend.openGithubUrl(release.html_url)}>
              <ExternalLink aria-hidden />
              {t("releases.openOnGithub")}
            </Button>
            <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => void remove()}>
              <Trash2 aria-hidden />
              {t("releases.delete")}
            </Button>
          </div>
          <div className="mt-6 text-[13.5px]">
            {release.body ? (
              <LazyMarkdown text={release.body} />
            ) : (
              <p className="text-muted-foreground">{t("releases.noNotes")}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Releases page: a release or tag in detail, or the new-release form. */
export function ReleasesPage({ repoPath }: { repoPath: string }) {
  const t = useT();
  const { selection, select } = useReleasesStore();
  const releases = useReleases(repoPath);
  const tags = useTags(repoPath);
  const account = useActiveAccount();
  const linear = useLinearReleases(account?.id);
  if (selection?.kind === "new")
    return (
      <section className="flex h-full flex-col">
        <Header icon={<Plus aria-hidden className="size-3.5 text-muted-foreground" />} title={t("releases.new")} />
        <ReleaseForm
          key={selection.tag ?? ""}
          repoPath={repoPath}
          initialTag={selection.tag}
          onDone={(created) => select(created ? { kind: "release", id: created.id } : null)}
        />
      </section>
    );
  if (selection?.kind === "tag") {
    const tag = tags.data?.find((x) => x.name === selection.name);
    if (tag) return <TagDetail key={tag.name} repoPath={repoPath} tag={tag} />;
  }
  if (selection?.kind === "linear" && account) {
    const release = linear.data?.releases.find((r) => r.id === selection.id);
    if (release)
      return (
        <LinearReleaseDetail
          key={release.id}
          orgId={account.id}
          repoPath={repoPath}
          release={release}
          stages={linear.data?.pipelines.find((p) => p.id === release.pipeline.id)?.stages ?? []}
          header={<Header icon={<LinearIcon className="size-3.5 text-muted-foreground" />} title={release.name} />}
        />
      );
    if (!linear.data && !linear.isError) return <PanelLoading title={t("common.loading")} />;
  }
  if (selection?.kind === "release") {
    if (releases.isError)
      return (
        <DataUnavailable
          title={t("releases.loadError")}
          error={releases.error}
          onRetry={() => void releases.refetch()}
        />
      );
    if (!releases.data) return <PanelLoading title={t("common.loading")} />;
    const release = releases.data.find((r) => r.id === selection.id);
    if (release) return <ReleaseDetail key={release.id} repoPath={repoPath} release={release} />;
  }
  return (
    <EmptyState
      icon={<Package />}
      title={t("releases.pick")}
      hint={t("releases.pickHint")}
      action={{ label: t("releases.new"), onClick: () => select({ kind: "new", tag: null }) }}
    />
  );
}
