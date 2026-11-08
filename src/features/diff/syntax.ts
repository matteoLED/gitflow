import type { BundledLanguage, BundledTheme, Highlighter, ThemedToken } from "shiki";
import { GITFLOW_THEME } from "./gitflow-theme";
import type { DiffLine } from "@/types/git";

export type LineTokens = (ThemedToken[] | null)[];

/** Past this size, tokenizing costs more than it helps: the diff is shown plain. */
const MAX_HIGHLIGHT_LINES = 20_000;

/** Extensions whose Shiki language id differs from the extension itself. */
const EXTENSION_ALIASES: Record<string, string> = {
  mjs: "javascript",
  cjs: "javascript",
  mts: "typescript",
  cts: "typescript",
  h: "c",
  hpp: "cpp",
  kts: "kotlin",
  yml: "yaml",
  zsh: "shellscript",
  bash: "shellscript",
  sh: "shellscript",
  gql: "graphql",
  lock: "toml",
};
const FILE_NAMES: Record<string, string> = { dockerfile: "docker", makefile: "make", gemfile: "ruby" };

let highlighter: Promise<{ instance: Highlighter; known: Set<string> }> | null = null;

/** Loaded on first use so Shiki never weighs on startup. JS regex engine: no WebAssembly needed. */
function getHighlighter() {
  highlighter ??= import("shiki").then(
    async ({ createHighlighter, createJavaScriptRegexEngine, bundledLanguages }) => ({
      instance: await createHighlighter({
        themes: [], // loaded on demand: the syntax theme is a user setting
        langs: [],
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      }),
      known: new Set(Object.keys(bundledLanguages)),
    }),
  );
  return highlighter;
}

function isKnown(lang: string, known: Set<string>): lang is BundledLanguage {
  return known.has(lang);
}

export function languageCandidate(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (FILE_NAMES[name]) return FILE_NAMES[name];
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1);
  return EXTENSION_ALIASES[ext] ?? ext;
}

/** Tokens for each diff line, read from the old file for removed lines and from the new file otherwise. */
function alignTokens(lines: DiffLine[], oldTokens: ThemedToken[][], newTokens: ThemedToken[][]): LineTokens {
  let oldIndex = 0;
  let newIndex = 0;
  return lines.map((line) => {
    if (line.kind === "removed") return oldTokens[oldIndex++] ?? null;
    if (line.kind === "context") oldIndex++;
    return newTokens[newIndex++] ?? null;
  });
}

/** "gitflow" is the built-in default; any other name is one of Shiki's bundled themes. */
export type SyntaxThemeName = BundledTheme | "gitflow";

export async function highlightDiff(
  path: string,
  lines: DiffLine[],
  theme: SyntaxThemeName,
): Promise<LineTokens | null> {
  const lang = languageCandidate(path);
  if (!lang || lines.length === 0 || lines.length > MAX_HIGHLIGHT_LINES) return null;
  const { instance, known } = await getHighlighter();
  if (!isKnown(lang, known)) return null;
  const themeInput = theme === "gitflow" ? GITFLOW_THEME : theme;
  await Promise.all([instance.loadLanguage(lang), instance.loadTheme(themeInput)]);
  const text = (kind: DiffLine["kind"]) =>
    lines
      .filter((l) => l.kind !== kind)
      .map((l) => l.content)
      .join("\n");
  const tokenize = (code: string) =>
    instance.codeToTokensBase(code, { lang, theme: themeInput, tokenizeMaxLineLength: 1000 });
  return alignTokens(lines, tokenize(text("added")), tokenize(text("removed")));
}
