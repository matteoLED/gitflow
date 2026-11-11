import { createContext, useContext, useState, type ReactNode } from "react";
import { PanelLeftClose } from "lucide-react";
import { FilterInput, PanelHeader } from "@/components/layout/panel";
import { useT } from "@/i18n";

/** Set by the page frame: folds the list column away. */
export const ListCollapseContext = createContext<(() => void) | null>(null);

/**
 * First column of a page (pull requests, issues, runs, branches…), like Linear's list next to the item:
 * a title, an optional filter, then the list.
 */
export function ListPanel({
  title,
  actions,
  filterLabel,
  onCollapse,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  /** Shows a filter field when set. */
  filterLabel?: string;
  /** Folds the column away to give the page its room. */
  onCollapse?: () => void;
  /** Gets the filter query, and a way to clear it (an empty state's "Clear filter"). */
  children: (query: string, clearQuery: () => void) => ReactNode;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const collapse = useContext(ListCollapseContext) ?? onCollapse;
  return (
    <section className="flex h-full flex-col bg-white/[0.012]">
      <PanelHeader className="gap-1">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</h2>
        {actions}
        {collapse && (
          <button
            type="button"
            aria-label={t("layout.hideList")}
            title={t("layout.hideList")}
            onClick={collapse}
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-white/[0.07] hover:text-foreground"
          >
            <PanelLeftClose aria-hidden className="size-3.5" />
          </button>
        )}
      </PanelHeader>
      {filterLabel && (
        <FilterInput label={filterLabel} value={query} onValueChange={setQuery} className="mx-2 mt-2 mb-1" />
      )}
      <div className="flex min-h-0 flex-1 flex-col">{children(query, () => setQuery(""))}</div>
    </section>
  );
}
