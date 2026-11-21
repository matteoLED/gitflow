import { Focus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layout-store";

/** Enters or leaves focus mode (⌘\): only the list and the diff stay on screen. */
export function FocusButton() {
  const t = useT();
  const focus = useLayoutStore((s) => s.focus);
  const toggle = useLayoutStore((s) => s.toggleFocus);
  const label = focus ? t("focus.leave") : t("focus.enter");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={focus}
          onClick={toggle}
          className={cn("rounded-full text-muted-foreground", focus && "bg-primary/15 text-primary")}
        >
          <Focus />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label} <kbd className="ml-1 text-muted-foreground">⌘\</kbd>
      </TooltipContent>
    </Tooltip>
  );
}
