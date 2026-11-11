import { useEffect, useRef, useState } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { reasonOf } from "@/features/inbox/inbox-items";
import { useInbox } from "@/features/inbox/use-inbox";
import { useT } from "@/i18n";

const WARM_UP = 30_000;

/** Asked once per launch: macOS shows its own prompt the first time. */
let allowed: Promise<boolean> | null = null;
const permission = () =>
  (allowed ??= isPermissionGranted()
    .then((granted) => granted || requestPermission().then((p) => p === "granted"))
    .catch(() => false));

/**
 * A macOS notification for what lands unread in the inbox while the app is in the background: a GitHub or Linear
 * notification, a check that fails, an agent that finished. What's already there at launch stays quiet.
 */
export function useDesktopNotifications(repoPath: string) {
  const t = useT();
  const items = useInbox(repoPath).items;
  const seen = useRef(new Set<string>());
  const [since] = useState(Date.now);
  useEffect(() => {
    if (!items) return;
    // Once per thing and version: an item rings again only when it changes (a new comment, another run).
    const unread = items.filter((item) => item.unread);
    const ids = unread.map((item) => `${item.key}@${item.version}`);
    const known = seen.current;
    // Sources (GitHub, Linear, agents) arrive one by one at launch: all of that is the starting point.
    if (Date.now() - since < WARM_UP) {
      for (const id of ids) known.add(id);
      return;
    }
    const fresh = unread.filter((_, i) => !known.has(ids[i]));
    for (const id of ids) known.add(id);
    if (fresh.length === 0 || document.hasFocus()) return;
    void permission().then((ok) => {
      if (!ok) return;
      for (const item of fresh.slice(0, 3))
        sendNotification({ title: `${reasonOf(t, item)} · ${item.title}`, body: item.context });
    });
  }, [items, since, t]);
}
