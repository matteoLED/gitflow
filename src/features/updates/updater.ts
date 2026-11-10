import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { getT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { useNoticesStore } from "@/stores/notices-store";

const EVERY = 6 * 3_600_000;
const inApp = () => "__TAURI_INTERNALS__" in window && !import.meta.env.DEV;

/**
 * Looks for a signed release on GitHub; when there's one, a notice offers to install it and restart.
 * `manual` (from the command palette) also says when the app is up to date, and why a check failed.
 */
export async function checkForUpdate(manual = false) {
  if (!inApp()) return;
  const t = getT();
  const { notify } = useNoticesStore.getState();
  try {
    const update = await check();
    if (!update) {
      if (manual) notify({ tone: "success", title: t("update.upToDate") });
      return;
    }
    notify({
      tone: "success",
      title: t("update.available", { version: update.version }),
      detail: update.body ?? null,
      action: {
        label: t("update.install"),
        run: () =>
          void update
            .downloadAndInstall()
            .then(relaunch)
            .catch((error) => notify({ tone: "error", title: t("update.failed"), detail: toGitError(error).message })),
      },
    });
  } catch (error) {
    if (manual) notify({ tone: "error", title: t("update.failed"), detail: toGitError(error).message });
  }
}

/** At launch, then every few hours. */
export function watchForUpdates() {
  void checkForUpdate();
  const timer = setInterval(() => void checkForUpdate(), EVERY);
  return () => clearInterval(timer);
}
