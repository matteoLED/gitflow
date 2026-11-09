import {
  Bot,
  Check,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  CircleX,
  Eye,
  Flame,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { PanelHeader, PanelLoading } from "@/components/layout/panel";
import { EmptyState } from "@/components/states";
import { useOpenPullRequest } from "@/features/github/PullRequestList";
import { useT, type MessageKey } from "@/i18n";
import { formatAge } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { useAgentsStore } from "@/stores/agents-store";
import { useLinearStore } from "@/stores/linear-store";
import { useWorkStore } from "@/stores/work-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { InboxItem, InboxReason } from "./inbox";
import { useInbox } from "./use-work-items";

const REASON: Record<InboxReason, { icon: LucideIcon; label: MessageKey; className: string }> = {
  ciFailed: { icon: CircleX, label: "inbox.ciFailed", className: "text-removed-foreground" },
  changesRequested: { icon: CircleAlert, label: "inbox.changesRequested", className: "text-removed-foreground" },
  review: { icon: Eye, label: "inbox.review", className: "text-primary" },
  ready: { icon: CircleCheck, label: "inbox.ready", className: "text-added-foreground" },
  urgentIssue: { icon: Flame, label: "inbox.urgentIssue", className: "text-renamed" },
  agentFinished: { icon: Bot, label: "inbox.agentFinished", className: "text-primary" },
};

/** Takes the user to the thing: the work detail, the Linear issue or the agent conversation. */
function useOpenItem(repoPath: string) {
  const select = useWorkStore((s) => s.select);
  const setView = useWorkspaceStore((s) => s.setView);
  const setIssue = useLinearStore((s) => s.setIssue);
  const selectRun = useAgentsStore((s) => s.select);
  const { open: openPr } = useOpenPullRequest(repoPath);
  return (item: InboxItem) => {
    if (item.work) {
      select(item.work.branch);
      if (item.work.pr) void openPr(item.work.pr, "work");
    } else if (item.issue) {
      setIssue(item.issue.id);
      setView("linear");
    } else if (item.run) {
      selectRun({ type: "run", id: item.run.id });
      setView("agents");
    }
  };
}

function InboxRow({ item, onOpen }: { item: InboxItem; onOpen: () => void }) {
  const t = useT();
  const dismiss = useWorkStore((s) => s.dismiss);
  const { icon: Icon, label, className } = REASON[item.reason];
  return (
    <li className="group/row relative">
      <button
        type="button"
        onClick={onOpen}
        className="grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/[0.04] px-5 py-2.5 text-left outline-none hover:bg-white/[0.035] focus-visible:bg-white/[0.05]"
      >
        <Icon aria-hidden className={cn("size-4", className)} />
        <span className="min-w-0">
          <span className="block truncate text-[13px]">{item.title}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className={cn("shrink-0 font-medium", className)}>{t(label)}</span>
            <span aria-hidden>·</span>
            <span className="truncate font-mono text-[11.5px]">{item.detail}</span>
          </span>
        </span>
        <span className="text-[12px] text-muted-foreground tabular-nums group-hover/row:invisible">
          {item.at && formatAge(item.at, undefined, t.locale)}
        </span>
      </button>
      <button
        type="button"
        aria-label={t("inbox.done")}
        title={t("inbox.done")}
        onClick={() => dismiss(item.key, item.version)}
        className="absolute top-1/2 right-4 hidden size-7 -translate-y-1/2 place-items-center rounded-md border border-white/10 bg-card text-muted-foreground group-hover/row:grid hover:text-foreground"
      >
        <Check aria-hidden className="size-3.5" />
      </button>
    </li>
  );
}

/** Linear's Inbox for the whole workflow: failing CI, reviews, requested changes, urgent issues, finished agents. */
export function InboxPage({ repoPath }: { repoPath: string }) {
  const t = useT();
  const items = useInbox(repoPath);
  const dismiss = useWorkStore((s) => s.dismiss);
  const open = useOpenItem(repoPath);
  if (!items) return <PanelLoading title={t("common.loading")} variant="grid-wave" />;
  return (
    <section aria-label={t("work.filter.inbox")} className="flex h-full flex-col">
      <PanelHeader className="gap-1.5 text-[13px]">
        <span className="font-medium">{t("work.filter.inbox")}</span>
        <span className="text-muted-foreground">{items.length}</span>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => items.forEach((i) => dismiss(i.key, i.version))}
            className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
          >
            <CheckCheck aria-hidden className="size-3.5" />
            {t("inbox.allDone")}
          </button>
        )}
      </PanelHeader>
      {items.length === 0 ? (
        <EmptyState icon={<Inbox />} title={t("inbox.empty")} description={t("inbox.emptyHint")} />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {items.map((item) => (
            <InboxRow key={item.key} item={item} onOpen={() => open(item)} />
          ))}
        </ul>
      )}
    </section>
  );
}
