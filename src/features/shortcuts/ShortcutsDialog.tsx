import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useT, type MessageKey } from "@/i18n";
import { useUiStore } from "@/stores/ui-store";

type Shortcut = { keys: string[]; label: MessageKey };
type Section = { title: MessageKey; items: Shortcut[] };

/** Every shortcut the app answers to, grouped where it works. Keep in sync with the listeners. */
const SECTIONS: Section[] = [
  {
    title: "shortcuts.general",
    items: [
      { keys: ["⌘", "K"], label: "shortcuts.palette" },
      { keys: ["⌘", "/"], label: "shortcuts.help" },
      { keys: ["⌘", "P"], label: "shortcuts.switchRepo" },
      { keys: ["⌘", "1…9"], label: "shortcuts.repoN" },
      { keys: ["⌘", "O"], label: "shortcuts.openRepo" },
      { keys: ["⌘", "I"], label: "shortcuts.assistant" },
      { keys: ["⌃", "`"], label: "shortcuts.terminal" },
      { keys: ["⌘", "⇧", "P"], label: "shortcuts.preview" },
      { keys: ["⌘", "⇧", "L"], label: "shortcuts.linear" },
      { keys: ["⌘", ","], label: "shortcuts.settings" },
      { keys: ["⌘", "Z"], label: "shortcuts.undo" },
    ],
  },
  {
    title: "shortcuts.editor",
    items: [
      { keys: ["⌘", "P"], label: "shortcuts.openFile" },
      { keys: ["⌘", "S"], label: "shortcuts.save" },
      { keys: ["⌘", "W"], label: "shortcuts.closeTab" },
      { keys: ["⌘", "F"], label: "shortcuts.find" },
      { keys: ["⌘", "⇧", "F"], label: "shortcuts.searchProject" },
      { keys: ["⌘", "⇧", "E"], label: "shortcuts.files" },
      { keys: ["⌘", "G"], label: "shortcuts.gotoLine" },
      { keys: ["⌘", "D"], label: "shortcuts.nextOccurrence" },
      { keys: ["⌥", "clic"], label: "shortcuts.multiCursor" },
      { keys: ["⌘", "clic"], label: "shortcuts.definition" },
      { keys: ["F12"], label: "shortcuts.definition" },
      { keys: ["⇧", "F12"], label: "shortcuts.references" },
      { keys: ["F2"], label: "shortcuts.rename" },
      { keys: ["⌘", "L"], label: "shortcuts.askAgent" },
      { keys: ["⌥", "⌘", "B"], label: "shortcuts.blame" },
    ],
  },
  {
    title: "shortcuts.review",
    items: [
      { keys: ["⌘", "B"], label: "shortcuts.diffLayout" },
      { keys: ["⌥", "E"], label: "shortcuts.expandFile" },
      { keys: ["⌘", "⇧", "."], label: "shortcuts.copyBranch" },
      { keys: ["⌘", "⇧", ","], label: "shortcuts.copyPrUrl" },
      { keys: ["⌘", "↵"], label: "shortcuts.submit" },
      { keys: ["C"], label: "shortcuts.newIssue" },
    ],
  },
  {
    title: "shortcuts.agents",
    items: [
      { keys: ["/"], label: "shortcuts.slashCommands" },
      { keys: ["↵"], label: "shortcuts.send" },
      { keys: ["⇧", "↵"], label: "shortcuts.newLine" },
      { keys: ["esc"], label: "shortcuts.stop" },
    ],
  },
  {
    title: "shortcuts.browser",
    items: [
      { keys: ["⌘", "T"], label: "shortcuts.newBrowserTab" },
      { keys: ["⌘", "L"], label: "shortcuts.address" },
      { keys: ["⌘", "R"], label: "shortcuts.reload" },
      { keys: ["⌘", "["], label: "shortcuts.back" },
    ],
  },
];

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((key) => (
        <kbd
          key={key}
          className="grid h-5 min-w-5 place-items-center rounded border border-white/10 bg-white/[0.05] px-1 font-sans text-[11px] text-foreground/85"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

/** ⌘/: the shortcuts, so they can be found without reading the code. */
export function ShortcutsDialog() {
  const t = useT();
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  useEffect(() => {
    const toggle = () => setOpen(!useUiStore.getState().shortcutsOpen);
    // In the app, ⌘/ is the Help menu's item: macOS matches it on any keyboard layout (⇧: on AZERTY).
    if (isTauri()) {
      const unlisten = listen<string>("menu", ({ payload }) => payload === "shortcuts" && toggle());
      return () => void unlisten.then((stop) => stop());
    }
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.key !== "/") return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="max-h-[85vh] gap-0 overflow-hidden rounded-xl border-white/10 p-0 sm:max-w-[760px]"
      >
        <DialogTitle className="border-b border-white/[0.07] px-5 py-3.5 text-[14px]">
          {t("shortcuts.title")}
        </DialogTitle>
        <div className="grid max-h-[calc(85vh-52px)] grid-cols-2 gap-x-8 gap-y-5 overflow-y-auto px-5 py-4">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h3 className="mb-1.5 text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">
                {t(section.title)}
              </h3>
              <ul>
                {section.items.map((item) => (
                  <li
                    key={`${item.label}:${item.keys.join("")}`}
                    className="flex h-7 items-center justify-between gap-3 text-[12.5px]"
                  >
                    <span className="truncate">{t(item.label)}</span>
                    <Keys keys={item.keys} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
