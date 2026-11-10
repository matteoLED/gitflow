import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { gotoLine, highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  gutter,
  GutterMarker,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { lintGutter } from "@codemirror/lint";
import { jumpToDefinition, LSPPlugin } from "@codemirror/lsp-client";
import type { LineChange } from "@/types/git";
import { createSearchPanel } from "./SearchBar";

/**
 * Holds the code colors: the user's syntax theme, the one the diffs use (see syntax-theme.ts). New tabs start
 * with the last one loaded.
 */
export const syntaxSlot = new Compartment();
let currentSyntax: Extension = [];
export const setCurrentSyntax = (syntax: Extension) => void (currentSyntax = syntax);
export const syncSyntax = (view: EditorView) => view.dispatch({ effects: syntaxSlot.reconfigure(currentSyntax) });

const theme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "transparent", fontSize: "var(--code-size, 12.5px)" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.65" },
    ".cm-content": { caretColor: "var(--primary)", padding: "6px 0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--primary)", borderLeftWidth: "2px" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "color-mix(in oklab, var(--primary) 30%, transparent) !important",
    },
    ".cm-activeLine": { backgroundColor: "rgb(255 255 255 / 0.03)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#d6d7da" },
    ".cm-gutters": { backgroundColor: "transparent", color: "#5d5f66", border: "none" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px", minWidth: "44px" },
    ".cm-foldGutter .cm-gutterElement": { color: "#5d5f66", padding: "0 4px", cursor: "pointer" },
    ".cm-selectionMatch": { backgroundColor: "rgb(255 255 255 / 0.08)" },
    "&.cm-focused .cm-matchingBracket": { backgroundColor: "rgb(255 255 255 / 0.12)", outline: "none" },
    ".cm-searchMatch": { backgroundColor: "rgb(250 204 21 / 0.18)", outline: "1px solid rgb(250 204 21 / 0.35)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgb(250 204 21 / 0.4)" },
    ".cm-foldPlaceholder": { backgroundColor: "rgb(255 255 255 / 0.08)", border: "none", color: "#aeb0b5" },
    ".cm-panels": {
      backgroundColor: "var(--popover)",
      color: "var(--foreground)",
      borderColor: "rgb(255 255 255 / 0.08)",
    },
    ".cm-panels-top": { borderBottom: "1px solid rgb(255 255 255 / 0.08)" },
    ".cm-tooltip": {
      backgroundColor: "var(--popover)",
      color: "var(--popover-foreground)",
      border: "1px solid rgb(255 255 255 / 0.1)",
      borderRadius: "8px",
      boxShadow: "0 12px 32px rgb(0 0 0 / 0.45)",
      overflow: "hidden",
    },
    ".cm-tooltip-hover": { maxWidth: "640px", maxHeight: "360px", overflow: "auto", fontSize: "12.5px" },
    ".cm-lsp-documentation": { padding: "6px 10px", fontFamily: "var(--font-sans)" },
    ".cm-lsp-documentation pre, .cm-lsp-documentation code": { fontFamily: "var(--font-mono)", fontSize: "12px" },
    ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", fontSize: "12.5px", maxHeight: "18em" },
    ".cm-tooltip-autocomplete > ul > li": { padding: "2px 8px !important", lineHeight: "1.6" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "color-mix(in oklab, var(--primary) 28%, transparent)",
      color: "var(--foreground)",
    },
    ".cm-completionDetail": { color: "#878991", fontStyle: "normal", marginLeft: "1em" },
    ".cm-completionMatchedText": { textDecoration: "none", color: "var(--primary)", fontWeight: "600" },
    ".cm-diagnostic": { padding: "4px 10px", fontFamily: "var(--font-sans)", fontSize: "12.5px" },
    ".cm-diagnostic-error": { borderLeft: "3px solid var(--removed-foreground)" },
    ".cm-diagnostic-warning": { borderLeft: "3px solid rgb(250 204 21)" },
    ".cm-lintRange-error": {
      backgroundImage: "none",
      textDecoration: "underline wavy var(--removed-foreground)",
      textUnderlineOffset: "3px",
    },
    ".cm-lintRange-warning": {
      backgroundImage: "none",
      textDecoration: "underline wavy rgb(250 204 21 / 0.8)",
      textUnderlineOffset: "3px",
    },
    ".cm-gutter-lint": { width: "10px" },
    ".cm-git-gutter": { width: "3px", marginRight: "2px" },
    ".cm-git-added": { backgroundColor: "var(--added-foreground)", height: "100%" },
    ".cm-git-modified": { backgroundColor: "var(--primary)", height: "100%" },
    ".cm-git-deleted": {
      height: "0",
      borderTop: "4px solid transparent",
      borderBottom: "4px solid transparent",
      borderLeft: "5px solid var(--removed-foreground)",
    },
  },
  { dark: true },
);

class ChangeMarker extends GutterMarker {
  constructor(readonly kind: LineChange["kind"]) {
    super();
  }
  eq(other: ChangeMarker) {
    return other.kind === this.kind;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = `cm-git-${this.kind}`;
    return el;
  }
}

/** Replaces the gutter's marks with the file's changes against HEAD. */
export const setLineChanges = StateEffect.define<LineChange[]>();

const changesField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(markers, tr) {
    let next = markers.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setLineChanges)) continue;
      const doc = tr.state.doc;
      const ranges = effect.value.flatMap((change) => {
        const marker = new ChangeMarker(change.kind);
        const lines: number[] = [];
        for (let n = change.start; n <= Math.min(change.end, doc.lines); n++) lines.push(n);
        return lines.map((n) => marker.range(doc.line(n).from));
      });
      next = RangeSet.of(ranges, true);
    }
    return next;
  },
});

const gitGutter: Extension = [
  changesField,
  gutter({ class: "cm-git-gutter", markers: (view) => view.state.field(changesField) }),
];

/** Holds the language, swapped in once its parser has loaded. */
export const languageSlot = new Compartment();
/** Holds the language server connection, added once the server is up. */
export const lspSlot = new Compartment();

/** ⌘-click jumps to a definition, as in Zed (when a language server is connected). */
const clickToDefinition = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!event.metaKey || event.button !== 0 || !LSPPlugin.get(view)) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    view.dispatch({ selection: { anchor: pos } });
    jumpToDefinition(view);
    event.preventDefault();
    return true;
  },
});

/** The parser for a file, loaded on demand: opening a .ts file never downloads the Rust grammar. */
export async function languageFor(path: string): Promise<Extension> {
  const description = LanguageDescription.matchFilename(languages, path.split("/").pop() ?? path);
  if (!description) return [];
  return description.support ?? (await description.load());
}

export const languageName = (path: string) =>
  LanguageDescription.matchFilename(languages, path.split("/").pop() ?? path)?.name ?? null;

/** Everything an editor tab needs, Zed-like: no autocomplete popups, fast keys, multi-cursor. */
export function editorExtensions(onSave: () => void, onAsk: () => void, readOnly: boolean): Extension {
  return [
    lineNumbers(),
    gitGutter,
    foldGutter({ openText: "⌄", closedText: "›" }),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxSlot.of(currentSyntax),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true, createPanel: createSearchPanel }),
    languageSlot.of([]),
    lspSlot.of([]),
    clickToDefinition,
    lintGutter(),
    EditorState.readOnly.of(readOnly),
    keymap.of([
      { key: "Mod-s", preventDefault: true, run: () => (onSave(), true) },
      { key: "Mod-g", preventDefault: true, run: gotoLine },
      { key: "Mod-l", preventDefault: true, run: () => (onAsk(), true) },
      indentWithTab,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
    ]),
    theme,
  ];
}
