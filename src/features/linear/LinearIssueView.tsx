import { lazy, Suspense, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Copy, Play, ExternalLink, GitBranchPlus, Link2, Sparkles } from "lucide-react";
import type { Components } from "react-markdown";
import { GithubIcon } from "@/components/github-icon";
import { AuthorAvatar } from "@/components/author-avatar";
import { BrailleLoader } from "@/components/braille-loader";
import { PanelHeader, PanelLoading } from "@/components/layout/panel";
import { DataUnavailable } from "@/components/states";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { formatAge } from "@/lib/format-date";
import { gitBackend } from "@/lib/tauri-git";
import { useLinearStore } from "@/stores/linear-store";
import { useNoticesStore } from "@/stores/notices-store";
import { useUiStore } from "@/stores/ui-store";
import { useAgentsStore } from "@/stores/agents-store";
import { useInstalledAgents } from "@/features/agents/use-agents";
import { startIssueAgent } from "./issue-agent";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AgentKind, LinearIssueDetail } from "@/types/git";
import { LinearIcon } from "./LinearIcon";
import { IssueProperties, Meta } from "./IssueProperties";
import { LinearImage } from "./LinearImage";
import { editableDescription } from "./editable-description";
import { useLinearAccounts, useOpenIssue } from "./linear-queries";
import { useAutosave, useUpdateIssue } from "./use-update-issue";
import { LinearBoard } from "./LinearBoard";
import { LinearProjects } from "./LinearProjects";
import { PullRequestLinkStatus } from "./PullRequestLinkStatus";

const Markdown = lazy(() => import("@/features/agents/Markdown"));
const DescriptionEditor = lazy(() => import("./IssueDescriptionEditor"));

/** The title, edited in place: saved on Enter, on blur and after a pause in typing. */
function TitleInput({ title, onSave }: { title: string; onSave: (title: string) => void }) {
  const t = useT();
  const autosave = useAutosave(title, onSave);
  const fit = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  return (
    <textarea
      ref={fit}
      rows={1}
      defaultValue={title}
      aria-label={t("linear.title")}
      onChange={(e) => {
        fit(e.currentTarget);
        const value = e.currentTarget.value.replace(/\s+/g, " ").trim();
        if (value) autosave.schedule(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.value.trim()) e.currentTarget.value = title;
        autosave.flush();
      }}
      className="font-display block w-full resize-none overflow-hidden bg-transparent text-[26px] outline-none"
    />
  );
}

function SideSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-white/[0.06] px-5 py-4 last:border-b-0">
      <h2 className="mb-2 text-[12px] font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** Creates the issue's branch (Linear's own name for it) and switches to it. */
function useCreateBranch(repoPath: string) {
  const t = useT();
  const notify = useNoticesStore((s) => s.notify);
  return useMutation({
    mutationFn: (name: string) => gitBackend.createBranch(repoPath, name, true),
    onSuccess: (_, name) => notify({ tone: "success", title: t("branches.created", { name }) }),
    onError: (error) => {
      const { message, detail } = toGitError(error);
      notify({ tone: "error", title: t("branches.createFailed"), detail: detail ?? message });
    },
  });
}

/** Starts Claude Code or Codex on the issue, in its own worktree on Linear's branch, and shows the run. */
function StartAgent({ repoPath, orgId, issue }: { repoPath: string; orgId?: string; issue: LinearIssueDetail }) {
  const t = useT();
  const installed = useInstalledAgents().data;
  const preferred = useAgentsStore((s) => s.preferredAgent);
  const [starting, setStarting] = useState(false);
  const start = async (agent: AgentKind) => {
    setStarting(true);
    await startIssueAgent(repoPath, agent, issue, orgId);
    setStarting(false);
  };
  const available = (kind: AgentKind) => installed?.find((a) => a.kind === kind)?.installed ?? false;
  const main: AgentKind = available(preferred) ? preferred : available("claude") ? "claude" : "codex";
  const name = (kind: AgentKind) => (kind === "claude" ? "Claude Code" : "Codex");
  return (
    <div className="flex items-center">
      <Button
        size="sm"
        disabled={starting || !available(main)}
        onClick={() => void start(main)}
        className="h-7 gap-1.5 rounded-l-full rounded-r-none pr-2.5 text-[12.5px]"
      >
        {starting ? <BrailleLoader /> : <Play aria-hidden className="size-3 fill-current" />}
        {t("linear.startWith", { agent: name(main) })}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            aria-label={t("agents.agent")}
            disabled={starting}
            className="h-7 rounded-l-none rounded-r-full border-l border-black/20 px-1.5"
          >
            <ChevronDown aria-hidden className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60 rounded-xl p-1">
          {(["claude", "codex"] as const).map((kind) => (
            <DropdownMenuItem
              key={kind}
              disabled={!available(kind)}
              onSelect={() => void start(kind)}
              className="px-2 py-1.5 text-[13px]"
            >
              {t("linear.startWith", { agent: name(kind) })}
            </DropdownMenuItem>
          ))}
          <p className="px-2 pt-1 pb-1.5 text-[11.5px] text-muted-foreground">{t("linear.startHint")}</p>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Main panel of the Linear view: one issue, with what's needed to start working on it. */
export function LinearIssueView({ repoPath }: { repoPath: string }) {
  const t = useT();
  const id = useLinearStore((s) => s.issue);
  const page = useLinearStore((s) => s.page);
  const project = useLinearStore((s) => s.project);
  const issue = useOpenIssue();
  const org = useLinearAccounts().data?.find((a) => a.id === issue.orgId);
  const createBranch = useCreateBranch(repoPath);
  const notify = useNoticesStore((s) => s.notify);
  const update = useUpdateIssue(issue.orgId, { id: id ?? "", identifier: issue.data?.identifier ?? "" });

  if (!id) return page === "projects" && !project ? <LinearProjects /> : <LinearBoard />;
  if (issue.isError)
    return <DataUnavailable title={t("linear.issueError")} error={issue.error} onRetry={() => void issue.refetch()} />;
  if (!issue.data) return <PanelLoading title={t("common.loading")} variant="grid-orbit" />;
  const data = issue.data;
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    notify({ tone: "success", title: t("file.copied") });
  };

  const markdown: Components = {
    img: ({ src, alt }) => <LinearImage orgId={issue.orgId} src={typeof src === "string" ? src : ""} alt={alt ?? ""} />,
  };
  const comments = [...data.comments.nodes].reverse();
  const description = data.description ?? "";
  const readOnly = description ? (
    <Suspense fallback={<p className="whitespace-pre-wrap">{description}</p>}>
      <Markdown text={description} components={markdown} />
    </Suspense>
  ) : (
    <p className="text-muted-foreground">{t("linear.addDescription")}</p>
  );

  return (
    <section aria-label={data.identifier} className="flex h-full flex-col">
      <PanelHeader className="gap-1.5 text-[13px]">
        <button
          type="button"
          onClick={() => useLinearStore.getState().setIssue(null)}
          className="-ml-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
        >
          <LinearIcon className="size-3.5" />
          {org?.name ?? "Linear"}
        </button>
        <ChevronRight aria-hidden className="size-3.5 text-muted-foreground/60" />
        <span className="text-muted-foreground">{data.team.name}</span>
        <ChevronRight aria-hidden className="size-3.5 text-muted-foreground/60" />
        <span className="font-medium">{data.identifier}</span>
        <div className="ml-auto flex items-center gap-1">
          <StartAgent repoPath={repoPath} orgId={issue.orgId} issue={data} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => useUiStore.getState().setAssistantOpen(true)}
            className="h-7 gap-1.5 rounded-full text-[12.5px] text-muted-foreground"
          >
            <Sparkles aria-hidden className="size-3.5 text-primary" />
            {t("linear.ask")}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("linear.copyLink")}
            onClick={() => void copy(data.url)}
            className="size-7 rounded-full text-muted-foreground"
          >
            <Link2 aria-hidden className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("linear.openInLinear")}
            onClick={() => void gitBackend.openGithubUrl(data.url)}
            className="size-7 rounded-full text-muted-foreground"
          >
            <ExternalLink aria-hidden className="size-3.5" />
          </Button>
        </div>
      </PanelHeader>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-10 pb-16">
          <article className="mx-auto max-w-[760px] pt-10">
            <TitleInput
              key={data.id}
              title={data.title}
              onSave={(title) => update.mutate({ patch: { title }, shown: { title } })}
            />
            <div className="mt-5 min-h-12 text-[14px]">
              {!editableDescription(description) ? (
                readOnly
              ) : (
                <Suspense fallback={readOnly}>
                  <DescriptionEditor
                    key={data.id}
                    orgId={issue.orgId}
                    initial={description}
                    onSave={(text) => update.mutate({ patch: { description: text }, shown: { description: text } })}
                  />
                </Suspense>
              )}
            </div>
            {data.attachments.nodes.length > 0 && (
              <section className="mt-10">
                <h2 className="mb-2 text-[13px] font-medium">{t("linear.links")}</h2>
                <ul className="divide-y divide-white/[0.05] rounded-lg border border-white/[0.07]">
                  {data.attachments.nodes.map((a) => (
                    <li key={a.url}>
                      <button
                        type="button"
                        onClick={() => void gitBackend.openGithubUrl(a.url).catch(() => copy(a.url))}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors hover:bg-white/[0.04]"
                      >
                        {a.url.includes("github.com") ? (
                          <GithubIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <Link2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{a.title}</span>
                        {a.url.includes("github.com") && <PullRequestLinkStatus repoPath={repoPath} url={a.url} />}
                        {a.subtitle && <span className="shrink-0 text-[12px] text-muted-foreground">{a.subtitle}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="mt-10">
              <h2 className="mb-4 text-[13px] font-medium">{t("linear.activity")}</h2>
              <ol className="relative space-y-5 before:absolute before:top-2 before:bottom-2 before:left-[9px] before:w-px before:bg-white/[0.07]">
                <li className="relative flex items-center gap-3 text-[12.5px] text-muted-foreground">
                  <span className="z-10 grid size-5 place-items-center rounded-full bg-background">
                    <span className="size-1.5 rounded-full bg-muted-foreground/60" />
                  </span>
                  <span>
                    <span className="text-foreground">{data.creator?.name ?? "Linear"}</span> {t("linear.createdIssue")}{" "}
                    · {formatAge(data.createdAt, undefined, t.locale)}
                  </span>
                </li>
                {comments.map((c, i) => {
                  const who = c.user ?? c.botActor;
                  return (
                    <li key={i} className="relative flex gap-3">
                      <AuthorAvatar
                        name={who?.name ?? "Linear"}
                        src={who?.avatarUrl ?? null}
                        className="z-10 size-5 shrink-0 ring-4 ring-background"
                      />
                      <div className="surface min-w-0 flex-1 rounded-lg px-3.5 py-2.5">
                        <p className="mb-1 text-[12.5px] text-muted-foreground">
                          <span className="font-medium text-foreground">{who?.name ?? "Linear"}</span> ·{" "}
                          {formatAge(c.createdAt, undefined, t.locale)}
                        </p>
                        <Suspense fallback={<p className="text-[13px] whitespace-pre-wrap">{c.body}</p>}>
                          <Markdown text={c.body} components={markdown} />
                        </Suspense>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          </article>
        </div>
        <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-white/[0.06] bg-white/[0.012] lg:block">
          <SideSection title={t("linear.properties")}>
            <IssueProperties orgId={issue.orgId} issue={data}>
              {data.cycle && <Meta label={t("linear.cycle")}>{`#${data.cycle.number}`}</Meta>}
              <Meta label={t("linear.updated")}>{formatAge(data.updatedAt, undefined, t.locale)}</Meta>
            </IssueProperties>
          </SideSection>
          <SideSection title={t("linear.branch")}>
            <button
              type="button"
              onClick={() => void copy(data.branchName)}
              title={t("linear.copyBranch")}
              className="group/branch flex w-full items-center gap-2 rounded-md border border-white/[0.07] px-2.5 py-1.5 text-left font-mono text-[11.5px] text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
            >
              <span className="min-w-0 flex-1 truncate">{data.branchName}</span>
              <Copy aria-hidden className="size-3.5 shrink-0 opacity-60 group-hover/branch:opacity-100" />
            </button>
            <Button
              size="sm"
              disabled={createBranch.isPending}
              onClick={() => createBranch.mutate(data.branchName)}
              className="mt-2 h-8 w-full gap-1.5 text-[13px]"
            >
              {createBranch.isPending ? <BrailleLoader /> : <GitBranchPlus aria-hidden className="size-3.5" />}
              {t("linear.createBranch")}
            </Button>
          </SideSection>
        </aside>
      </div>
    </section>
  );
}

export default LinearIssueView;
