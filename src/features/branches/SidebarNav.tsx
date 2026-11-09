import { useShallow } from "zustand/react/shallow";
import { Link } from "@tanstack/react-router";
import { VIEW_PATHS } from "@/app/routes";
import { Activity, GitCommitVertical, House, Layers, MonitorSmartphone, Sparkles, SquareTerminal } from "lucide-react";
import type { ComponentType } from "react";
import { GithubIcon } from "@/components/github-icon";
import { LinearIcon } from "@/features/linear/LinearIcon";
import { useWorkingTree } from "@/lib/git-queries";
import { useWorkspaceStore, type View } from "@/stores/workspace-store";
import { useUiStore } from "@/stores/ui-store";
import { useT } from "@/i18n";

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** Linear-like navigation row: icon, label, then a count or a shortcut hint on the right. */
export const NAV_ITEM =
  "group/nav flex h-7 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-sidebar-foreground outline-none transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-white/[0.08] aria-[current=page]:text-foreground aria-pressed:bg-white/[0.08] aria-pressed:text-foreground";

type RowProps = { Icon: IconType; label: string; hint?: string | number; active: boolean };

function RowContent({ Icon, label, hint }: Omit<RowProps, "active">) {
  return (
    <>
      <Icon
        aria-hidden
        className="size-4 shrink-0 opacity-75 group-aria-[current=page]/nav:text-primary group-aria-[current=page]/nav:opacity-100"
      />
      <span className="truncate">{label}</span>
      {hint !== undefined &&
        hint !== "" &&
        hint !== 0 &&
        (typeof hint === "string" ? (
          <kbd className="kbd ml-auto opacity-0 transition-opacity group-hover/nav:opacity-100">{hint}</kbd>
        ) : (
          <span className="ml-auto shrink-0 text-[11.5px] text-muted-foreground tabular-nums">{hint}</span>
        ))}
    </>
  );
}

/** A page of the app: a router link. Tools (Linear, Preview, Agents) lead back to the history when active. */
function PageRow({ view, ...props }: RowProps & { view: View }) {
  const toggles = view === "linear" || view === "preview" || view === "agents";
  const to = props.active && toggles ? VIEW_PATHS.history : VIEW_PATHS[view];
  return (
    <li>
      <Link to={to} aria-current={props.active ? "page" : undefined} className={NAV_ITEM}>
        <RowContent {...props} />
      </Link>
    </li>
  );
}

/** The app's pages, one per row, then the tools. */
export function SidebarNav({ repoPath }: { repoPath: string }) {
  const t = useT();
  const view = useWorkspaceStore((s) => s.view);
  const { terminalOpen, setTerminalOpen } = useUiStore(
    useShallow((s) => ({ terminalOpen: s.terminalOpen, setTerminalOpen: s.setTerminalOpen })),
  );
  const changes = useWorkingTree(repoPath).data?.length ?? 0;
  const row = (target: View, Icon: IconType, label: string, hint?: string | number) => (
    <PageRow key={target} view={target} Icon={Icon} label={label} hint={hint} active={view === target} />
  );
  return (
    <nav aria-label={t("view.tabs")} className="px-2">
      <ul className="space-y-px">
        {row("home", House, t("view.home"))}
        {row("history", GitCommitVertical, t("view.history"))}
        {row("changes", Layers, t("view.changes"), changes > 99 ? "99+" : changes)}
        {row("github", GithubIcon, t("view.github"))}
        {row("ci", Activity, "CI")}
      </ul>
      <p className="mt-4 mb-1 px-2 text-[11.5px] font-medium text-muted-foreground">{t("view.tools")}</p>
      <ul className="space-y-px">
        {row("linear", LinearIcon, "Linear", "⌘⇧L")}
        {row("preview", MonitorSmartphone, t("view.preview"), "⌘⇧P")}
        {row("agents", Sparkles, t("view.agents"))}
        <li>
          <button
            type="button"
            aria-pressed={terminalOpen}
            onClick={() => setTerminalOpen(!terminalOpen)}
            className={NAV_ITEM}
          >
            <RowContent Icon={SquareTerminal} label={t("terminal.toggle")} hint="⌃`" />
          </button>
        </li>
      </ul>
    </nav>
  );
}
