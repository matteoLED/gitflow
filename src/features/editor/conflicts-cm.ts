import { RangeSetBuilder, StateField, type EditorState, type Extension, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { getT } from "@/i18n";
import { parseConflicts, resolution, type Choice, type Conflict } from "./conflicts";

/** Past this size a file isn't scanned for markers on every keystroke. */
const MAX_SCAN = 2_000_000;
const MARKER = /^(<{7}|\|{7}|={7}|>{7})/;

class ConflictActions extends WidgetType {
  constructor(readonly conflict: Conflict) {
    super();
  }
  eq(other: ConflictActions) {
    return other.conflict.from === this.conflict.from && other.conflict.to === this.conflict.to;
  }
  toDOM(view: EditorView) {
    const t = getT();
    const bar = document.createElement("div");
    bar.className = "cm-conflict-actions";
    const choices: [Choice, string][] = [
      ["ours", t("conflicts.keepOurs", { side: this.conflict.oursLabel || "HEAD" })],
      ["theirs", t("conflicts.keepTheirs", { side: this.conflict.theirsLabel || "" })],
      ["both", t("conflicts.keepBoth")],
    ];
    choices.forEach(([choice, label], i) => {
      if (i > 0)
        bar.append(Object.assign(document.createElement("span"), { textContent: "·", className: "cm-conflict-sep" }));
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.onmousedown = (e) => e.preventDefault();
      button.onclick = () => {
        // Positions may have moved since the bar was drawn: resolve the conflict that starts here now.
        const current = parseConflicts(view.state.doc.toString()).find((c) => c.from === view.posAtDOM(bar));
        const target = current ?? this.conflict;
        view.dispatch({ changes: { from: target.from, to: target.to, insert: resolution(target, choice) } });
        view.focus();
      };
      bar.append(button);
    });
    return bar;
  }
  ignoreEvent() {
    return false;
  }
}

const ours = Decoration.line({ class: "cm-conflict-ours" });
const base = Decoration.line({ class: "cm-conflict-base" });
const theirs = Decoration.line({ class: "cm-conflict-theirs" });
const marker = Decoration.line({ class: "cm-conflict-marker" });

function decorate(state: EditorState): DecorationSet {
  if (state.doc.length > MAX_SCAN) return Decoration.none;
  const text = state.doc.toString();
  if (!text.includes("<<<<<<<")) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  for (const conflict of parseConflicts(text)) {
    builder.add(
      conflict.from,
      conflict.from,
      Decoration.widget({ widget: new ConflictActions(conflict), block: true, side: -1 }),
    );
    let section: "ours" | "base" | "theirs" = "ours";
    for (let line = state.doc.lineAt(conflict.from); ; line = state.doc.line(line.number + 1)) {
      const isMarker = MARKER.test(line.text);
      if (line.text.startsWith("|||||||")) section = "base";
      if (line.text.startsWith("=======")) section = "theirs";
      builder.add(
        line.from,
        line.from,
        isMarker ? marker : section === "ours" ? ours : section === "base" ? base : theirs,
      );
      if (line.to + 1 >= conflict.to || line.number === state.doc.lines) break;
    }
  }
  return builder.finish();
}

/** Whether an edit wrote on a line that starts with a conflict marker (the file may have gained a conflict). */
export function touchesMarker(tr: Transaction): boolean {
  let found = false;
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const doc = tr.state.doc;
    for (let n = doc.lineAt(fromB).number, last = doc.lineAt(toB).number; !found && n <= last; n++)
      found = MARKER.test(doc.line(n).text);
  });
  return found;
}

/**
 * Rescanned (the whole text) only while the file has conflicts or when an edit touches a marker line: typing in
 * an ordinary file, even a 1 MB one, costs nothing here.
 */
const conflictField = StateField.define<DecorationSet>({
  create: decorate,
  update: (decorations, tr) => {
    if (!tr.docChanged) return decorations;
    if (decorations.size === 0 && !touchesMarker(tr)) return decorations;
    return decorate(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const conflictTheme = EditorView.baseTheme({
  ".cm-conflict-ours": { backgroundColor: "color-mix(in oklab, var(--added-foreground) 14%, transparent)" },
  ".cm-conflict-theirs": { backgroundColor: "color-mix(in oklab, var(--primary) 16%, transparent)" },
  ".cm-conflict-base": { backgroundColor: "rgb(255 255 255 / 0.04)" },
  ".cm-conflict-marker": { backgroundColor: "rgb(255 255 255 / 0.06)", color: "#878991" },
  ".cm-conflict-actions": {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "3px 0 3px 6px",
    fontFamily: "var(--font-sans)",
    fontSize: "11.5px",
    color: "#878991",
  },
  ".cm-conflict-actions button": {
    background: "none",
    border: "none",
    padding: "0",
    color: "inherit",
    cursor: "pointer",
    font: "inherit",
  },
  ".cm-conflict-actions button:hover": { color: "var(--foreground)", textDecoration: "underline" },
  ".cm-conflict-sep": { opacity: "0.5" },
});

/** Git's conflict markers made actionable: both sides tinted, and a choice bar above each conflict. */
export const conflictMarkers: Extension = [conflictField, conflictTheme];
