import { Fragment, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "react-resizable-panels";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import {
  ArrowUp,
  CircleCheck,
  CircleDot,
  CircleX,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  GitPullRequestDraft,
  GitPullRequestClosed,
  Check,
  ListTree,
  Ellipsis,
  GitBranch,
  Hash,
  Link2,
  ChevronDown,
  ChevronsUpDown,
  CornerDownRight,
  Plus,
} from "lucide-react";
import { MiddleTruncate } from "@/components/middle-truncate";
import { checkOutcome, ChecksMenu } from "./ChecksMenu";
import { PullRequestCi } from "./PullRequestCi";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GithubIcon } from "@/components/github-icon";
import { LinearIcon } from "@/features/linear/LinearIcon";
import { getT } from "@/i18n";
import { AuthorAvatar } from "@/components/author-avatar";
import { BrailleLoader } from "@/components/braille-loader";
import { FileIcon } from "@/components/file-icon";
import { PanelHeader, PanelLoading } from "@/components/layout/panel";
import { DataUnavailable } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { formatAge } from "@/lib/format-date";
import { repoKey, usePullRequests } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useLinearStore } from "@/stores/linear-store";
import { useNoticesStore } from "@/stores/notices-store";
import { useWorkspaceStore, type ActivePullRequest } from "@/stores/workspace-store";
import type { MergeMethod, PullRequestDetails } from "@/types/git";
import { ChangedFilesPanel } from "@/features/changed-files/ChangedFilesPanel";
import { DiffPanel } from "@/features/diff/DiffPanel";
import { CommitList } from "@/features/history/CommitList";
import { StateDot } from "@/features/linear/LinearList";
import { useWorkspaceIssues } from "@/features/linear/linear-queries";
import { stackOf } from "./stacks";
import { useOpenPullRequest } from "./PullRequestList";
import { Columns } from "@/components/layout/Columns";

const Markdown = lazy(() => import("@/features/agents/Markdown"));

type Tab = "overview" | "diff" | "ci";

const avatarOf = (login: string) => `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=64`;

function usePullRequestDetails(repoPath: string, number: number) {
  return useQuery({
    queryKey: ["pull-request", repoPath, number],
    queryFn: () => gitBackend.getPullRequestDetails(repoPath, number),
    staleTime: 30_000,
    // While checks run, follow them closely; otherwise a slow refresh is enough.
    refetchInterval: (q) =>
      q.state.data?.statusCheckRollup.some((c) => checkOutcome(c) === "pending") ? 10_000 : 60_000,
  });
}

function Side({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="px-6 py-3.5">
      <h2 className="mb-2 flex h-5 items-center text-[12.5px] text-muted-foreground">
        {title}
        {action && <span className="ml-auto">{action}</span>}
      </h2>
      <div className="space-y-1.5 text-[13px]">{children}</div>
    </section>
  );
}

function StatusLine({ pr }: { pr: PullRequestDetails }) {
  const t = useT();
  if (pr.state === "MERGED")
    return (
      <p className="flex items-center gap-2">
        <GitMerge aria-hidden className="size-4 text-merged" />
        {t("pr.merged")}
      </p>
    );
  if (pr.state === "CLOSED")
    return (
      <p className="flex items-center gap-2">
        <CircleX aria-hidden className="size-4 text-removed-foreground" />
        {t("pr.closed")}
      </p>
    );
  return (
    <p className="flex items-center gap-2">
      {pr.isDraft ? (
        <GitPullRequestDraft aria-hidden className="size-4 text-muted-foreground" />
      ) : (
        <GitPullRequest aria-hidden className="size-4 text-added-foreground" />
      )}
      {pr.isDraft ? t("pr.draft") : t("pr.open")}
    </p>
  );
}

/** The Linear issue this branch implements: Linear names branches after the issue identifier. */
type Target = "draft" | "open" | "closed";

/** Linear's status menu: Draft, Open, Closed through gh (ready, ready --undo, close, reopen). */
function StatusMenu({ repoPath, pr }: { repoPath: string; pr: PullRequestDetails }) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const current: Target = pr.state === "CLOSED" ? "closed" : pr.isDraft ? "draft" : "open";
  const change = useMutation({
    mutationFn: (target: Target) => gitBackend.setPullRequestState(repoPath, pr.number, target),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["pull-request", repoPath, pr.number] });
      void client.invalidateQueries({ queryKey: [...repoKey(repoPath), "pull-requests"] });
    },
    onError: (error) => notify({ tone: "error", title: t("pr.stateFailed"), detail: toGitError(error).message }),
  });
  if (pr.state === "MERGED") return <StatusLine pr={pr} />;
  const options: { target: Target; Icon: typeof GitPullRequest; tone: string; label: string }[] = [
    { target: "draft", Icon: GitPullRequestDraft, tone: "text-muted-foreground", label: t("pr.draft") },
    { target: "open", Icon: GitPullRequest, tone: "text-added-foreground", label: t("pr.open") },
    { target: "closed", Icon: GitPullRequestClosed, tone: "text-removed-foreground", label: t("pr.closed") },
  ];
  const active = options.find((o) => o.target === current) ?? options[1];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="-mx-1 flex items-center gap-2 rounded-full px-2.5 py-1 text-[13px] outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-white/[0.08]">
        {change.isPending ? <BrailleLoader /> : <active.Icon aria-hidden className={cn("size-4", active.tone)} />}
        {active.label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52 rounded-xl p-1">
        {options.map(({ target, Icon, tone, label }) => (
          <Fragment key={target}>
            {target === "closed" && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onSelect={() => target !== current && change.mutate(target)}
              className="gap-2.5 px-2 py-1.5 text-[13px]"
            >
              <Icon aria-hidden className={cn("size-4", tone)} />
              <span className="flex-1">{label}</span>
              {target === current && <Check aria-hidden className="size-3.5" />}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The Linear issue a branch implements: Linear names branches after the issue identifier. */
function useLinkedIssue(branch: string) {
  const issues = useWorkspaceIssues().data ?? [];
  const id = branch.match(/([a-z][a-z0-9]*-\d+)/i)?.[1]?.toUpperCase();
  return { id, issue: issues.find((i) => i.branchName === branch || i.identifier === id) };
}

/** Copies, the way Linear's PR menu does; HTML too for "title as link", so it pastes as a real link. */
async function copy(text: string, html?: string) {
  if (html && typeof ClipboardItem !== "undefined") {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      }),
    ]);
  } else {
    await navigator.clipboard.writeText(text);
  }
  useNoticesStore.getState().notify({ tone: "success", title: getT()("file.copied") });
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** ⌘⇧. copies the branch name, ⌘⇧, the GitHub URL, while a pull request is open. */
function useCopyShortcuts(pr: ActivePullRequest, branch: string | undefined) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || !e.shiftKey) return;
      if (e.key === "." && branch) void copy(branch);
      else if (e.key === ",") void copy(pr.url);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pr.url, branch]);
}

function PullRequestMenu({ pr, data }: { pr: ActivePullRequest; data?: PullRequestDetails }) {
  const t = useT();
  const repoName = useWorkspaceStore((s) => s.repo?.name ?? "");
  const branch = data?.headRefName;
  const { id: issueId, issue } = useLinkedIssue(branch ?? "");
  useCopyShortcuts(pr, branch);
  const item = "gap-2.5 px-2 py-1.5 text-[13px]";
  const hint = "ml-auto pl-4 text-[11.5px] text-muted-foreground";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("pr.menu")}
        className="grid size-7 place-items-center rounded-full text-muted-foreground outline-none hover:bg-white/[0.07] hover:text-foreground data-[state=open]:bg-white/[0.08]"
      >
        <Ellipsis aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 rounded-xl p-1">
        <DropdownMenuItem className={item} onSelect={() => void gitBackend.openGithubUrl(pr.url)}>
          <GithubIcon aria-hidden className="size-4" />
          {t("pr.openGithub")}
        </DropdownMenuItem>
        <DropdownMenuItem className={item} onSelect={() => void copy(pr.url)}>
          <GithubIcon aria-hidden className="size-4" />
          {t("pr.copyUrl")}
          <span className={hint}>⌘⇧,</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className={item} disabled={!branch} onSelect={() => branch && void copy(branch)}>
          <GitBranch aria-hidden className="size-4" />
          {t("pr.copyBranch")}
          <span className={hint}>⌘⇧.</span>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={item}>
            <Hash aria-hidden className="size-4" />
            {t("pr.copyNumber")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56 rounded-xl p-1">
            <DropdownMenuItem className={item} onSelect={() => void copy(`#${pr.number}`)}>
              #{pr.number}
            </DropdownMenuItem>
            <DropdownMenuItem className={item} onSelect={() => void copy(`${repoName}#${pr.number}`)}>
              {repoName}#{pr.number}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          className={item}
          onSelect={() =>
            void copy(`[${pr.title}](${pr.url})`, `<a href="${escapeHtml(pr.url)}">${escapeHtml(pr.title)}</a>`)
          }
        >
          <Link2 aria-hidden className="size-4" />
          {t("pr.copyTitleLink")}
        </DropdownMenuItem>
        {(issue || issueId) && <DropdownMenuSeparator />}
        {(issue || issueId) && (
          <DropdownMenuItem className={item} onSelect={() => void copy(issue?.identifier ?? issueId ?? "")}>
            <Hash aria-hidden className="size-4" />
            {t("pr.copyIssueId")}
          </DropdownMenuItem>
        )}
        {issue && (
          <DropdownMenuItem className={item} onSelect={() => void copy(issue.url)}>
            <LinearIcon aria-hidden className="size-4" />
            {t("pr.copyIssueUrl")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Resolves({ branch }: { branch: string }) {
  const t = useT();
  const { id, issue } = useLinkedIssue(branch);
  if (!issue && !id) return <p className="text-muted-foreground">{t("common.none")}</p>;
  if (!issue) return <p className="font-mono text-[12px] text-muted-foreground">{id}</p>;
  return (
    <button
      type="button"
      onClick={() => {
        useLinearStore.getState().setIssue(issue.id, issue.orgId);
        useWorkspaceStore.getState().setView("linear");
      }}
      className="-mx-1.5 flex w-[calc(100%+12px)] items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-white/[0.05]"
    >
      <StateDot state={issue.state} />
      <span className="min-w-0 flex-1 truncate">{issue.title}</span>
    </button>
  );
}

function AddReviewer({ repoPath, number }: { repoPath: string; number: number }) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const [open, setOpen] = useState(false);
  const [login, setLogin] = useState("");
  const add = useMutation({
    mutationFn: () => gitBackend.addReviewer(repoPath, number, login),
    onSuccess: () => {
      setOpen(false);
      setLogin("");
      void client.invalidateQueries({ queryKey: ["pull-request", repoPath, number] });
    },
    onError: (error) => notify({ tone: "error", title: t("pr.addReviewerFailed"), detail: toGitError(error).message }),
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="-mx-1 flex items-center gap-2 rounded-md px-1 py-0.5 text-muted-foreground hover:text-foreground">
        <Plus aria-hidden className="size-3.5" />
        {t("pr.addReviewers")}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 rounded-xl p-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (login.trim()) add.mutate();
          }}
        >
          <input
            autoFocus
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder={t("pr.reviewerPlaceholder")}
            aria-label={t("pr.addReviewers")}
            className="h-8 w-full rounded-md border border-white/10 bg-transparent px-2.5 text-[13px] outline-none focus:border-primary/50"
          />
        </form>
      </PopoverContent>
    </Popover>
  );
}

function Reviewers({ pr }: { pr: PullRequestDetails }) {
  const t = useT();
  const latest = new Map<string, string>();
  for (const review of pr.reviews) if (review.state !== "COMMENTED") latest.set(review.author.login, review.state);
  const requested = pr.reviewRequests.map((r) => r.login ?? r.slug ?? r.name ?? "").filter(Boolean);
  return (
    <>
      {[...latest].map(([login, state]) => (
        <p key={login} className="flex items-center gap-2">
          <AuthorAvatar name={login} src={avatarOf(login)} className="size-5" />
          <span className="min-w-0 flex-1 truncate">{login}</span>
          {state === "APPROVED" ? (
            <CircleCheck aria-label={t("github.approved")} className="size-3.5 text-added-foreground" />
          ) : (
            <CircleX aria-label={t("github.changesRequested")} className="size-3.5 text-removed-foreground" />
          )}
        </p>
      ))}
      {requested
        .filter((login) => !latest.has(login))
        .map((login) => (
          <p key={login} className="flex items-center gap-2 text-muted-foreground">
            <AuthorAvatar name={login} src={avatarOf(login)} className="size-5" />
            <span className="min-w-0 flex-1 truncate">{login}</span>
            <CircleDot aria-label={t("pr.awaiting")} className="size-3.5" />
          </p>
        ))}
    </>
  );
}

function BranchState({ pr }: { pr: PullRequestDetails }) {
  const t = useT();
  const text =
    pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY"
      ? t("pr.conflicts")
      : pr.mergeStateStatus === "BEHIND"
        ? t("pr.behind")
        : t("pr.upToDate");
  const bad = pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY";
  return (
    <p className="flex items-center gap-2">
      <GitPullRequest aria-hidden className={cn("size-4", bad ? "text-removed-foreground" : "text-added-foreground")} />
      {text}
    </p>
  );
}

function Stack({ repoPath, number }: { repoPath: string; number: number }) {
  const t = useT();
  const prs = usePullRequests(repoPath).data ?? [];
  const { open, loading } = useOpenPullRequest(repoPath);
  const stack = stackOf(prs, number);
  if (!stack) return null;
  return (
    <Side title={t("github.stack")}>
      <ol className="relative before:absolute before:top-3 before:bottom-3 before:left-[4.5px] before:w-px before:bg-white/10">
        {stack.map((pr) => {
          const current = pr.number === number;
          return (
            <li key={pr.number}>
              <button
                type="button"
                disabled={current}
                onClick={() => void open(pr)}
                className="relative flex w-full items-center gap-2 rounded-md py-1 text-left hover:enabled:text-foreground"
              >
                {loading === pr.number ? (
                  <BrailleLoader className="text-primary" />
                ) : (
                  <span
                    className={cn(
                      "size-2.5 shrink-0 rounded-full border-2 bg-background",
                      current ? "border-primary bg-primary" : "border-added-foreground",
                    )}
                  />
                )}
                <span className="shrink-0 text-muted-foreground">#{pr.number}</span>
                <span className={cn("min-w-0 flex-1 truncate", !current && "text-muted-foreground")}>{pr.title}</span>
                {current && <span className="text-[11.5px] text-muted-foreground">{t("github.current")}</span>}
              </button>
            </li>
          );
        })}
        <li className="relative flex items-center gap-2 py-1 font-mono text-[12px] text-muted-foreground">
          <span className="size-2.5 shrink-0 rounded-full border-2 border-white/25 bg-background" />
          {stack[stack.length - 1].baseRefName}
        </li>
      </ol>
    </Side>
  );
}

const isTest = (path: string) => /(\.|_)(test|spec)\.|__tests__\/|(^|\/)tests?\//.test(path);
const isBuild = (path: string) =>
  /(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.(toml|lock)|go\.(mod|sum)|pyproject\.toml|poetry\.lock|uv\.lock|requirements[^/]*\.txt|Gemfile(\.lock)?|pubspec\.(yaml|lock)|Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|turbo\.json|nx\.json)$|^\.github\//.test(
    path,
  );
const isDoc = (path: string) => /\.(md|mdx|rst|adoc|txt)$|(^|\/)docs?\//i.test(path);
const isGenerated = (path: string) =>
  /\.(gen|generated|g|pb)\.[^/]+$|(^|\/)(__generated__|generated)\/|\.snap$|(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|Gemfile\.lock|pubspec\.lock)$/.test(
    path,
  );
const isAsset = (path: string) =>
  /\.(png|jpe?g|gif|webp|avif|ico|icns|bmp|tiff?|svg|mp4|mov|webm|mp3|wav|ogg|woff2?|ttf|otf|eot|pdf|zip)$/i.test(path);

const KINDS = ["implementation", "tests", "documentation", "generated", "build", "assets"] as const;
type Kind = (typeof KINDS)[number];
const kindOf = (path: string): Kind =>
  isAsset(path)
    ? "assets"
    : isGenerated(path)
      ? "generated"
      : isTest(path)
        ? "tests"
        : isBuild(path)
          ? "build"
          : isDoc(path)
            ? "documentation"
            : "implementation";
const KIND_LABEL = {
  implementation: "pr.implementation",
  tests: "pr.tests",
  documentation: "pr.documentation",
  generated: "pr.generated",
  build: "pr.build",
  assets: "pr.assets",
} as const;
type Files = PullRequestDetails["files"];
const sum = (files: Files) => ({
  add: files.reduce((n, f) => n + f.additions, 0),
  del: files.reduce((n, f) => n + f.deletions, 0),
});
const count = (n: number) => n.toLocaleString();

/** `+12 −3`; `compact` drops a zero removal, like Linear's header pill. */
function Lines({ add, del, compact = false }: { add: number; del: number; compact?: boolean }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className="text-added-foreground">+{count(add)}</span>
      {!(compact && del === 0) && <span className="ml-1.5 text-removed-foreground">−{count(del)}</span>}
    </span>
  );
}

/** Linear-like line count: the implementation's by default, every kind on hover, the total on click. */
function DiffStat({ pr }: { pr: PullRequestDetails }) {
  const t = useT();
  const [total, setTotal] = useState(false);
  const kinds = KINDS.map((kind) => ({ kind, files: pr.files.filter((f) => kindOf(f.path) === kind) }))
    .filter((k) => k.files.length > 0)
    .map((k) => ({ kind: k.kind, files: k.files.length, ...sum(k.files) }));
  const implementation = kinds.find((k) => k.kind === "implementation") ?? { add: 0, del: 0 };
  // `gh` may list only part of a huge PR's files: the total comes from GitHub's own count.
  const all = { add: pr.additions, del: pr.deletions };
  const split = kinds.length > 1;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => split && setTotal((v) => !v)}
          className="shrink-0 rounded-full px-2 py-0.5 text-[12.5px] transition-colors hover:bg-white/[0.07] data-[state=delayed-open]:bg-white/[0.07] data-[state=instant-open]:bg-white/[0.07]"
        >
          <Lines {...(total || !split ? all : implementation)} compact />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        sideOffset={6}
        arrow={false}
        className="block min-w-48 rounded-lg border border-white/10 bg-popover px-3 py-2.5 text-[12.5px] text-popover-foreground shadow-xl"
      >
        <div className="space-y-1.5">
          {kinds.map((k) => (
            <div key={k.kind} className="flex items-center gap-6">
              <span className="flex-1">{t(KIND_LABEL[k.kind])}</span>
              {k.kind === "assets" ? (
                <span className="text-muted-foreground">{t.plural("pr.fileCount", k.files)}</span>
              ) : (
                <Lines add={k.add} del={k.del} />
              )}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-6 border-t border-white/[0.08] pt-2">
          <span className="flex-1">{t("pr.total")}</span>
          <Lines {...all} />
        </div>
        {split && (
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            {t(total ? "pr.showImplementation" : "pr.showTotal")}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function FileGroup({
  title,
  files,
  onOpen,
  initiallyOpen,
}: {
  title: string;
  files: Files;
  onOpen: (path: string | null) => void;
  initiallyOpen: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(initiallyOpen);
  const [all, setAll] = useState(false);
  if (files.length === 0) return null;
  const { add, del } = sum(files);
  const shown = all ? files : files.slice(0, 6);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="-mx-1 flex w-[calc(100%+8px)] items-center gap-1.5 rounded-md px-1 py-1 text-left hover:bg-white/[0.04]"
      >
        <span>{title}</span>
        <span className="text-muted-foreground">{files.length}</span>
        <ChevronDown
          aria-hidden
          className={cn("size-3 text-muted-foreground transition-transform", !open && "-rotate-90")}
        />
        {(add > 0 || del > 0) && (
          <span className="ml-auto text-[12px]">
            <Lines add={add} del={del} />
          </span>
        )}
      </button>
      {open && (
        <ul className="mt-0.5 ml-1.5 border-l border-white/[0.08] pl-2.5">
          {shown.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                onClick={() => onOpen(file.path)}
                title={file.path}
                className="-mx-1.5 flex w-[calc(100%+12px)] items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-white/[0.05]"
              >
                <FileIcon path={file.path} className="size-3.5 shrink-0" />
                {/* The folder gives way first (zero basis), then the name truncates too. */}
                <span className="min-w-0 truncate">{file.path.split("/").pop()}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                  {file.path.split("/").slice(0, -1).join("/")}
                </span>
              </button>
            </li>
          ))}
          {files.length > shown.length && (
            <li>
              <button
                type="button"
                onClick={() => setAll(true)}
                className="flex items-center gap-2 px-0 py-1 text-[12.5px] text-muted-foreground hover:text-foreground"
              >
                <ChevronsUpDown aria-hidden className="size-3.5" />
                {t.plural("pr.moreFiles", files.length - shown.length)}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Changed files split like Linear: implementation first, then documentation, tests, build & dependencies. */
function FilesSummary({ pr, onOpen }: { pr: PullRequestDetails; onOpen: (path: string | null) => void }) {
  const t = useT();
  const groups = KINDS.map((kind) => ({ kind, files: pr.files.filter((f) => kindOf(f.path) === kind) }));
  const first = groups.find((g) => g.files.length > 0)?.kind;
  return (
    <Side title={t.plural("pr.filesChanged", pr.changedFiles)}>
      {groups.map((g) => (
        <FileGroup
          key={g.kind}
          title={t(KIND_LABEL[g.kind])}
          files={g.files}
          onOpen={onOpen}
          initiallyOpen={g.kind === first && g.kind !== "build"}
        />
      ))}
    </Side>
  );
}

type Entry = { key: string; login: string; body: string; at: string; review?: string };

function useComment(repoPath: string, number: number) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  return useMutation({
    mutationFn: (body: string) => gitBackend.commentPullRequest(repoPath, number, body),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["pull-request", repoPath, number] }),
    onError: (error) => notify({ tone: "error", title: t("pr.commentFailed"), detail: toGitError(error).message }),
  });
}

/** GitHub has no threads on a PR's conversation: a reply is a comment quoting the one it answers. */
function ReplyRow({ repoPath, pr, entry }: { repoPath: string; pr: PullRequestDetails; entry: Entry }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const comment = useComment(repoPath, pr.number);
  const send = () => {
    const quote = entry.body.trim().split("\n").find(Boolean)?.slice(0, 200);
    const body = `${quote ? `> ${quote}\n\n` : ""}@${entry.login} ${draft.trim()}`;
    comment.mutate(body, { onSuccess: () => setDraft("") });
  };
  return (
    <div className="flex items-center gap-2.5 border-t border-white/[0.06] px-4 py-2">
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white/[0.06]">
        <CornerDownRight aria-hidden className="size-3 text-muted-foreground" />
      </span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && draft.trim() && send()}
        placeholder={t("pr.leaveReply")}
        aria-label={t("pr.leaveReply")}
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
      />
      <button
        type="button"
        aria-label={t("pr.send")}
        disabled={!draft.trim() || comment.isPending}
        onClick={send}
        className="grid size-6 shrink-0 place-items-center rounded-full bg-white/[0.06] text-muted-foreground hover:enabled:text-foreground disabled:opacity-50"
      >
        {comment.isPending ? <BrailleLoader /> : <ArrowUp aria-hidden className="size-3.5" />}
      </button>
    </div>
  );
}

/** "Opened by x with N commits": the count unfolds the commits, newest first. */
function OpenedWith({ pr }: { pr: PullRequestDetails }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4 text-[13px] text-muted-foreground">
      <p className="flex items-center gap-2.5">
        <GitPullRequest aria-hidden className="size-4 text-added-foreground" />
        <span>
          {t("pr.openedBy", { author: pr.author.login })}{" "}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t.plural("pr.withCommits", pr.commits.length)}
          </button>{" "}
          · {formatAge(pr.createdAt, undefined, t.locale)}
        </span>
      </p>
      {open && (
        <ol className="mt-2 ml-1.5">
          {[...pr.commits].reverse().map((c) => (
            <li
              key={c.oid}
              className="relative flex items-center gap-2.5 py-1.5 pl-6 before:absolute before:top-0 before:bottom-0 before:left-[5px] before:w-px before:bg-white/10 first:before:top-1/2 last:before:bottom-1/2"
            >
              <GitCommitHorizontal aria-hidden className="absolute left-0 size-3 bg-background text-muted-foreground" />
              <span className="shrink-0 font-mono text-[12px]">{c.oid.slice(0, 7)}</span>
              <span className="min-w-0 truncate text-foreground/85">{c.messageHeadline}</span>
              {c.committedDate && <span className="shrink-0">· {formatAge(c.committedDate, undefined, t.locale)}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Activity({ repoPath, pr }: { repoPath: string; pr: PullRequestDetails }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const comment = useComment(repoPath, pr.number);
  const entries: Entry[] = [
    ...pr.comments.map((c, i) => ({ key: `c${i}`, login: c.author.login, body: c.body, at: c.createdAt })),
    ...pr.reviews
      .filter((r) => r.body || r.state !== "COMMENTED")
      .map((r, i) => ({ key: `r${i}`, login: r.author.login, body: r.body, at: r.submittedAt, review: r.state })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-[13px] text-muted-foreground">{t("linear.activity")}</h2>
      <OpenedWith pr={pr} />
      <ol className="space-y-3">
        {entries.map((e) => (
          <li key={e.key} className="surface overflow-hidden">
            <div className="px-4 pt-3 pb-3">
              <p className="mb-1.5 flex items-center gap-2 text-[13px]">
                <AuthorAvatar name={e.login} src={avatarOf(e.login)} className="size-5" />
                <span className="font-medium">{e.login}</span>
                {e.review === "APPROVED" && <span className="text-added-foreground">{t("github.approved")}</span>}
                {e.review === "CHANGES_REQUESTED" && (
                  <span className="text-removed-foreground">{t("github.changesRequested")}</span>
                )}
                <span className="text-muted-foreground">{formatAge(e.at, undefined, t.locale)}</span>
              </p>
              {e.body && (
                <div className="text-[14px]">
                  <Suspense fallback={<p className="whitespace-pre-wrap">{e.body}</p>}>
                    <Markdown text={e.body} />
                  </Suspense>
                </div>
              )}
            </div>
            <ReplyRow repoPath={repoPath} pr={pr} entry={e} />
          </li>
        ))}
      </ol>
      <div className="surface mt-5 rounded-xl focus-within:border-primary/40">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.metaKey && e.key === "Enter" && draft.trim())
              comment.mutate(draft, { onSuccess: () => setDraft("") });
          }}
          aria-label={t("pr.reply")}
          placeholder={t("pr.replyPlaceholder")}
          className="min-h-16 resize-none border-0 bg-transparent px-4 py-3 text-[13.5px] shadow-none focus-visible:ring-0 md:text-[13.5px] dark:bg-transparent"
        />
        <div className="flex justify-end px-2 pb-2">
          <Button
            size="icon-sm"
            aria-label={t("pr.send")}
            disabled={!draft.trim() || comment.isPending}
            onClick={() => comment.mutate(draft, { onSuccess: () => setDraft("") })}
            className="size-8 rounded-full"
          >
            {comment.isPending ? <BrailleLoader /> : <ArrowUp className="size-4" />}
          </Button>
        </div>
      </div>
    </section>
  );
}

const METHODS: MergeMethod[] = ["squash", "merge", "rebase"];

/** Merges on GitHub after an explicit confirmation; branches are left alone. */
function MergeButton({ repoPath, pr }: { repoPath: string; pr: PullRequestDetails }) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<MergeMethod>("squash");
  const merge = useMutation({
    mutationFn: () => gitBackend.mergePullRequest(repoPath, pr.number, method),
    onSuccess: () => {
      setOpen(false);
      notify({ tone: "success", title: t("pr.mergedNotice", { number: pr.number }) });
      void client.invalidateQueries({ queryKey: ["pull-request", repoPath, pr.number] });
      void client.invalidateQueries({ queryKey: [...repoKey(repoPath), "pull-requests"] });
    },
    onError: (error) => notify({ tone: "error", title: t("pr.mergeFailed"), detail: toGitError(error).message }),
  });
  if (pr.state !== "OPEN") return null;
  const blocked = pr.isDraft || pr.mergeable === "CONFLICTING";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" disabled={blocked} className="h-8 gap-1.5 rounded-full px-3.5 text-[13px]">
          <GitMerge aria-hidden className="size-3.5" />
          {t(`pr.method.${method}`)}…
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 rounded-xl p-3">
        <p className="mb-2 text-[13px] font-medium">{t("pr.mergeTitle", { number: pr.number })}</p>
        <div role="radiogroup" className="space-y-1">
          {METHODS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={method === m}
              onClick={() => setMethod(m)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-white/[0.05]",
                method === m && "bg-white/[0.07]",
              )}
            >
              <span
                className={cn(
                  "size-3 rounded-full border-2",
                  method === m ? "border-primary bg-primary" : "border-white/25",
                )}
              />
              {t(`pr.method.${m}`)}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">{t("pr.mergeHint", { base: pr.baseRefName })}</p>
        <Button
          size="sm"
          disabled={merge.isPending}
          onClick={() => merge.mutate()}
          className="mt-3 h-8 w-full gap-1.5 text-[13px]"
        >
          {merge.isPending ? <BrailleLoader /> : <GitMerge aria-hidden className="size-3.5" />}
          {t("pr.confirmMerge")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function Overview({
  repoPath,
  pr,
  onOpenFile,
}: {
  repoPath: string;
  pr: PullRequestDetails;
  onOpenFile: (path: string | null) => void;
}) {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto px-10 pb-16">
        <article className="mx-auto max-w-[820px] pt-8">
          <h1 className="font-display text-[26px]">{pr.title}</h1>
          <p className="mt-2 flex min-w-0 items-center gap-2 text-[13px]">
            <AuthorAvatar name={pr.author.login} src={avatarOf(pr.author.login)} className="size-5" />
            <span>{pr.author.login}</span>
            <span className="flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-muted-foreground">
              <MiddleTruncate text={pr.baseRefName} tail={14} className="max-w-[40%]" />
              <span aria-hidden>←</span>
              <MiddleTruncate text={pr.headRefName} tail={22} className="min-w-0 flex-1" />
            </span>
          </p>
          <div className="mt-6 border-t border-white/[0.07] pt-6 text-[14px]">
            {pr.body.trim() ? (
              <Suspense fallback={<p className="whitespace-pre-wrap">{pr.body}</p>}>
                <Markdown text={pr.body} />
              </Suspense>
            ) : (
              <p className="text-muted-foreground">{t("pr.noDescription")}</p>
            )}
          </div>
          <Activity repoPath={repoPath} pr={pr} />
        </article>
      </div>
      <aside className="hidden w-[340px] shrink-0 overflow-y-auto border-l border-white/[0.06] py-3 lg:block">
        <Side title={t("linear.status")}>
          <StatusMenu repoPath={repoPath} pr={pr} />
        </Side>
        <Side title={t("pr.resolves")}>
          <Resolves branch={pr.headRefName} />
        </Side>
        <Side title={t("pr.reviewers")}>
          <Reviewers pr={pr} />
          {pr.state === "OPEN" && <AddReviewer repoPath={repoPath} number={pr.number} />}
        </Side>
        <Side title={t("pr.checks")}>
          <ChecksMenu repoPath={repoPath} pr={pr} />
        </Side>
        <Side title={t("linear.branch")}>
          <BranchState pr={pr} />
        </Side>
        <Stack repoPath={repoPath} number={pr.number} />
        <FilesSummary pr={pr} onOpen={onOpenFile} />
      </aside>
    </div>
  );
}

/** Files of the whole PR next to their diffs; Commits adds the commit list to read it commit by commit. */
function DiffTab({ repoPath }: { repoPath: string }) {
  const t = useT();
  const [mode, setMode] = useState<"files" | "commits">("files");
  const showAll = useWorkspaceStore((s) => s.showPullRequestChanges);
  const pick = (next: "files" | "commits") => {
    if (next === "files") showAll();
    setMode(next);
  };
  const tab = (value: "files" | "commits", Icon: typeof ListTree, label: string) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => pick(value)}
      className="flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] text-muted-foreground hover:text-foreground aria-pressed:bg-white/[0.08] aria-pressed:text-foreground"
    >
      <Icon aria-hidden className="size-3.5" />
      {label}
    </button>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-white/[0.06] px-3">
        {tab("files", ListTree, t("pr.files"))}
        {tab("commits", GitCommitHorizontal, t("pr.commits"))}
      </div>
      <div className="min-h-0 flex-1">
        <Columns id={`pr-diff-${mode}`}>
          {mode === "commits" && (
            <>
              <Panel id="commits" defaultSize="26" minSize={240}>
                <CommitList repoPath={repoPath} />
              </Panel>
              <ResizeHandle />
            </>
          )}
          <Panel id="files" defaultSize={mode === "commits" ? "22" : "26"} minSize={200}>
            <ChangedFilesPanel repoPath={repoPath} />
          </Panel>
          <ResizeHandle />
          <Panel id="diff" minSize={320}>
            <DiffPanel repoPath={repoPath} />
          </Panel>
        </Columns>
      </div>
    </div>
  );
}

/** Linear-like pull request page: an overview to read and decide, the diff to review, merge in one place. */
export function PullRequestPage({ repoPath, pr }: { repoPath: string; pr: ActivePullRequest }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("overview");
  const repoName = useWorkspaceStore((s) => s.repo?.name ?? "");
  const details = usePullRequestDetails(repoPath, pr.number);
  const selectFile = useWorkspaceStore((s) => s.selectFile);
  const openFile = (path: string | null) => {
    if (path) selectFile(path);
    setTab("diff");
  };
  const data = details.data;
  const failingCount = data?.statusCheckRollup.filter((c) => checkOutcome(c) === "fail").length ?? 0;
  return (
    <section aria-label={`#${pr.number}`} className="flex h-full flex-col">
      <PanelHeader className="gap-2 text-[13px]">
        {data ? <StatusLine pr={data} /> : <GitPullRequest aria-hidden className="size-4 text-added-foreground" />}
        <span className="shrink-0 text-muted-foreground">#{pr.number}</span>
        <span className="min-w-0 truncate font-medium">{pr.title}</span>
        {data && <DiffStat pr={data} />}
        <button
          type="button"
          title={t("pr.copyNumber")}
          onClick={() => void copy(`${repoName}#${pr.number}`)}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-white/[0.08] px-2.5 py-0.5 font-mono text-[11.5px] text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
        >
          <GitPullRequest aria-hidden className="size-3.5" />
          {repoName}#{pr.number}
        </button>
        <button
          type="button"
          aria-label={t("pr.copyUrl")}
          title={t("pr.copyUrl")}
          onClick={() => void copy(pr.url)}
          className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-white/[0.07] hover:text-foreground"
        >
          <Link2 aria-hidden className="size-3.5" />
        </button>
        <PullRequestMenu pr={pr} data={data} />
      </PanelHeader>
      <div className="flex h-12 shrink-0 items-center gap-1 px-3">
        {(["overview", "diff", "ci"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className="h-8 rounded-full px-3.5 text-[13px] text-muted-foreground hover:text-foreground aria-selected:bg-white/[0.08] aria-selected:text-foreground"
          >
            {t(`pr.tab.${value}`)}
            {value === "ci" && failingCount > 0 && (
              <span className="ml-1.5 rounded-full bg-removed/25 px-1.5 text-[11px] text-removed-foreground">
                {failingCount}
              </span>
            )}
          </button>
        ))}
        <div className="ml-auto">{data && <MergeButton repoPath={repoPath} pr={data} />}</div>
      </div>
      {tab === "diff" ? (
        <DiffTab repoPath={repoPath} />
      ) : tab === "ci" && data ? (
        <PullRequestCi repoPath={repoPath} pr={data} />
      ) : details.isError ? (
        <DataUnavailable title={t("pr.loadError")} error={details.error} onRetry={() => void details.refetch()} />
      ) : !data ? (
        <PanelLoading title={t("common.loading")} variant="grid-orbit" />
      ) : (
        <Overview repoPath={repoPath} pr={data} onOpenFile={openFile} />
      )}
    </section>
  );
}

export default PullRequestPage;
