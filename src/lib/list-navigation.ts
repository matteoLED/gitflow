const STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

/** Index to move to for an arrow key in a list, or null if the key isn't a navigation key. */
export function nextListIndex(key: string, current: number, length: number): number | null {
  const step = STEPS[key];
  if (step === undefined || length === 0) return null;
  if (current < 0) return 0;
  return Math.min(Math.max(current + step, 0), length - 1);
}
