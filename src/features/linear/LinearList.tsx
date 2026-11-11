import { useShallow } from "zustand/react/shallow";
import { useState } from "react";
import { Box, Check, ChevronDown, CircleDashed, CircleUser, Layers, ListTodo, Plus } from "lucide-react";
import { RowSkeleton, SkeletonList } from "@/components/skeletons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { ALL_WORKSPACES, useLinearStore } from "@/stores/linear-store";
import { useUiStore } from "@/stores/ui-store";
import type { LinearState } from "@/types/git";
import { ConnectLinear } from "./ConnectLinear";
import { RepoTile } from "@/features/repositories/RepoSwitcher";
import { gitBackend } from "@/lib/tauri-git";
import {
  useActiveCycles,
  useActiveAccount,
  useAllWorkspaces,
  useLinearAccounts,
  useLinearOrganizations,
  useProjects,
  useWorkspaceIssues,
} from "./linear-queries";
import { ProjectIcon } from "./ProjectIcon";

export const PRIORITIES: { value: number; label: MessageKey }[] = [
  { value: 0, label: "linear.prio.none" },
  { value: 1, label: "linear.prio.urgent" },
  { value: 2, label: "linear.prio.high" },
  { value: 3, label: "linear.prio.medium" },
  { value: 4, label: "linear.prio.low" },
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

/** Linear's own status glyphs: dashed ring (backlog), ring (todo), filling pie (started), filled check / cross. */
export function StateDot({ state: given }: { state: Pick<LinearState, "type" | "color" | "name"> }) {
  // Linear also has "duplicate" (and may add types): drawn like Canceled, as Linear does.
  const known = ["triage", "backlog", "unstarted", "started", "completed", "canceled"].includes(given.type);
  const state = known ? given : { ...given, type: "canceled" as const };
  const color = state.color;
  return (
    <svg viewBox="0 0 14 14" fill="none" role="img" aria-label={state.name} className="size-3 shrink-0">
      <title>{state.name}</title>
      {state.type === "backlog" && (
        <circle cx="7" cy="7" r="6" stroke={color} strokeWidth="1.5" strokeDasharray="1.4 1.74" />
      )}
      {(state.type === "unstarted" || state.type === "started") && (
        <circle cx="7" cy="7" r="6" stroke={color} strokeWidth="1.5" />
      )}
      {state.type === "started" && (
        // A pie drawn as a thick stroke on a small circle: half full, as Linear shows In Progress.
        <circle
          cx="7"
          cy="7"
          r="2"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={`${Math.PI * 2} 100`}
          transform="rotate(-90 7 7)"
        />
      )}
      {(state.type === "completed" || state.type === "canceled" || state.type === "triage") && (
        <circle cx="7" cy="7" r="7" fill={color} />
      )}
      {state.type === "completed" && (
        <path
          d="M4.3 7.3 6.1 9 9.7 5.2"
          stroke="var(--background)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {state.type === "canceled" && (
        <path d="M5 5l4 4M9 5l-4 4" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" />
      )}
      {state.type === "triage" && (
        <path
          d="M4 5.5h5.5L8 4M10 8.5H4.5L6 10"
          stroke="var(--background)"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/** Workspace logo, or its initial when there is none or it can't be loaded. */
function OrgTile({ name, logoUrl, large = false }: { name: string; logoUrl?: string | null; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  const size = large ? "size-5 rounded-[5px]" : "size-4 rounded-[4px]";
  return logoUrl && !broken ? (
    <img src={logoUrl} alt="" onError={() => setBroken(true)} className={cn("shrink-0", size)} />
  ) : (
    <RepoTile name={name} className={cn(size, large ? "text-[10px]" : "text-[9px]")} />
  );
}

const ROW =
  "group/row flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-sidebar-foreground outline-none transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

/** The workspace in view, as Linear's switcher: a menu with the others, all of them, or a new one. */
function WorkspaceSwitcher() {
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
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-white/[0.08]">
        {all ? (
          <Layers aria-hidden className="size-5 shrink-0 rounded-[5px] bg-white/[0.08] p-0.5" />
        ) : (
          <OrgTile name={active?.name ?? "?"} logoUrl={active ? logos.get(active.id) : null} large />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">
            {all ? t("linear.allWorkspaces") : active?.name}
          </span>
          {!all && active?.userName && (
            <span className="block truncate text-[11px] text-muted-foreground">{active.userName}</span>
          )}
        </span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-[11.5px] text-muted-foreground">{t("linear.workspaces")}</DropdownMenuLabel>
        {accounts.length > 1 && (
          <DropdownMenuItem onSelect={() => setAccount(ALL_WORKSPACES)} className="gap-2">
            <Layers aria-hidden className="size-4" />
            <span className="flex-1">{t("linear.allWorkspaces")}</span>
            {all && <Check aria-hidden className="size-3.5 text-primary" />}
          </DropdownMenuItem>
        )}
        {accounts.map((a) => (
          <DropdownMenuItem key={a.id} onSelect={() => setAccount(a.id)} className="gap-2">
            <OrgTile name={a.name} logoUrl={logos.get(a.id)} />
            <span className="min-w-0 flex-1 truncate">{a.name}</span>
            {!all && a.id === active?.id && <Check aria-hidden className="size-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
        {others.length > 0 && <DropdownMenuSeparator />}
        {others.map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => connect(o.urlKey)} className="gap-2 text-muted-foreground">
            <OrgTile name={o.name} logoUrl={o.logoUrl} />
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            <span className="text-[11px] text-primary">{t("linear.connect")}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => connect()} className="gap-2 text-muted-foreground">
          <Plus aria-hidden className="size-4" />
          {t("linear.addOrg")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProgressRing({ value, color, className }: { value: number; color: string; className?: string }) {
  const r = 5;
  const length = 2 * Math.PI * r;
  return (
    <svg
      aria-label={`${Math.round(value * 100)}%`}
      viewBox="0 0 14 14"
      className={cn("size-3.5 shrink-0 -rotate-90", className)}
    >
      <circle cx="7" cy="7" r={r} fill="none" strokeWidth="2" className="stroke-white/12" />
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        strokeWidth="2"
        stroke={color}
        strokeDasharray={`${value * length} ${length}`}
      />
    </svg>
  );
}

function NavItem({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={onClick}
        className={cn(ROW, active && "bg-white/[0.08] text-foreground")}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined && <span className="text-[11.5px] text-muted-foreground tabular-nums">{count}</span>}
      </button>
    </li>
  );
}

/** Sidebar of the Linear view, as Linear's: the workspace, then where to go — the issues live in the page. */
export function LinearList({ query }: { query: string }) {
  const t = useT();
  const accounts = useLinearAccounts();
  const account = useActiveAccount();
  const mine = useWorkspaceIssues().data;
  const projects = useProjects(account?.id).data ?? [];
  const cycles = useActiveCycles(account?.id).data;
  const cycleCount = cycles?.reduce(
    (n, c) => n + c.issues.filter((i) => i.state.type !== "completed" && i.state.type !== "canceled").length,
    0,
  );
  const { page, project, setPage, setProject } = useLinearStore(
    useShallow((s) => ({ page: s.page, project: s.project, setPage: s.setPage, setProject: s.setProject })),
  );
  const [showAll, setShowAll] = useState(false);
  if (accounts.data && accounts.data.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ConnectLinear />
      </div>
    );
  }
  if (!account)
    return (
      <SkeletonList
        rows={5}
        className="px-2 pt-2"
        row={(i) => <RowSkeleton i={i + 2} height={28} lines={1} trail={false} />}
      />
    );
  const open = mine?.filter((i) => i.state.type !== "completed" && i.state.type !== "canceled").length;
  const needle = query.toLowerCase();
  const active = projects.filter(
    (p) =>
      p.status?.type !== "completed" &&
      p.status?.type !== "canceled" &&
      (!needle || p.name.toLowerCase().includes(needle)),
  );
  const shown = showAll || needle ? active : active.slice(0, 8);
  return (
    <nav aria-label="Linear" className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-2">
      <WorkspaceSwitcher />
      <ul className="mt-2 space-y-px">
        <NavItem
          icon={<CircleUser aria-hidden className="size-4 text-muted-foreground" />}
          label={t("linear.myIssues")}
          count={open}
          active={page === "mine"}
          onClick={() => setPage("mine")}
        />
        <NavItem
          icon={<ListTodo aria-hidden className="size-4 text-muted-foreground" />}
          label={t("linear.allIssues")}
          active={page === "all"}
          onClick={() => setPage("all")}
        />
        <NavItem
          icon={<CircleDashed aria-hidden className="size-4 text-muted-foreground" />}
          label={t("linear.currentCycle")}
          count={cycleCount}
          active={page === "cycle"}
          onClick={() => setPage("cycle")}
        />
        <NavItem
          icon={<Box aria-hidden className="size-4 text-muted-foreground" />}
          label={t("linear.projects")}
          count={active.length}
          active={page === "projects" && !project}
          onClick={() => setPage("projects")}
        />
      </ul>
      {shown.length > 0 && (
        <>
          <p className="mt-4 mb-1 px-2 text-[11.5px] font-medium text-muted-foreground">{t("linear.activeProjects")}</p>
          <ul className="space-y-px">
            {shown.map((p) => (
              <NavItem
                key={p.id}
                icon={<ProjectIcon project={p} />}
                label={p.name}
                active={project === p.id}
                onClick={() => setProject(p.id)}
              />
            ))}
          </ul>
          {!needle && active.length > shown.length && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-0.5 w-full rounded-md px-2 py-1 text-left text-[12px] text-muted-foreground hover:text-foreground"
            >
              {t("linear.showAllProjects", { count: active.length })}
            </button>
          )}
        </>
      )}
    </nav>
  );
}
