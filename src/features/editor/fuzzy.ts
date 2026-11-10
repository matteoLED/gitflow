/**
 * Zed/VS Code-style fuzzy score of a path for a query: every query character must appear in order. Matches in
 * the file name, at word starts and in runs score higher; shorter paths win ties. Null when it doesn't match.
 */
export function fuzzyScore(query: string, path: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const p = path.toLowerCase();
  const nameStart = path.lastIndexOf("/") + 1;
  let score = 0;
  let at = 0;
  let previous = -2;
  for (const char of q) {
    const found = p.indexOf(char, at);
    if (found === -1) return null;
    const boundary =
      found === 0 || "/-_. ".includes(p[found - 1]) || (path[found] !== p[found] && path[found - 1] === p[found - 1]);
    score += 1 + (found === previous + 1 ? 5 : 0) + (boundary ? 4 : 0) + (found >= nameStart ? 3 : 0);
    previous = found;
    at = found + 1;
  }
  return score - path.length * 0.01;
}

/** The `limit` best matches, best first. */
export function fuzzyFilter(query: string, paths: readonly string[], limit = 50): string[] {
  const scored: { path: string; score: number }[] = [];
  for (const path of paths) {
    const score = fuzzyScore(query, path);
    if (score !== null) scored.push({ path, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.path);
}
