import type { ThemeRegistration } from "shiki";

/**
 * Default syntax theme, sampled from the reference design: low-saturation colors on a near-black card,
 * so the added/removed tints stay the loudest thing on screen.
 */
export const GITFLOW_THEME: ThemeRegistration = {
  name: "gitflow",
  type: "dark",
  colors: { "editor.background": "#00000000", "editor.foreground": "#d6d7da" },
  tokenColors: [
    { settings: { foreground: "#d6d7da" } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#878991", fontStyle: "italic" } },
    { scope: ["string", "string.template", "markup.inline.raw"], settings: { foreground: "#e0d5b2" } },
    { scope: ["constant.character.escape", "string.regexp"], settings: { foreground: "#c9b78f" } },
    {
      scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new"],
      settings: { foreground: "#b6aae6" },
    },
    {
      scope: ["keyword.operator", "punctuation", "meta.brace", "punctuation.definition.tag"],
      settings: { foreground: "#aeb0b5" },
    },
    { scope: ["constant.language", "constant.numeric", "constant.other"], settings: { foreground: "#a3aaf0" } },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call entity.name.function",
        "variable.function",
      ],
      settings: { foreground: "#acd2d1" },
    },
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "entity.other.inherited-class",
        "support.class",
        "support.type",
        "entity.name.tag",
        "support.class.component",
        "variable.other.constant.object",
        "entity.name.namespace",
      ],
      settings: { foreground: "#a6c2dd" },
    },
    {
      scope: ["entity.other.attribute-name", "meta.object-literal.key", "variable.other.property"],
      settings: { foreground: "#d6d7da" },
    },
    { scope: ["variable.parameter"], settings: { foreground: "#d6d7da" } },
    { scope: ["markup.heading", "entity.name.section"], settings: { foreground: "#a6c2dd", fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
  ],
};
