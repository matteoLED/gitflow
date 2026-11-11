import { useShallow } from "zustand/react/shallow";
import { Brush, CircleUser, GitPullRequest, Layers, type LucideIcon } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useWorkStore, type WorkFilter } from "@/stores/work-store";
import { filterWork, useWorkItems } from "./use-work-items";

const FILTERS: [WorkFilter, LucideIcon][] = [
  ["all", Layers],
  ["mine", CircleUser],
  ["pulls", GitPullRequest],
  ["cleanup", Brush],
];

/** The Work page's views, Linear-style, each with its count. */
export function WorkList({ repoPath }: { repoPath: string }) {
  const t = useT();
  const { filter, setFilter } = useWorkStore(useShallow((s) => ({ filter: s.filter, setFilter: s.setFilter })));
  const items = useWorkItems(repoPath).data;
  return (
    <nav aria-label={t("view.work")} className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-2">
      <ul className="space-y-px">
        {FILTERS.map(([value, Icon]) => (
          <li key={value}>
            <button
              type="button"
              aria-current={filter === value ? "page" : undefined}
              onClick={() => setFilter(value)}
              className={cn(
                "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-sidebar-foreground outline-none hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                filter === value && "bg-white/[0.08] text-foreground",
              )}
            >
              <Icon aria-hidden className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{t(`work.filter.${value}`)}</span>
              {items && (
                <span className="text-[11.5px] text-muted-foreground tabular-nums">
                  {filterWork(items, value).length}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
