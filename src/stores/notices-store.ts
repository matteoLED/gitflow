import { create } from "zustand";

export type Notice = {
  id: number;
  tone: "error" | "success";
  title: string;
  detail?: string | null;
  /** One follow-up, like "Undo"; the notice closes once it runs. */
  action?: { label: string; run: () => void };
};

type NoticesState = {
  notices: Notice[];
  notify: (notice: Omit<Notice, "id">) => void;
  dismiss: (id: number) => void;
};

const SUCCESS_TTL_MS = 4000;
/** Long enough to reach for "Undo". */
const ACTION_TTL_MS = 10_000;
let nextId = 1;

/** Operation feedback. Errors stay until dismissed so their Git output can be read. */
export const useNoticesStore = create<NoticesState>()((set, get) => ({
  notices: [],
  notify: (notice) => {
    const id = nextId++;
    set({ notices: [...get().notices, { ...notice, id }].slice(-4) });
    if (notice.tone === "success") setTimeout(() => get().dismiss(id), notice.action ? ACTION_TTL_MS : SUCCESS_TTL_MS);
  },
  dismiss: (id) => set({ notices: get().notices.filter((n) => n.id !== id) }),
}));
