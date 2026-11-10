import type { CommitGroup } from "@/types/git";

const MAX_GROUPS = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads an agent's commit plan: a JSON array of `{ message, files }` (a surrounding code fence is tolerated).
 * Throws when it isn't exactly that, or names a file outside `changed` or the same file twice.
 */
export function parseCommitPlan(text: string, changed: ReadonlySet<string>): CommitGroup[] {
  const json = text
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_GROUPS) {
    throw new Error(`expected an array of 1 to ${MAX_GROUPS} commits`);
  }
  const seen = new Set<string>();
  return value.map((group): CommitGroup => {
    if (!isRecord(group) || typeof group.message !== "string" || !group.message.trim()) {
      throw new Error("every commit needs a message");
    }
    const files = group.files;
    if (!Array.isArray(files) || files.length === 0 || !files.every((f) => typeof f === "string")) {
      throw new Error("every commit needs a list of files");
    }
    for (const file of files) {
      if (!changed.has(file)) throw new Error(`“${file}” isn't a pending change`);
      if (seen.has(file)) throw new Error(`“${file}” is in two commits`);
      seen.add(file);
    }
    return { message: group.message.trim(), files };
  });
}
