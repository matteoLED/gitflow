import type { ComponentProps, ReactNode } from "react";
import { ListFilter, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

/*
 * Shared vertical grid, matching the reference: every panel header is centered on the window-controls line
 * (y = 29, see trafficLightPosition in tauri.conf.json), every toolbar row (Pull/Push, filters) sits on the
 * line below, and lists start together underneath.
 */

/** Top bar of a panel. Doubles as the window drag region since the title bar is hidden. */
export function PanelHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      data-tauri-drag-region
      className={cn("flex h-[58px] shrink-0 items-center gap-2 px-3", className)}
      {...props}
    />
  );
}

/** Second row of a panel (filters, sync buttons): same height and position in every column. */
export function PanelToolbar({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex h-[22px] shrink-0 items-center gap-1.5 px-3", className)} {...props} />;
}

export function PanelMessage({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div role="status" className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      {icon && <div className="text-muted-foreground [&_svg]:size-5">{icon}</div>}
      <p className="text-sm text-foreground">{title}</p>
      {hint && <p className="max-w-56 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

type FilterInputProps = Omit<ComponentProps<"input">, "onChange"> & {
  /** Accessible name; the visible placeholder can be shorter. */
  label: string;
  icon?: "filter" | "search";
  onValueChange: (value: string) => void;
};

export function FilterInput({
  label,
  icon = "filter",
  placeholder,
  onValueChange,
  className,
  ...props
}: FilterInputProps) {
  const t = useT();
  const Icon = icon === "filter" ? ListFilter : Search;
  return (
    <div className={cn("relative", className)}>
      <Icon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder ?? t("common.filter")}
        onChange={(event) => onValueChange(event.target.value)}
        className="h-[22px] rounded-md border-white/[0.09] bg-transparent pl-7 text-[11px] shadow-none placeholder:text-muted-foreground/70 md:text-[11px] dark:bg-transparent"
        {...props}
      />
    </div>
  );
}
