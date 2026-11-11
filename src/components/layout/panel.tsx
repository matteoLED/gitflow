import type { ComponentProps } from "react";
import { ListFilter, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { BrailleLoader, type BrailleVariant } from "@/components/braille-loader";
import { useT } from "@/i18n";

/*
 * Shared vertical grid: the sidebar header is 58px, centered on the window controls (y = 29, see
 * trafficLightPosition in tauri.conf.json); views sit in an inset 6px lower, so their 46px headers share that line.
 */

/** Top bar of a panel. Doubles as the window drag region since the title bar is hidden. */
export function PanelHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      data-tauri-drag-region
      className={cn("flex h-[46px] shrink-0 items-center gap-2 border-b border-white/[0.06] px-3", className)}
      {...props}
    />
  );
}

/** Second row of a panel (filters, sync buttons): same height and position in every column. */
export function PanelToolbar({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex h-7 shrink-0 items-center gap-1.5 px-3", className)} {...props} />;
}

/** Full-panel loading state: animated dot grid above the message. */
export function PanelLoading({ title, variant = "grid" }: { title: string; variant?: BrailleVariant }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
      <BrailleLoader variant={variant} dotSize={2.5} dotGap={1.5} label={title} className="text-primary" />
      <p aria-hidden className="text-[12px]">
        {title}
      </p>
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
        className="h-7 rounded-md border-white/[0.09] bg-transparent pl-7 text-[12px] shadow-none placeholder:text-muted-foreground md:text-[12px] dark:bg-transparent"
        {...props}
      />
    </div>
  );
}
