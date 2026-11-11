import { Sparkles } from "lucide-react";
import { useT } from "@/i18n";
import { useUiStore } from "@/stores/ui-store";

/** Opens or closes the assistant beside the page (⌘I), from a page header. */
export function AssistantToggle() {
  const t = useT();
  const open = useUiStore((s) => s.assistantOpen);
  return (
    <button
      type="button"
      aria-label={t("assistant.toggle")}
      title={`${t("assistant.toggle")} ⌘I`}
      aria-pressed={open}
      onClick={() => useUiStore.getState().setAssistantOpen(!open)}
      className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary/20 aria-pressed:text-primary"
    >
      <Sparkles aria-hidden className="size-3.5" />
    </button>
  );
}
