/// <reference lib="webworker" />
import { highlightDiff, type SyntaxThemeName } from "./syntax";
import type { DiffLine } from "@/types/git";

export type HighlightRequest = { id: number; path: string; lines: DiffLine[]; theme: SyntaxThemeName };
export type SlimToken = { content: string; color?: string };
export type HighlightResponse = { id: number; tokens: (SlimToken[] | null)[] | null };

// Shiki runs here, off the main thread: tokenizing a large diff never blocks scrolling or typing.
async function tokenize({ path, lines, theme }: HighlightRequest): Promise<HighlightResponse["tokens"]> {
  try {
    const full = await highlightDiff(path, lines, theme);
    // Only what the UI draws crosses back: smaller messages, faster structured cloning.
    return full?.map((line) => line?.map((t) => ({ content: t.content, color: t.color })) ?? null) ?? null;
  } catch {
    return null; // highlighting is cosmetic
  }
}

self.onmessage = async ({ data }: MessageEvent<HighlightRequest>) => {
  self.postMessage({ id: data.id, tokens: await tokenize(data) } satisfies HighlightResponse);
};
