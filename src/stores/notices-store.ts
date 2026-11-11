import { create } from "zustand";

export type NoticeTone = "error" | "success" | "info" | "loading";

export type Notice = {
  id: number;
  tone: NoticeTone;
  title: string;
  detail?: string | null;
  /** One follow-up, like "Undo"; the notice closes once it runs. */
  action?: { label: string; run: () => void };
};

export type NoticeInput = Omit<Notice, "id">;

type NoticesState = {
  notices: Notice[];
  /** Shows a notice; the id lets a "loading" one be turned into its outcome with `update`. */
  notify: (notice: NoticeInput) => number;
  update: (id: number, patch: Partial<NoticeInput>) => void;
  dismiss: (id: number) => void;
};

const MAX_NOTICES = 5;
const SUCCESS_TTL_MS = 4000;
/** Long enough to reach for "Undo". */
const ACTION_TTL_MS = 10_000;
let nextId = 1;

/** How long a notice stays on its own; null until dismissed (errors keep their Git output readable, loading waits). */
export function noticeTtl(notice: Pick<Notice, "tone" | "action">): number | null {
  if (notice.tone === "error" || notice.tone === "loading") return null;
  return notice.action ? ACTION_TTL_MS : SUCCESS_TTL_MS;
}

/** Operation feedback, shown by Notices.tsx, which also runs the auto-dismiss (paused while hovered). */
export const useNoticesStore = create<NoticesState>()((set, get) => ({
  notices: [],
  notify: (notice) => {
    const id = nextId++;
    set({ notices: [...get().notices, { ...notice, id }].slice(-MAX_NOTICES) });
    return id;
  },
  update: (id, patch) => set({ notices: get().notices.map((n) => (n.id === id ? { ...n, ...patch } : n)) }),
  dismiss: (id) => set({ notices: get().notices.filter((n) => n.id !== id) }),
}));
