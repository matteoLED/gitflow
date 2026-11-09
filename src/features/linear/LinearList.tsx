import { useState, type ReactNode } from "react";
import { ChevronRight, Layers, Plus } from "lucide-react";
import { PanelLoading } from "@/components/layout/panel";
import { DataUnavailable, EmptyState } from "@/components/states";
import { useT, type MessageKey } from "@/i18n";
import { formatAge } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { ALL_WORKSPACES, useLinearStore } from "@/stores/linear-store";
import { useUiStore } from "@/stores/ui-store";
import type { LinearState } from "@/types/git";
import { ConnectLinear } from "./ConnectLinear";
import { RepoTile } from "@/features/repositories/RepoSwitcher";
import { gitBackend } from "@/lib/tauri-git";
import {
  useActiveAccount,
  useAllWorkspaces,
  useLinearAccounts,
  useLinearOrganizations,
  useWorkspaceIssues,
  type WorkspaceIssue,
} from "./linear-queries";

const GROUPS: { type: LinearState["type"]; label: MessageKey }[] = [
  { type: "started", label: "linear.started" },
  { type: "unstarted", label: "linear.unstarted" },
  { type: "triage", label: "linear.triage" },
  { type: "backlog", label: "linear.backlog" },
];

/** Linear's priority bars: urgent is a red mark, then 3/2/1 bars, none is a dash. */
export function PriorityIcon({ priority }: { priority: number }) {
  if (priority === 1)
    return (
      <span className="grid size-3.5 place-items-center rounded-[3px] bg-orange-500 text-[9px] font-bold text-black">
        !
      </span>
    );
  if (priority === 0) return <span className="block h-px w-3 bg-muted-foreground/60" />;
  const bars = 5 - priority; // high 3, medium 2, low 1
  return (
    <span className="flex h-3 items-end gap-px">
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={cn("w-[3px] rounded-[1px]", n <= bars ? "bg-foreground/80" : "bg-white/15")}
          style={{ height: `${n * 33}%` }}
        />
      ))}
    </span>
  );
}

export function StateDot({ state }: { state: LinearState }) {
  const half = state.type === "started";
  return (
    <span
      title={state.name}
      className="inline-block size-3 shrink-0 rounded-full border-[1.5px]"
      style={{
        borderColor: state.color,
        background: half ? `linear-gradient(90deg, ${state.color} 50%, transparent 50%)` : undefined,
      }}
    />
  );
}

/** Workspace logo, or its initial when there is none or it can't be loaded. */
function OrgTile({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  const [broken, setBroken] = useState(false);
  return logoUrl && !broken ? (
    <img src={logoUrl} alt="" onError={() => setBroken(true)} className="size-4 shrink-0 rounded-[4px]" />
  ) : (
    <RepoTile name={name} className="size-4 rounded-[4px] text-[9px]" />
  );
}

const ROW =
  "group/org flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-sidebar-foreground outline-none transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

/** Linear-like workspace list: connected ones switch the view, the others offer to connect them. */
function Workspaces() {
  const t = useT();
  const accounts = useLinearAccounts().data ?? [];
  const active = useActiveAccount();
  const all = useAllWorkspaces();
  const setAccount = useLinearStore((s) => s.setAccount);
  const orgs = useLinearOrganizations(active?.id).data ?? [];
  const logos = new Map(orgs.map((o) => [o.id, o.logoUrl]));
  const others = orgs.filter((o) => !accounts.some((a) => a.id === o.id));
  const connect = (urlKey?: string) => {
    if (urlKey) void gitBackend.openGithubUrl(`https://linear.app/${urlKey}/settings/account/security`);
    useUiStore.getState().setSettingsOpen(true, "integrations");
  };
  return (
    <div className="px-2">
      <p className="flex h-7 items-center px-2 text-[11.5px] font-medium text-muted-foreground">
        {t("linear.workspaces")}
      </p>
      <ul className="space-y-px">
        {accounts.length > 1 && (
          <li>
            <button
              type="button"
              aria-current={all ? "true" : undefined}
              onClick={() => setAccount(ALL_WORKSPACES)}
              className={cn(ROW, all && "bg-white/[0.08] text-foreground")}
            >
              <Layers aria-hidden className="size-4 shrink-0 p-px" />
              <span className="min-w-0 flex-1 truncate">{t("linear.allWorkspaces")}</span>
            </button>
          </li>
        )}
        {accounts.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              aria-current={!all && a.id === active?.id ? "true" : undefined}
              onClick={() => setAccount(a.id)}
              className={cn(ROW, !all && a.id === active?.id && "bg-white/[0.08] text-foreground")}
            >
              <OrgTile name={a.name} logoUrl={logos.get(a.id)} />
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="truncate text-[11.5px] text-muted-foreground">{a.userName}</span>
            </button>
          </li>
        ))}
        {others.map((o) => (
          <li key={o.id}>
            <button type="button" onClick={() => connect(o.urlKey)} className={cn(ROW, "text-muted-foreground")}>
              <OrgTile name={o.name} logoUrl={o.logoUrl} />
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              <span className="text-[11.5px] text-primary opacity-0 group-hover/org:opacity-100">
                {t("linear.connect")}
              </span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" onClick={() => connect()} className={cn(ROW, "text-muted-foreground")}>
            <Plus aria-hidden className="size-4 p-0.5" />
            {t("linear.addOrg")}
          </button>
        </li>
      </ul>
    </div>
  );
}

function Group({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <li className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-1 flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium text-muted-foreground outline-none hover:bg-white/[0.06] hover:text-foreground"
      >
        <span className="font-medium">{label}</span>
        <span>{count}</span>
        <ChevronRight aria-hidden className={cn("size-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && <ul className="mt-0.5">{children}</ul>}
    </li>
  );
}

function IssueRow({ issue, showOrg }: { issue: WorkspaceIssue; showOrg: boolean }) {
  const t = useT();
  const { issue: selected, issueOrg, setIssue } = useLinearStore();
  return (
    <li>
      <button
        type="button"
        onClick={() => setIssue(issue.id, issue.orgId)}
        className={cn(
          "grid w-full grid-cols-[14px_1fr_auto] items-center gap-x-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring",
          selected === issue.id && (issueOrg ?? issue.orgId) === issue.orgId && "bg-white/[0.08]",
        )}
      >
        <StateDot state={issue.state} />
        <span className="truncate text-[12.5px]">{issue.title}</span>
        <span className="text-[11.5px] text-muted-foreground">{formatAge(issue.updatedAt, undefined, t.locale)}</span>
        <span className="col-start-2 col-end-4 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <PriorityIcon priority={issue.priority} />
          <span>{issue.identifier}</span>
          {showOrg && <span className="truncate">· {issue.orgName}</span>}
          {issue.project && <span className="truncate">· {issue.project.name}</span>}
        </span>
      </button>
    </li>
  );
}

/** Sidebar of the Linear view: the user's open issues in the chosen organization, by status. */
export function LinearList({ query }: { query: string }) {
  const t = useT();
  const accounts = useLinearAccounts();
  const account = useActiveAccount();
  const issues = useWorkspaceIssues();
  const all = useAllWorkspaces();
  if (accounts.data && accounts.data.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ConnectLinear />
      </div>
    );
  }
  if (!account) return <PanelLoading title={t("common.loading")} variant="grid-orbit" />;
  const needle = query.toLowerCase();
  const visible = (issues.data ?? []).filter(
    (i) => !needle || `${i.identifier} ${i.title} ${i.project?.name ?? ""}`.toLowerCase().includes(needle),
  );
  return (
    <nav aria-label="Linear" className="flex min-h-0 flex-1 flex-col">
      <Workspaces />
      <p className="mt-3 flex h-7 items-center px-4 text-[11.5px] font-medium text-muted-foreground">
        {t("linear.myIssues")}
      </p>
      {issues.error && !issues.data ? (
        <DataUnavailable title={t("linear.loadError")} error={issues.error} onRetry={issues.refetch} />
      ) : !issues.data ? (
        <PanelLoading title={t("linear.loading")} variant="grid-wave" />
      ) : visible.length === 0 ? (
        <EmptyState size="sm" title={t("linear.empty")} description={t("linear.emptyHint")} />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {GROUPS.map(({ type, label }) => {
            const members = visible.filter((i) => i.state.type === type);
            return (
              members.length > 0 && (
                <Group key={type} label={t(label)} count={members.length}>
                  {members.map((issue) => (
                    <IssueRow key={`${issue.orgId}:${issue.id}`} issue={issue} showOrg={all} />
                  ))}
                </Group>
              )
            );
          })}
        </ul>
      )}
    </nav>
  );
}
