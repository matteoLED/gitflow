import type { MessageKey } from "@/i18n";
import type { RebaseAction, RebaseCommit, RebaseStep } from "@/types/git";

export const REBASE_ACTIONS: RebaseAction[] = ["pick", "reword", "squash", "fixup", "drop"];

export const initialSteps = (commits: RebaseCommit[]): RebaseStep[] =>
  commits.map((c) => ({ hash: c.hash, action: "pick", message: null }));

/** Moves the step at `from` to `to`; out-of-range moves are no-ops. */
export function moveStep(steps: RebaseStep[], from: number, to: number): RebaseStep[] {
  if (from === to || to < 0 || to >= steps.length) return steps;
  const next = [...steps];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export const updateStep = (steps: RebaseStep[], index: number, patch: Partial<RebaseStep>): RebaseStep[] =>
  steps.map((s, i) => (i === index ? { ...s, ...patch } : s));

/** Why the plan can't run, as a message key; null when it can. */
export function stepsError(steps: RebaseStep[]): MessageKey | null {
  const firstKept = steps.find((s) => s.action !== "drop");
  if (!firstKept) return "rebase.errorAllDropped";
  if (firstKept.action === "squash" || firstKept.action === "fixup") return "rebase.errorFirstSquash";
  if (steps.some((s) => s.action === "reword" && !s.message?.trim())) return "rebase.errorEmptyMessage";
  return null;
}

export const isUnchanged = (steps: RebaseStep[], commits: RebaseCommit[]): boolean =>
  steps.every((s, i) => s.action === "pick" && s.hash === commits[i]?.hash);

/** What goes to the backend: a message only on rewords. */
export const toBackend = (steps: RebaseStep[]): RebaseStep[] =>
  steps.map((s) => ({ ...s, message: s.action === "reword" ? s.message : null }));
