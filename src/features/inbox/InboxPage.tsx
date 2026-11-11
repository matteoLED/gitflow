import { lazy, useEffect, type ComponentType, type SVGProps } from "react";
import { useShallow } from "zustand/react/shallow";
import { Activity, Check, ExternalLink, Inbox, ListFilter, Sparkles } from "lucide-react";
import { GithubIcon } from "@/components/github-icon";
import { PanelHeader } from "@/components/layout/panel";
import { RowSkeleton, SkeletonList } from "@/components/skeletons";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LinearIcon } from "@/features/linear/LinearIcon";
import { useT, type MessageKey, type Translator } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { formatAge } from "@/lib/format-date";
import { nextListIndex } from "@/lib/list-navigation";
import { cn } from "@/lib/utils";
import { useAgentsStore } from "@/stores/agents-store";
import { useCiStore } from "@/stores/ci-store";
import { useInboxStore } from "@/stores/inbox-store";
import { useLinearStore } from "@/stores/linear-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { filterInbox, type InboxItem, type InboxSource } from "./inbox-items";
import { useInbox, useInboxActions, useOpenInboxItem } from "./use-inbox";

const PullRequestPage = lazy(() => import("@/features/github/PullRequestPage"));
const LinearIssueView = lazy(() => import("@/features/linear/LinearIssueView"));
const AgentDetail = lazy(() => import("@/features/agents/AgentDetail").then((m) => ({ default: m.AgentDetail })));
const CiPage = lazy(() => import("@/features/ci/CiPage").then((m) => ({ default: m.CiPage })));

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const SOURCES: { value: InboxSource; icon: Icon; label: MessageKey }[] = [
  { value: "github", icon: GithubIcon, label: "inbox.source.github" },
  { value: "linear", icon: LinearIcon, label: "inbox.source.linear" },
  { value: "agent", icon: Sparkles, label: "inbox.source.agent" },
  { value: "ci", icon: Activity, label: "inbox.source.ci" },
];
const ICONS = Object.fromEntries(SOURCES.map((s) => [s.value, s.icon])) as Record<InboxSource, Icon>;

const REASONS: Record<string, MessageKey> = {
  review_requested: "inbox.reason.reviewRequested",
  mention: "inbox.reason.mention",
  team_mention: "inbox.reason.mention",
  comment: "inbox.reason.comment",
  author: "inbox.reason.author",
  assign: "inbox.reason.assigned",
  state_change: "inbox.reason.stateChange",
  ci_activity: "inbox.reason.ciActivity",
  issueAssignedToYou: "inbox.reason.assigned",
  issueMention: "inbox.reason.mention",
  issueCommentMention: "inbox.reason.mention",
  issueNewComment: "inbox.reason.comment",
  issueComment: "inbox.reason.comment",
  issueStatusChanged: "inbox.reason.stateChange",
  issueCreated: "inbox.reason.created",
  done: "inbox.reason.agentDone",
  failed: "inbox.reason.failed",
};

const reasonOf = (t: Translator, item: InboxItem) => t(REASONS[item.reason] ?? "inbox.reason.other");
const failed = (item: InboxItem) => item.reason === "failed";

/** Shortcuts apply with nothing focused or within the list: the detail views keep their own keys. */
function isForInbox(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  const modified = event.metaKey || event.ctrlKey || event.altKey;
  return !modified && (target === document.body || !!target?.closest("[data-inbox-keys]"));
}

type RowProps = { item: InboxItem; selected: boolean; onShow: () => void; onDone: () => void };

function InboxRow({ item, selected, onShow, onDone }: RowProps) {
  const t = useT();
  const SourceIcon = ICONS[item.target.kind];
  return (
    <li className="group/row relative">
      <button
        type="button"
        id={`inbox-${item.key}`}
        aria-current={selected ? "true" : undefined}
        onClick={onShow}
        className={cn(
          "grid w-full grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring",
          selected && "bg-white/[0.08]",
        )}
      >
        <SourceIcon
          aria-hidden
          className={cn("size-3.5", failed(item) ? "text-removed-foreground" : "text-muted-foreground")}
        />
        <span
          className={cn("truncate text-[13px]", item.unread ? "font-medium text-foreground" : "text-muted-foreground")}
        >
          {item.title}
        </span>
        <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground tabular-nums group-hover/row:invisible">
          {formatAge(item.at, undefined, t.locale)}
          <span
            aria-label={item.unread ? t("inbox.unread") : undefined}
            className={cn("size-1.5 rounded-full", item.unread ? "bg-primary" : "bg-transparent")}
          />
        </span>
        <span className="col-start-2 col-end-4 truncate text-[12px] text-muted-foreground">
          {reasonOf(t, item)} · {item.context}
        </span>
      </button>
      <button
        type="button"
        aria-label={t("inbox.done")}
        title={`${t("inbox.done")} (E)`}
        onClick={onDone}
        className="absolute top-1.5 right-1.5 hidden size-6 place-items-center rounded-md text-muted-foreground group-hover/row:grid hover:bg-white/[0.08] hover:text-foreground"
      >
        <Check aria-hidden className="size-3.5" />
      </button>
    </li>
  );
}

function Filters() {
  const t = useT();
  const { unreadOnly, source, setUnreadOnly, setSource } = useInboxStore(
    useShallow((s) => ({
      unreadOnly: s.unreadOnly,
      source: s.source,
      setUnreadOnly: s.setUnreadOnly,
      setSource: s.setSource,
    })),
  );
  const tab = (value: boolean, label: string) => (
    <button
      type="button"
      aria-pressed={unreadOnly === value}
      onClick={() => setUnreadOnly(value)}
      className="h-6 rounded-md px-2 text-[12px] text-muted-foreground hover:text-foreground aria-pressed:bg-white/[0.08] aria-pressed:text-foreground"
    >
      {label}
    </button>
  );
  return (
    <div data-inbox-keys className="flex items-center gap-0.5 px-2 pb-1">
      {tab(false, t("inbox.filter.all"))}
      {tab(true, t("inbox.filter.unread"))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("inbox.filter.source")}
            title={t("inbox.filter.source")}
            className={cn(
              "ml-auto flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
              source && "text-foreground",
            )}
          >
            <ListFilter aria-hidden className="size-3.5" />
            {source && t(SOURCES.find((s) => s.value === source)?.label ?? "inbox.filter.allSources")}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuRadioGroup
            value={source ?? ""}
            onValueChange={(value) => setSource(SOURCES.find((s) => s.value === value)?.value ?? null)}
          >
            <DropdownMenuRadioItem value="" className="text-[13px]">
              {t("inbox.filter.allSources")}
            </DropdownMenuRadioItem>
            {SOURCES.map(({ value, icon: SourceIcon, label }) => (
              <DropdownMenuRadioItem key={value} value={value} className="gap-2 text-[13px]">
                <SourceIcon aria-hidden className="size-3.5 text-muted-foreground" />
                {t(label)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** j/k move, Enter opens, E is done, U toggles unread: on the window, while the inbox is shown. */
function useInboxKeys(repoPath: string, shown: InboxItem[]) {
  const { done, toggleUnread } = useInboxActions(repoPath);
  const { show, open } = useOpenInboxItem(repoPath);
  const selected = useInboxStore((s) => s.selected);
  const index = shown.findIndex((i) => i.key === selected);
  const current = shown[index];
  const showAt = (i: number) => {
    const item = shown[i];
    if (!item) return;
    show(item);
    document.getElementById(`inbox-${item.key}`)?.scrollIntoView({ block: "nearest" });
  };
  // Re-bound each render: the handler always sees the current list and selection.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isForInbox(event)) return;
      const key = event.key.toLowerCase();
      const next = nextListIndex(key === "j" ? "ArrowDown" : key === "k" ? "ArrowUp" : "", index, shown.length);
      if (next !== null) showAt(next);
      else if (key === "enter" && current) open(current);
      else if (key === "e" && current) {
        done(current);
        showAt(index + 1 < shown.length ? index + 1 : index - 1);
      } else if (key === "u" && current) toggleUnread(current);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
}

/** Left column of the Inbox page: GitHub, Linear, agents and CI, newest first. */
export function InboxList({ repoPath, query }: { repoPath: string; query: string }) {
  const t = useT();
  const { items, errors } = useInbox(repoPath);
  const { unreadOnly, source, selected, setUnreadOnly, setSource } = useInboxStore(
    useShallow((s) => ({
      unreadOnly: s.unreadOnly,
      source: s.source,
      selected: s.selected,
      setUnreadOnly: s.setUnreadOnly,
      setSource: s.setSource,
    })),
  );
  const { show } = useOpenInboxItem(repoPath);
  const { done } = useInboxActions(repoPath);
  const shown = items ? filterInbox(items, { unreadOnly, source, query }) : [];
  useInboxKeys(repoPath, shown);
  return (
    <>
      <Filters />
      {!items ? (
        <SkeletonList rows={10} className="min-h-0 flex-1" row={(i) => <RowSkeleton i={i} height={48} />} />
      ) : items.length === 0 ? (
        <EmptyState size="sm" icon={<Inbox />} title={t("inbox.zero")} hint={t("inbox.zeroHint")} />
      ) : shown.length === 0 ? (
        <EmptyState
          size="sm"
          title={t("inbox.noMatch")}
          action={{
            label: t("inbox.showAll"),
            onClick: () => {
              setUnreadOnly(false);
              setSource(null);
            },
          }}
        />
      ) : (
        <ul
          data-inbox-keys
          aria-label={t("view.inbox")}
          className="min-h-0 flex-1 space-y-px overflow-y-auto px-2 pb-2"
        >
          {shown.map((item) => (
            <InboxRow
              key={item.key}
              item={item}
              selected={item.key === selected}
              onShow={() => show(item)}
              onDone={() => done(item)}
            />
          ))}
        </ul>
      )}
      {errors.map(({ source: name, error }) => (
        <p
          key={name}
          title={toGitError(error).message}
          className="truncate border-t border-white/[0.06] px-3 py-1.5 text-[11.5px] text-muted-foreground"
        >
          {t("inbox.sourceError", { source: name })}
        </p>
      ))}
    </>
  );
}

/** What's shown for an item the app has no page for yet (or before a pull request is fetched). */
function ItemSummary({ repoPath, item }: { repoPath: string; item: InboxItem }) {
  const t = useT();
  const SourceIcon = ICONS[item.target.kind];
  const { open, canOpenInApp } = useOpenInboxItem(repoPath);
  const { done } = useInboxActions(repoPath);
  const inApp = canOpenInApp(item);
  return (
    <section aria-label={item.title} className="flex h-full flex-col">
      <PanelHeader className="gap-1.5 text-[13px] text-muted-foreground">
        <SourceIcon aria-hidden className="size-3.5" />
        <span className="truncate">{item.context}</span>
      </PanelHeader>
      <div className="mx-auto w-full max-w-[720px] px-8 pt-10">
        <p className="text-[12px] text-muted-foreground">
          {reasonOf(t, item)} · {formatAge(item.at, undefined, t.locale)}
        </p>
        <h1 className="mt-1 text-[20px] font-medium">{item.title}</h1>
        <div className="mt-5 flex items-center gap-2">
          <Button size="sm" onClick={() => open(item)} className="h-7 gap-1.5 text-[12.5px]">
            {!inApp && <ExternalLink aria-hidden className="size-3.5" />}
            {t(inApp ? "inbox.open" : "inbox.openOnGithub")}
            <kbd className="font-sans text-[11px] text-primary-foreground/70">↵</kbd>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => done(item)} className="h-7 gap-1.5 text-[12.5px]">
            <Check aria-hidden className="size-3.5" />
            {t("inbox.done")}
            <kbd className="font-sans text-[11px] text-muted-foreground/70">E</kbd>
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Right side of the Inbox page: the selected item in the app's own view of it, once it's loaded there. */
export function InboxDetail({ repoPath }: { repoPath: string }) {
  const t = useT();
  const { items } = useInbox(repoPath);
  const selected = useInboxStore((s) => s.selected);
  const pullRequest = useWorkspaceStore((s) => s.pullRequest);
  const issue = useLinearStore((s) => s.issue);
  const agentSelection = useAgentsStore((s) => s.selection);
  const ciRun = useCiStore((s) => s.run);
  const item = items?.find((i) => i.key === selected);
  if (!item)
    return (
      <EmptyState
        icon={<Inbox />}
        title={t("inbox.pick")}
        hint={
          <>
            <kbd className="kbd">J</kbd> <kbd className="kbd">K</kbd> {t("inbox.keysMove")} ·{" "}
            <kbd className="kbd">↵</kbd> {t("inbox.open")} · <kbd className="kbd">E</kbd> {t("inbox.done")} ·{" "}
            <kbd className="kbd">U</kbd> {t("inbox.toggleUnread")}
          </>
        }
      />
    );
  const { target } = item;
  if (target.kind === "github" && pullRequest && pullRequest.url === target.url)
    return <PullRequestPage key={pullRequest.number} repoPath={repoPath} pr={pullRequest} />;
  if (target.kind === "linear" && issue === target.issueId) return <LinearIssueView repoPath={repoPath} />;
  if (target.kind === "agent" && agentSelection.type === "run" && agentSelection.id === target.runId)
    return <AgentDetail repoPath={repoPath} />;
  if (target.kind === "ci" && ciRun === target.runId) return <CiPage repoPath={repoPath} />;
  return <ItemSummary repoPath={repoPath} item={item} />;
}
