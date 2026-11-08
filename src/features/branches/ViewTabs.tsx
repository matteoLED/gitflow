import { GitPullRequestArrow, Layers, type LucideIcon } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { GithubIcon } from "@/components/github-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkingTree } from "@/lib/git-queries";
import { cn } from "@/lib/utils";
import { useWorkspaceStore, type View } from "@/stores/workspace-store";
import { useT, type MessageKey } from "@/i18n";

type Tab = { view: View; label: MessageKey; Icon: LucideIcon | ComponentType<SVGProps<SVGSVGElement>> };

const TABS: Tab[] = [
  { view: "history", label: "view.history", Icon: GitPullRequestArrow },
  { view: "github", label: "view.github", Icon: GithubIcon },
  { view: "changes", label: "view.changes", Icon: Layers },
];

/** Compact view switch living in the title bar, next to the window controls. */
export function ViewTabs({ repoPath }: { repoPath: string }) {
  const { view, setView } = useWorkspaceStore();
  const t = useT();
  const changes = useWorkingTree(repoPath).data?.length ?? 0;
  return (
    <div role="tablist" aria-label={t("view.tabs")} className="flex gap-0.5 rounded-lg bg-black/25 p-0.5">
      {TABS.map(({ view: tab, label, Icon }) => (
        <Tooltip key={tab}>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="tab"
              aria-selected={view === tab}
              aria-label={tab === "changes" && changes > 0 ? t("view.changesCount", { count: changes }) : t(label)}
              onClick={() => setView(tab)}
              className={cn(
                "relative grid h-6 w-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-white/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                view === tab && "bg-primary/80 text-primary-foreground hover:bg-primary/90",
              )}
            >
              <Icon aria-hidden className="size-3.5" />
              {tab === "changes" && changes > 0 && (
                <span className="absolute -top-1 -right-1 min-w-3.5 rounded-full bg-primary px-1 font-mono text-[9px] leading-3.5 text-primary-foreground">
                  {changes > 99 ? "99+" : changes}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>{t(label)}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
