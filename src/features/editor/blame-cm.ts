import { Compartment, Prec, RangeSet, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, gutter, GutterMarker, WidgetType } from "@codemirror/view";
import type { BlameHunk } from "@/types/git";

/** Holds the shown file's blame gutter and current-line annotation; empty while blame is off. */
export const blameSlot = new Compartment();

export type BlameLabels = {
  /** Gutter text on a hunk's first line, e.g. "Ana Lima · 3d". */
  gutter: (hunk: BlameHunk) => string;
  /** End-of-line text on the cursor's line. */
  inline: (hunk: BlameHunk) => string;
  /** Hover text of the gutter: hash, author, date, summary (a click opens the full card). */
  title: (hunk: BlameHunk) => string;
};

/** Opens the commit card for a blame entry, next to the clicked element. */
export type OpenBlame = (hunk: BlameHunk, anchor: DOMRect) => void;

class BlameMarker extends GutterMarker {
  constructor(
    readonly hunk: BlameHunk,
    readonly text: string,
    readonly title: string,
  ) {
    super();
  }
  eq(other: BlameMarker) {
    return other.hunk === this.hunk && other.text === this.text;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = this.text ? "cm-blame-entry cm-blame-start" : "cm-blame-entry";
    el.textContent = this.text;
    el.title = this.title;
    return el;
  }
}

/** Lucide's git-branch, inline so the widget stays plain DOM. */
const BRANCH_ICON =
  '<svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>';

class GhostWidget extends WidgetType {
  constructor(
    readonly hunk: BlameHunk,
    readonly text: string,
    readonly open: OpenBlame,
  ) {
    super();
  }
  eq(other: GhostWidget) {
    return other.hunk === this.hunk && other.text === this.text;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-blame-ghost";
    el.innerHTML = BRANCH_ICON;
    el.append(this.text);
    el.onmousedown = (event) => {
      event.preventDefault();
      this.open(this.hunk, el.getBoundingClientRect());
    };
    return el;
  }
}

const theme = EditorView.theme({
  ".cm-blame-gutter": { width: "176px", fontFamily: "var(--code-font)", fontSize: "11.5px", cursor: "pointer" },
  ".cm-blame-gutter .cm-gutterElement": { padding: "0 12px 0 10px", overflow: "hidden" },
  ".cm-blame-entry": { color: "#6b6e76", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  ".cm-blame-gutter .cm-gutterElement:hover .cm-blame-entry": { color: "#aeb0b5" },
  ".cm-blame-ghost": {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    verticalAlign: "top",
    marginLeft: "3.5em",
    fontFamily: "var(--code-font)",
    fontSize: "11.5px",
    color: "#5d5f66",
    cursor: "pointer",
    whiteSpace: "pre",
  },
  ".cm-blame-ghost:hover": { color: "#aeb0b5" },
});

/** One marker per line (text on the first line of each hunk only), so any line finds its commit. */
function markersFor(state: EditorState, hunks: BlameHunk[], labels: BlameLabels) {
  const lines = state.doc.lines;
  const ranges = hunks.flatMap((hunk) => {
    const title = labels.title(hunk);
    const first = new BlameMarker(hunk, labels.gutter(hunk), title);
    const rest = new BlameMarker(hunk, "", title);
    const end = Math.min(hunk.startLine + hunk.lines - 1, lines);
    const out = [];
    for (let n = hunk.startLine; n <= end; n++)
      out.push((n === hunk.startLine ? first : rest).range(state.doc.line(n).from));
    return out;
  });
  return RangeSet.of(ranges, true);
}

/** The blame gutter (left of the line numbers, like Zed) and the cursor line's ghost annotation. */
export function blameExtension(
  hunks: BlameHunk[],
  labels: BlameLabels,
  open: OpenBlame,
  withGutter: boolean,
): Extension {
  const field = StateField.define<RangeSet<BlameMarker>>({
    create: (state) => markersFor(state, hunks, labels),
    update: (markers, tr) => markers.map(tr.changes),
  });
  const hunkAt = (state: EditorState, pos: number) => {
    const found: BlameHunk[] = [];
    state.field(field).between(pos, pos, (_from, _to, marker) => void found.push(marker.hunk));
    return found[0] ?? null;
  };
  const ghost = EditorView.decorations.compute(["selection", field], (state) => {
    const line = state.doc.lineAt(state.selection.main.head);
    const hunk = hunkAt(state, line.from);
    if (!hunk) return Decoration.none;
    const widget = new GhostWidget(hunk, labels.inline(hunk), open);
    return Decoration.set([Decoration.widget({ widget, side: 1 }).range(line.to)]);
  });
  if (!withGutter) return [field, ghost, theme];
  return [
    field,
    Prec.highest(
      gutter({
        class: "cm-blame-gutter",
        markers: (view) => view.state.field(field),
        domEventHandlers: {
          mousedown(view, line, event) {
            const hunk = hunkAt(view.state, line.from);
            if (!hunk || !(event.target instanceof HTMLElement)) return false;
            open(hunk, event.target.getBoundingClientRect());
            return true;
          },
        },
      }),
    ),
    ghost,
    theme,
  ];
}
