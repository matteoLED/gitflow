import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { InboxItem, InboxMark, InboxSource } from "@/features/inbox/inbox-items";

const MAX_MARKS = 500;

type InboxState = {
  /** Read/unread/done choices per item key, valid while the item's version stays the same. */
  marks: Record<string, InboxMark>;
  /** Key of the item shown on the right. */
  selected: string | null;
  unreadOnly: boolean;
  source: InboxSource | null;
  mark: (item: InboxItem, state: InboxMark["state"]) => void;
  unmark: (key: string) => void;
  select: (key: string | null) => void;
  setUnreadOnly: (unreadOnly: boolean) => void;
  setSource: (source: InboxSource | null) => void;
};

export const useInboxStore = create<InboxState>()(
  persist(
    (set) => ({
      marks: {},
      selected: null,
      unreadOnly: false,
      source: null,
      // ponytail: oldest marks drop past 500; they only matter for items still in a source's last page.
      mark: (item, state) =>
        set(({ marks }) => {
          const rest = Object.entries(marks).filter(([key]) => key !== item.key);
          return {
            marks: Object.fromEntries([...rest.slice(-(MAX_MARKS - 1)), [item.key, { version: item.version, state }]]),
          };
        }),
      unmark: (key) =>
        set(({ marks }) => ({ marks: Object.fromEntries(Object.entries(marks).filter(([k]) => k !== key)) })),
      select: (selected) => set({ selected }),
      setUnreadOnly: (unreadOnly) => set({ unreadOnly }),
      setSource: (source) => set({ source }),
    }),
    {
      name: "gitflow.inbox",
      partialize: ({ marks, unreadOnly, source }) => ({ marks, unreadOnly, source }),
    },
  ),
);
