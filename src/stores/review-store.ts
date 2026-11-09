import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Key of a file at one version of a pull request: a new push makes every file unreviewed again. */
export const reviewKey = (pr: number, head: string, path: string) => `${pr}@${head}:${path}`;

type ReviewState = {
  reviewed: Record<string, true>;
  toggleReviewed: (key: string) => boolean;
};

/** Files marked as reviewed, remembered across launches like on GitHub and Linear. */
export const useReviewStore = create<ReviewState>()(
  persist(
    (set, get) => ({
      reviewed: {},
      toggleReviewed: (key) => {
        const { [key]: was, ...rest } = get().reviewed;
        set({ reviewed: was ? rest : { ...rest, [key]: true } });
        return !was;
      },
    }),
    { name: "gitflow.reviewed" },
  ),
);
