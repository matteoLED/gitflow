import { useId } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useViewSettings } from "@/stores/view-settings-store";
import { useT } from "@/i18n";

function Toggle({ setting, label, hint }: { setting: "firstParentOnly" | "hideMerges"; label: string; hint: string }) {
  const id = useId();
  const checked = useViewSettings((s) => s[setting]);
  const set = useViewSettings((s) => s.set);
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <label htmlFor={id} className="text-[12.5px] text-foreground/85">
        {label}
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      </label>
      <Switch
        id={id}
        className="origin-right scale-[0.85]"
        checked={checked}
        onCheckedChange={(value) => set(setting, value)}
      />
    </div>
  );
}

/** History filters, applied by git (`--first-parent`, `--no-merges`) so pagination stays exact. */
export function HistoryOptions() {
  const t = useT();
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("history.options")}
              className="ml-auto rounded-full text-muted-foreground"
            >
              <Settings2 />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("history.options")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-64 px-3 py-1">
        <Toggle setting="firstParentOnly" label={t("history.firstParent")} hint={t("history.firstParentHint")} />
        <Toggle setting="hideMerges" label={t("history.hideMerges")} hint={t("history.hideMergesHint")} />
      </PopoverContent>
    </Popover>
  );
}
