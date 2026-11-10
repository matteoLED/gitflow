import { useEffect, useRef, useState } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useInbox } from "@/features/work/use-work-items";
import { useT } from "@/i18n";

const WARM_UP = 30_000;

/** Asked once per launch: macOS shows its own prompt the first time. */
let allowed: Promise<boolean> | null = null;
const permission = () =>
  (allowed ??= isPermissionGranted()
    .then((granted) => granted || requestPermission().then((p) => p === "granted"))
    .catch(() => false));

/**
 * A macOS notification for what lands in the inbox while the app is in the background: a check that fails,
 * a review asked or answered, an agent that finished. What's already there at launch stays quiet.
 */
export function useDesktopNotifications(repoPath: string) {
  const t = useT();
  const items = useInbox(repoPath);
  const seen = useRef(new Set<string>());
  const [since] = useState(Date.now);
  useEffect(() => {
    if (!items) return;
    const ids = items.map((item) => `${item.key}@${item.version}`);
    const known = seen.current;
    // Sources (GitHub, Linear, agents) arrive one by one at launch: all of that is the starting point.
    if (Date.now() - since < WARM_UP) {
      for (const id of ids) known.add(id);
      return;
    }
    const fresh = items.filter((_, i) => !known.has(ids[i]));
    for (const id of ids) known.add(id);
    if (fresh.length === 0 || document.hasFocus()) return;
    void permission().then((ok) => {
      if (!ok) return;
      for (const item of fresh.slice(0, 3))
        sendNotification({ title: `${t(`inbox.${item.reason}`)} · ${item.title}`, body: item.detail });
    });
  }, [items, since, t]);
}
