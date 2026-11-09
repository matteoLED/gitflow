import { useShallow } from "zustand/react/shallow";
import { useEffect, useId, type ReactNode } from "react";
import { Columns2, Rows2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { useViewSettings, type DiffLayout, type ViewSettings } from "@/stores/view-settings-store";

type BooleanSetting = { [K in keyof ViewSettings]: ViewSettings[K] extends boolean ? K : never }[keyof ViewSettings];

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-white/15 px-1 font-sans text-[11px] text-muted-foreground">{children}</kbd>
  );
}

const LAYOUTS: { layout: DiffLayout; label: MessageKey; tooltip: MessageKey; Icon: typeof Columns2 }[] = [
  { layout: "split", label: "options.split", tooltip: "options.splitView", Icon: Columns2 },
  { layout: "unified", label: "options.unified", tooltip: "options.unifiedView", Icon: Rows2 },
];

/** Segmented Split / Unified control, shared by the popover and the Settings page. */
export function LayoutSwitch() {
  const t = useT();
  const { layout: current, set } = useViewSettings(useShallow((s) => ({ layout: s.layout, set: s.set })));
  return (
    <div
      role="radiogroup"
      aria-label={t("options.layout")}
      className="grid grid-cols-2 gap-0.5 rounded-lg bg-black/30 p-0.5"
    >
      {LAYOUTS.map(({ layout, label, tooltip, Icon }) => (
        <Tooltip key={layout}>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="radio"
              aria-checked={current === layout}
              onClick={() => set("layout", layout)}
              className={cn(
                "flex h-7 items-center justify-center gap-1.5 rounded-md text-[12.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                current === layout && "bg-white/10 text-foreground shadow-sm",
              )}
            >
              <Icon aria-hidden className="size-3.5" />
              {t(label)}
            </button>
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-1.5">
            {t(tooltip)} <Kbd>⌘</Kbd>
            <Kbd>B</Kbd>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

type ToggleProps = { setting: BooleanSetting; label: string; hint?: string; disabled?: boolean };

function Toggle({ setting, label, hint, disabled }: ToggleProps) {
  const id = useId();
  const checked = useViewSettings((s) => s[setting]);
  const set = useViewSettings((s) => s.set);
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 py-1">
      <label htmlFor={id} className={cn("text-[12.5px] leading-tight text-foreground/90", disabled && "opacity-50")}>
        {label}
        {hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
      </label>
      <Switch
        id={id}
        className="origin-right scale-[0.8]"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => set(setting, value)}
      />
    </div>
  );
}

type Choice<V extends string> = { value: V; label: string };
type ChooseProps<K extends "fileList" | "grouping"> = { setting: K; label: string; choices: Choice<ViewSettings[K]>[] };

function Choose<K extends "fileList" | "grouping">({ setting, label, choices }: ChooseProps<K>) {
  const id = useId();
  const value = useViewSettings((s) => s[setting]);
  const set = useViewSettings((s) => s.set);
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 py-1">
      <label htmlFor={id} className="text-[12.5px] text-foreground/90">
        {label}
      </label>
      <Select value={value} onValueChange={(next) => set(setting, next as ViewSettings[K])}>
        <SelectTrigger
          id={id}
          size="sm"
          className="h-6 w-[7.5rem] border-0 bg-white/[0.06] px-2 text-[12px] shadow-none hover:bg-white/[0.14] data-[size=sm]:h-6 dark:bg-white/[0.06]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value} className="text-[12.5px]">
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-white/[0.07] px-3 pt-2 pb-1.5">
      <p className="pb-0.5 text-[10.5px] font-medium tracking-wider text-muted-foreground uppercase">{title}</p>
      {children}
    </div>
  );
}

/** Every diff/file-list option, so the popover and the Settings page stay identical. */
function DiffOptionRows() {
  const t = useT();
  const split = useViewSettings((s) => s.layout === "split");
  return (
    <>
      <Section title={t("options.display")}>
        <Toggle setting="syntaxHighlighting" label={t("options.syntax")} />
        <Toggle
          setting="wrapLines"
          label={t("options.wrap")}
          disabled={split}
          hint={split ? t("options.wrapSplit") : undefined}
        />
        <Toggle setting="showLineCounts" label={t("options.lineCounts")} />
      </Section>
      <Section title={t("settings.files")}>
        <Choose
          setting="fileList"
          label={t("options.fileList")}
          choices={[
            { value: "tree", label: t("options.tree") },
            { value: "list", label: t("options.list") },
          ]}
        />
        <Choose
          setting="grouping"
          label={t("options.grouping")}
          choices={[
            { value: "none", label: t("options.noGrouping") },
            { value: "status", label: t("options.byStatus") },
          ]}
        />
        <Toggle setting="hideGenerated" label={t("options.hideGenerated")} hint={t("options.hideGeneratedHint")} />
      </Section>
    </>
  );
}

/** ⌘B flips between split and unified, except while typing. */
function useLayoutShortcut() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable]");
      if (!(event.metaKey && event.key.toLowerCase() === "b") || typing) return;
      event.preventDefault();
      const { layout, set } = useViewSettings.getState();
      set("layout", layout === "split" ? "unified" : "split");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

export function ViewOptions() {
  useLayoutShortcut();
  const t = useT();
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("options.title")}
              className="rounded-full text-muted-foreground data-[state=open]:bg-white/10 data-[state=open]:text-foreground"
            >
              <Settings2 />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("options.title")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" sideOffset={6} className="w-[272px] overflow-hidden rounded-xl p-0 shadow-xl">
        <div className="p-2.5">
          <LayoutSwitch />
        </div>
        <DiffOptionRows />
      </PopoverContent>
    </Popover>
  );
}
