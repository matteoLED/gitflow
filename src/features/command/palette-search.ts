/** What ⌘K searches: everything, or one kind picked by a leading `>` `#` `@` or `!`. */
export type PaletteScope = "all" | "actions" | "prs" | "files" | "issues";

const PREFIXES: Partial<Record<string, PaletteScope>> = { ">": "actions", "#": "prs", "@": "files", "!": "issues" };

export function parsePaletteQuery(raw: string): { scope: PaletteScope; term: string } {
  const text = raw.trim();
  const scope = PREFIXES[text.charAt(0)];
  return scope ? { scope, term: text.slice(1).trim() } : { scope: "all", term: text };
}

/** Rows per group: a few when everything is searched, more once a prefix narrows it to one kind. */
export const groupLimit = (scope: PaletteScope) => (scope === "all" ? 5 : 20);

/**
 * Items whose text holds every word of `term` (any case), best first: text starting with the term, then a word
 * starting with its first word, then any match; ties keep the given order. An empty term keeps the first ones.
 */
export function rankByText<T>(term: string, items: readonly T[], text: (item: T) => string, limit: number): T[] {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items.slice(0, limit);
  const phrase = words.join(" ");
  const ranked: { item: T; rank: number }[] = [];
  for (const item of items) {
    const haystack = text(item).toLowerCase();
    if (!words.every((w) => haystack.includes(w))) continue;
    const at = haystack.indexOf(words[0]);
    const wordStart = at === 0 || /[\s/#\-_.:([]/.test(haystack.charAt(at - 1));
    ranked.push({ item, rank: haystack.startsWith(phrase) ? 0 : wordStart ? 1 : 2 });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((r) => r.item);
}

/** `first` then the items of `second` not already in it (by key), at most `limit`. */
export function mergeUnique<T>(
  first: readonly T[],
  second: readonly T[],
  key: (item: T) => string,
  limit: number,
): T[] {
  const seen = new Set(first.map(key));
  return [...first, ...second.filter((item) => !seen.has(key(item)))].slice(0, limit);
}
