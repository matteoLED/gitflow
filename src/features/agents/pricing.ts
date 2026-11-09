import type { Tokens } from "@/types/git";

/** $ per million tokens: input, output and, when it isn't the usual 0.1×, cache reads. */
type Price = { input: number; output: number; cacheRead?: number };

// First match wins, so specific ids come before their family. Anthropic API list prices (2026-10).
const PRICES: [RegExp, Price][] = [
  [/(fable|mythos)-5-1/, { input: 10, output: 50, cacheRead: 0.25 }],
  [/(fable|mythos)-5/, { input: 10, output: 50, cacheRead: 1 }],
  [/opus-5-5/, { input: 4, output: 20, cacheRead: 0.2 }],
  [/opus-5/, { input: 5, output: 25 }],
  [/opus-4-[5-9]/, { input: 5, output: 25 }],
  [/opus-4|opus-3/, { input: 15, output: 75 }],
  [/sonnet-5/, { input: 2, output: 10, cacheRead: 0.2 }],
  [/sonnet-[34]/, { input: 3, output: 15 }],
  // ponytail: Haiku 5.5's 100K+ prompt tier ($0.50/$2.50) ignored, so long prompts are under-counted.
  [/haiku-5/, { input: 0.1, output: 0.5 }],
  [/haiku-4/, { input: 1, output: 5 }],
  [/haiku-3-5/, { input: 0.8, output: 4 }],
];

const priceOf = (model: string) => PRICES.find(([re]) => re.test(model))?.[1] ?? null;

/** What these tokens would cost at API prices; null for a model we have no price for. */
export function costOf(model: string, t: Tokens): number | null {
  const p = priceOf(model);
  if (!p) return null;
  const read = p.cacheRead ?? p.input * 0.1;
  const dollars =
    t.input * p.input +
    t.output * p.output +
    t.cacheWrite5m * p.input * 1.25 +
    t.cacheWrite1h * p.input * 2 +
    t.cacheRead * read;
  return dollars / 1_000_000;
}

/** Context window of a model: 1M from the 4.6 generation on, 200K before. */
export function contextWindowOf(model: string | null): number | null {
  if (!model) return null;
  return /claude-3|haiku-4|(opus|sonnet)-4-[0-5]\b|(opus|sonnet)-4-\d{8}|(opus|sonnet)-4$/.test(model)
    ? 200_000
    : 1_000_000;
}

export const totalTokens = (t: Tokens) => t.input + t.output + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead;
