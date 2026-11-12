/** Pure helpers of inline completion (ghost text): when to ask, what to send, what to show. */
import type { Text } from "@codemirror/state";

/** Where a suggestion is wanted: the file, its text, and the cursor. */
export type SuggestionRequest = {
  path: string;
  uri: string;
  languageId: string;
  languageName: string;
  doc: Text;
  pos: number;
  tabSize: number;
};

/** Ghost text to show at the cursor; accepting it replaces the document up to `to` (at or after the cursor). */
export type Suggestion = { text: string; to: number; accepted?: () => void };

/**
 * Asks at a line end, or before nothing but whitespace and what auto-closing leaves after the cursor: closing
 * brackets and quotes, a `;`, `,` or `>` (typing inside `"…"` or `foo(…);` is the common case).
 */
export const canTrigger = (afterCursor: string) => /^[\s)\]}"'`;,>]*$/.test(afterCursor);

const BEFORE = 6000;
const AFTER = 2000;

/** The user message of a model provider: the file around the cursor, with `<CURSOR>` where text goes. */
export function buildPrompt(path: string, language: string, before: string, after: string) {
  return `File: ${path}\nLanguage: ${language}\n\n${before.slice(-BEFORE)}<CURSOR>${after.slice(0, AFTER)}`;
}

/** The window of text the prompt needs, so a huge file is never turned into one string. */
export const promptWindow = (cursor: number) => ({ from: Math.max(0, cursor - BEFORE), to: cursor + AFTER });

const stripFences = (text: string) => {
  const fenced = /^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(text);
  return fenced ? fenced[1] : text;
};

/**
 * A model's answer as text to insert: no fences, no echo of the current line's start (`linePrefix`) nor of
 * the first line after the cursor (`after`). Empty when nothing useful is left.
 */
export function cleanAnswer(answer: string, linePrefix: string, after: string): string {
  let text = stripFences(answer).replaceAll("<CURSOR>", "");
  const echo = linePrefix.trimStart();
  if (echo && text.startsWith(echo)) text = text.slice(echo.length);
  const nextLine = after
    .split("\n")
    .find((line) => line.trim())
    ?.trim();
  const lines = text.trimEnd().split("\n");
  while (nextLine && lines.length > 1 && lines[lines.length - 1].trim() === nextLine) lines.pop();
  text = lines.join("\n").trimEnd();
  return text.trim() ? text : "";
}

/** What is left of the ghost text once `typed` was entered; null when the typing doesn't follow it. */
export function advance(ghost: string, typed: string): string | null {
  if (!ghost.startsWith(typed)) return null;
  const rest = ghost.slice(typed.length);
  return rest ? rest : null;
}

/** The next word of the ghost text (with the whitespace before it), for ⌘→. */
export function nextWord(ghost: string): string {
  return /^\s*(?:[\w$]+|[^\w\s$]+)|^\s+/.exec(ghost)?.[0] ?? ghost;
}

/**
 * Copilot's items replace a range that may start before the cursor: the ghost text is what comes after
 * the part already typed (`typed`, the document from the range start to the cursor). Null when they differ.
 */
export function ghostOfItem(insertText: string, typed: string): string | null {
  return insertText.startsWith(typed) ? insertText.slice(typed.length) || null : null;
}

/** Never sent to any provider unless the user edits the list. */
export const DEFAULT_EXCLUDED = [".env*", "*.pem", "*.key", "**/secrets/**"];

/** A gitignore-like glob: `*` and `?` stay within a folder, `**` crosses folders. */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (glob.startsWith("**/", i)) {
      source += "(?:.*/)?";
      i += 2;
    } else if (glob.startsWith("**", i)) {
      source += ".*";
      i += 1;
    } else if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

/** Whether a repository path matches an exclusion; globs without `/` match the file name in any folder. */
export function isExcluded(path: string, globs: readonly string[]): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return globs.some((glob) => globToRegExp(glob.replace(/^\//, "")).test(glob.includes("/") ? path : name));
}

export type PredictionScope = {
  enabled: boolean;
  disabledFiles: readonly string[];
  disabledLanguages: readonly string[];
  excluded: readonly string[];
};

/** Whether a file may get predictions (and so be sent to a provider). */
export const predictsFor = (scope: PredictionScope, file: { uri: string; path: string; languageName: string }) =>
  scope.enabled &&
  !scope.disabledFiles.includes(file.uri) &&
  !scope.disabledLanguages.includes(file.languageName) &&
  !isExcluded(file.path, scope.excluded);
