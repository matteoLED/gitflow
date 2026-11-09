import { lazy, Suspense, useEffect } from "react";
import { useUiStore } from "@/stores/ui-store";

// Settings code loads the first time they are opened, not at startup.
const SettingsView = lazy(() => import("./SettingsView"));

/** ⌘, toggles settings; Esc leaves them unless a menu or select inside is handling it. */
function useSettingsShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { settingsOpen, setSettingsOpen } = useUiStore.getState();
      if (event.metaKey && event.key === ",") setSettingsOpen(!settingsOpen);
      else if (event.key === "Escape" && settingsOpen && !document.querySelector("[data-radix-popper-content-wrapper]"))
        setSettingsOpen(false);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** Full-window settings over the app, which stays mounted underneath so nothing is lost on return. */
export function SettingsPage() {
  useSettingsShortcuts();
  const open = useUiStore((s) => s.settingsOpen);
  return open ? (
    <Suspense fallback={null}>
      <SettingsView />
    </Suspense>
  ) : null;
}
