import type { ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ExternalLink, Package, Tag as TagIcon } from "lucide-react";
import { RowSkeleton, SkeletonList } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LazyMarkdown } from "@/features/agents/LazyMarkdown";
import { PriorityIcon, StateDot } from "@/features/linear/LinearList";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { useLinearStore } from "@/stores/linear-store";
import { useNoticesStore } from "@/stores/notices-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { LinearRelease, LinearReleaseStage, LinearState } from "@/types/git";
import { matchLinearRelease } from "./linear-match";
import {
  linearReleasesKey,
  useLinearReleaseIssues,
  useLinearReleaseWriting,
  useReleases,
  useTags,
} from "./release-queries";
import { useReleasesStore } from "./releases-store";

/** Linear draws release stages with its issue glyphs: planned is a ring, started a pie, then check / cross. */
const GLYPH: Record<LinearReleaseStage["type"], LinearState["type"]> = {
  planned: "unstarted",
  started: "started",
  completed: "completed",
  canceled: "canceled",
};

export function StageDot({ stage }: { stage: LinearReleaseStage }) {
  return <StateDot state={{ type: GLYPH[stage.type], color: stage.color, name: stage.name }} />;
}

const STAGE_ORDER: LinearReleaseStage["type"][] = ["started", "planned", "completed", "canceled"];

/** Releases per pipeline; in each, ongoing ones first, then the latest. */
export function groupByPipeline(releases: readonly LinearRelease[]) {
  const sorted = [...releases].sort(
    (a, b) =>
      STAGE_ORDER.indexOf(a.stage.type) - STAGE_ORDER.indexOf(b.stage.type) ||
      a.stage.position - b.stage.position ||
      b.createdAt.localeCompare(a.createdAt),
  );
  const groups = new Map<string, { id: string; name: string; releases: LinearRelease[] }>();
  for (const r of sorted) {
    const group = groups.get(r.pipeline.id) ?? { ...r.pipeline, releases: [] };
    group.releases.push(r);
    groups.set(r.pipeline.id, group);
  }
  return [...groups.values()];
}

function StageMenu({
  orgId,
  release,
  stages,
}: {
  orgId: string;
  release: LinearRelease;
  stages: LinearReleaseStage[];
}) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const move = useMutation({
    mutationFn: (stageId: string) => gitBackend.linearSetReleaseStage(orgId, release.id, stageId),
    onError: (error) =>
      notify({ tone: "error", title: t("linearReleases.moveFailed"), detail: toGitError(error).message }),
    onSettled: () => void client.invalidateQueries({ queryKey: linearReleasesKey(orgId) }),
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={move.isPending || stages.length === 0}>
          <StageDot stage={release.stage} />
          {release.stage.name}
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {[...stages]
          .sort((a, b) => a.position - b.position)
          .map((stage) => (
            <DropdownMenuItem key={stage.id} onSelect={() => move.mutate(stage.id)} className="gap-2 text-[13px]">
              <StageDot stage={stage} />
              <span className="min-w-0 flex-1 truncate">{stage.name}</span>
              {stage.id === release.stage.id && <Check aria-hidden className="size-3.5 text-primary" />}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The GitHub release or tag of the same version, one click away. */
function GithubMatchButton({ repoPath, release }: { repoPath: string; release: LinearRelease }) {
  const t = useT();
  const select = useReleasesStore((s) => s.select);
  const match = matchLinearRelease(release, useReleases(repoPath).data ?? [], useTags(repoPath).data ?? []);
  if (!match) return null;
  return (
    <Button size="sm" variant="outline" onClick={() => select(match)}>
      {match.kind === "release" ? <Package aria-hidden /> : <TagIcon aria-hidden />}
      {match.kind === "release" ? t("linearReleases.githubRelease") : t("linearReleases.tag", { name: match.name })}
    </Button>
  );
}

/** The release notes and documents written for the release, as Linear shows them under it. */
function ReleaseWriting({ orgId, releaseId }: { orgId: string; releaseId: string }) {
  const writing = useLinearReleaseWriting(orgId, releaseId).data ?? [];
  return writing.map((w, i) => (
    <section key={`${w.url}:${i}`} className="mt-6 text-[13.5px]">
      {w.title && <h3 className="mb-2 text-[11.5px] font-medium text-muted-foreground">{w.title}</h3>}
      <LazyMarkdown text={w.content} />
    </section>
  ));
}

function ReleaseIssues({ orgId, releaseId }: { orgId: string; releaseId: string }) {
  const t = useT();
  const issues = useLinearReleaseIssues(orgId, releaseId);
  if (issues.isError) return <p className="text-[13px] text-muted-foreground">{toGitError(issues.error).message}</p>;
  if (!issues.data)
    return <SkeletonList rows={4} row={(i) => <RowSkeleton i={i} height={32} lines={1} trail={false} />} />;
  if (issues.data.length === 0)
    return <p className="text-[13px] text-muted-foreground">{t("linearReleases.noIssues")}</p>;
  return (
    <ul className="space-y-px">
      {issues.data.map((issue) => (
        <li key={issue.id}>
          <button
            type="button"
            onClick={() => {
              useLinearStore.getState().setIssue(issue.id, orgId);
              useWorkspaceStore.getState().setView("linear");
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-white/[0.06]"
          >
            <PriorityIcon priority={issue.priority} />
            <span className="w-16 shrink-0 truncate text-[12px] text-muted-foreground tabular-nums">
              {issue.identifier}
            </span>
            <StateDot state={issue.state} />
            <span className="min-w-0 flex-1 truncate">{issue.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const day = (date: string | null, locale: string) =>
  date && new Date(date).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });

export function LinearReleaseDetail({
  orgId,
  repoPath,
  release,
  stages,
  header,
}: {
  orgId: string;
  repoPath: string;
  release: LinearRelease;
  stages: LinearReleaseStage[];
  header: ReactNode;
}) {
  const t = useT();
  const shipped = day(release.completedAt, t.locale);
  const target = day(release.targetDate, t.locale);
  return (
    <section className="flex h-full flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-8 pb-12">
        <div className="mx-auto max-w-[760px]">
          <h1 className="min-w-0 truncate font-display text-[26px]">{release.name}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {release.version && <span className="font-mono">{release.version} · </span>}
            {release.pipeline.name}
            {shipped
              ? ` · ${t("linearReleases.shipped", { date: shipped })}`
              : target && ` · ${t("linearReleases.target", { date: target })}`}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <StageMenu orgId={orgId} release={release} stages={stages} />
            <Button size="sm" variant="outline" onClick={() => void gitBackend.openGithubUrl(release.url)}>
              <ExternalLink aria-hidden />
              {t("linearReleases.openInLinear")}
            </Button>
            <GithubMatchButton repoPath={repoPath} release={release} />
          </div>
          {release.description && (
            <div className="mt-6 text-[13.5px]">
              <LazyMarkdown text={release.description} />
            </div>
          )}
          <ReleaseWriting orgId={orgId} releaseId={release.id} />
          <p className="mt-6 pb-1 text-[11.5px] font-medium text-muted-foreground">
            {t("linearReleases.issues", { count: release.issueCount })}
          </p>
          <ReleaseIssues orgId={orgId} releaseId={release.id} />
        </div>
      </div>
    </section>
  );
}
