import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t, type Tag } from "@lezer/highlight";
import { GITFLOW_THEME } from "@/features/diff/gitflow-theme";

type Rule = { scope?: string | string[]; settings?: { foreground?: string; fontStyle?: string } };
type ThemeJson = { colors?: Record<string, string>; tokenColors?: Rule[]; settings?: Rule[] };
type Style = { color?: string; fontStyle?: string; fontWeight?: string; textDecoration?: string };

/**
 * The TextMate style a scope gets in a theme: the most specific rule whose selector is the scope or one of its
 * parents ("keyword" styles "keyword.control.import"), as VS Code and Shiki resolve it.
 */
export function resolveScope(rules: readonly Rule[], scope: string): Rule["settings"] | null {
  let best: { length: number; settings: Rule["settings"] } | null = null;
  for (const rule of rules) {
    if (!rule.scope || !rule.settings?.foreground) continue;
    const selectors = (Array.isArray(rule.scope) ? rule.scope : rule.scope.split(",")).map((s) => s.trim());
    for (const selector of selectors) {
      const last = selector.split(/\s+/).pop() ?? ""; // "meta.x entity.name": the scope itself decides
      const matches = scope === last || scope.startsWith(`${last}.`);
      if (matches && (!best || last.length > best.length)) best = { length: last.length, settings: rule.settings };
    }
  }
  return best?.settings ?? null;
}

/** Each Lezer tag and the TextMate scopes it reads its color from, most specific first. */
const TAG_SCOPES: [Tag | Tag[], string[]][] = [
  [[t.comment, t.lineComment, t.blockComment, t.docComment], ["comment"]],
  [
    [t.string, t.character, t.special(t.string)],
    ["string.quoted", "string"],
  ],
  [[t.regexp], ["string.regexp"]],
  [[t.escape], ["constant.character.escape"]],
  [
    [t.controlKeyword, t.moduleKeyword],
    ["keyword.control", "keyword"],
  ],
  [[t.definitionKeyword], ["storage.type", "keyword"]],
  [[t.modifier], ["storage.modifier", "storage.type", "keyword"]],
  [[t.operatorKeyword], ["keyword.operator.new", "keyword.operator.expression", "keyword"]],
  [
    [t.keyword, t.self],
    ["keyword", "variable.language"],
  ],
  [[t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.compareOperator], ["keyword.operator"]],
  [[t.punctuation, t.separator, t.bracket, t.paren, t.squareBracket, t.brace], ["punctuation"]],
  [[t.angleBracket], ["punctuation.definition.tag", "punctuation"]],
  [[t.number, t.integer, t.float], ["constant.numeric"]],
  [[t.bool, t.null, t.atom], ["constant.language"]],
  [
    [t.function(t.variableName), t.function(t.definition(t.variableName)), t.macroName],
    ["entity.name.function", "support.function"],
  ],
  [[t.function(t.propertyName)], ["entity.name.function", "support.function"]],
  [
    [t.typeName, t.className, t.namespace, t.definition(t.typeName)],
    ["entity.name.type", "support.type", "entity.name.class"],
  ],
  [[t.tagName], ["entity.name.tag"]],
  [[t.attributeName], ["entity.other.attribute-name"]],
  [
    [t.propertyName, t.definition(t.propertyName)],
    ["variable.other.property", "support.type.property-name", "variable"],
  ],
  [[t.constant(t.variableName)], ["variable.other.constant", "variable"]],
  [
    [t.variableName, t.definition(t.variableName), t.labelName],
    ["variable.other.readwrite", "variable"],
  ],
  [[t.heading], ["markup.heading", "entity.name.section"]],
  [
    [t.link, t.url],
    ["markup.underline.link", "string"],
  ],
  [[t.emphasis], ["markup.italic"]],
  [[t.strong], ["markup.bold"]],
  [[t.invalid], ["invalid"]],
];

function toStyle(settings: NonNullable<Rule["settings"]>): Style {
  const font = settings.fontStyle ?? "";
  return {
    color: settings.foreground,
    fontStyle: font.includes("italic") ? "italic" : undefined,
    fontWeight: font.includes("bold") ? "600" : undefined,
    textDecoration: font.includes("underline") ? "underline" : undefined,
  };
}

/** A CodeMirror highlight style painting code exactly like the diffs, from the same Shiki theme. */
export function editorSyntaxTheme(theme: ThemeJson): Extension {
  const rules = theme.tokenColors ?? theme.settings ?? [];
  const foreground =
    theme.colors?.["editor.foreground"] ?? rules.find((r) => !r.scope)?.settings?.foreground ?? "#d4d4d8";
  const specs = TAG_SCOPES.flatMap(([tag, scopes]) => {
    for (const scope of scopes) {
      const settings = resolveScope(rules, scope);
      if (settings) return [{ tag, ...toStyle(settings) }];
    }
    return [];
  });
  return [syntaxHighlighting(HighlightStyle.define(specs)), EditorView.theme({ "&": { color: foreground } })];
}

const cache = new Map<string, Promise<Extension>>();

/** The highlight style for a syntax theme setting, loaded once (Shiki's theme files load on demand). */
export function loadEditorSyntaxTheme(name: string): Promise<Extension> {
  const known = cache.get(name);
  if (known) return known;
  const loading: Promise<Extension> =
    name === "gitflow"
      ? Promise.resolve(editorSyntaxTheme(GITFLOW_THEME as ThemeJson))
      : import("shiki").then(async ({ bundledThemes }) => {
          const load = bundledThemes[name as keyof typeof bundledThemes];
          return editorSyntaxTheme(load ? ((await load()).default as ThemeJson) : (GITFLOW_THEME as ThemeJson));
        });
  cache.set(name, loading);
  return loading;
}
