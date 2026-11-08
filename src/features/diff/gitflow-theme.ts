import type { ThemeRegistration } from "shiki";

/**
 * Default syntax theme, sampled from the reference design: low-saturation colors on a near-black card,
 * so the added/removed tints stay the loudest thing on screen.
 */
export const GITFLOW_THEME: ThemeRegistration = {
  name: "gitflow",
  type: "dark",
  colors: { "editor.background": "#00000000", "editor.foreground": "#c8c9cc" },
  tokenColors: [
    { settings: { foreground: "#c8c9cc" } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#6c6e74", fontStyle: "italic" } },
    { scope: ["string", "string.template", "markup.inline.raw"], settings: { foreground: "#d6cba9" } },
    { scope: ["constant.character.escape", "string.regexp"], settings: { foreground: "#c9b78f" } },
    {
      scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new"],
      settings: { foreground: "#a99cdb" },
    },
    {
      scope: ["keyword.operator", "punctuation", "meta.brace", "punctuation.definition.tag"],
      settings: { foreground: "#9c9ea3" },
    },
    { scope: ["constant.language", "constant.numeric", "constant.other"], settings: { foreground: "#959ce6" } },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call entity.name.function",
        "variable.function",
      ],
      settings: { foreground: "#9fc4c3" },
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
      settings: { foreground: "#97b4d0" },
    },
    {
      scope: ["entity.other.attribute-name", "meta.object-literal.key", "variable.other.property"],
      settings: { foreground: "#c8c9cc" },
    },
    { scope: ["variable.parameter"], settings: { foreground: "#c8c9cc" } },
    { scope: ["markup.heading", "entity.name.section"], settings: { foreground: "#97b4d0", fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
  ],
};
