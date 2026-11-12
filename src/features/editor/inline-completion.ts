import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type ViewUpdate } from "@codemirror/view";
import { getT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { useCompletionStore } from "@/stores/completion-store";
import { useNoticesStore } from "@/stores/notices-store";
import { copilotSuggest } from "./copilot";
import {
  advance,
  buildPrompt,
  canTrigger,
  cleanAnswer,
  nextWord,
  predictsFor,
  promptWindow,
  type Suggestion,
  type SuggestionRequest,
} from "./inline-completion-logic";

/** Inline AI completion, as in Zed: dimmed ghost text after a pause in typing; Tab takes it. */

const DEBOUNCE = 300;
const TIMEOUT = 5000;
const MAX_DOC = 500_000;

/** Errors are told once per message: a missing key shouldn't toast on every keystroke. */
const told = new Set<string>();
function tell(error: unknown) {
  const message = toGitError(error).message;
  if (told.has(message)) return;
  told.add(message);
  useNoticesStore.getState().notify({ tone: "error", title: getT()("completion.failed"), detail: message });
}

async function fetchSuggestion(request: SuggestionRequest): Promise<Suggestion | null> {
  const { provider, claudeModel, openaiModel } = useCompletionStore.getState();
  if (provider === "off") return null;
  if (provider === "copilot") return copilotSuggest(request);
  const { doc, pos, path, languageName } = request;
  const window = promptWindow(pos);
  const after = doc.sliceString(pos, Math.min(window.to, doc.length));
  const prompt = buildPrompt(path, languageName, doc.sliceString(window.from, pos), after);
  const model = provider === "claude" ? claudeModel : openaiModel;
  const answer = await gitBackend.completionComplete(provider, model, prompt);
  const text = cleanAnswer(answer, doc.sliceString(doc.lineAt(pos).from, pos), after);
  return text ? { text, to: pos } : null;
}

const withTimeout = <T>(promise: Promise<T>) =>
  Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT))]);

type Ghost = Suggestion & { from: number };
const setGhost = StateEffect.define<Ghost | null>();

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: GhostWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-ghost-text";
    span.textContent = this.text;
    return span;
  }
}

/**
 * Subtle mode: a dot says a prediction waits; holding ⌥ shows it. Drawn out of the flow from a zero-width anchor,
 * so the caret keeps the text's height and place and the line doesn't shift.
 */
class DotWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const anchor = document.createElement("span");
    anchor.className = "cm-ghost-anchor";
    const dot = document.createElement("span");
    dot.className = "cm-ghost-dot";
    dot.setAttribute("aria-label", getT()("predictions.holdAlt"));
    anchor.append(dot);
    return anchor;
  }
}

const setPeek = StateEffect.define<boolean>();
const peekField = StateField.define<boolean>({
  create: () => false,
  update: (peek, tr) => tr.effects.reduce((value, e) => (e.is(setPeek) ? e.value : value), peek),
});
const predictEffect = StateEffect.define<null>();

/** Asks for a prediction at the cursor right away (⌥Tab, or the status menu). */
export const predictNow = (view: EditorView) => view.dispatch({ effects: predictEffect.of(null) });

/** The ghost on screen. Typing what it shows eats into it; any other edit or cursor move drops it. */
const ghostField = StateField.define<Ghost | null>({
  create: () => null,
  update(ghost, tr) {
    for (const effect of tr.effects) if (effect.is(setGhost)) return effect.value;
    if (!ghost || (!tr.docChanged && !tr.selection)) return ghost;
    if (!tr.docChanged) return null;
    const inserts: string[] = [];
    let follows = true;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      follows &&= fromA === ghost.from && toA === fromA;
      inserts.push(inserted.toString());
    });
    const typed = inserts.join("");
    const rest = follows && inserts.length === 1 ? advance(ghost.text, typed) : null;
    return rest ? { ...ghost, from: ghost.from + typed.length, text: rest, to: tr.changes.mapPos(ghost.to, 1) } : null;
  },
});

/** The display mode is read when the ghost changes: switching it applies from the next prediction. */
const ghostDecorations = EditorView.decorations.compute([ghostField, peekField], (state) => {
  const ghost = state.field(ghostField);
  if (!ghost) return Decoration.none;
  const subtle = useCompletionStore.getState().displayMode === "subtle" && !state.field(peekField);
  const widget = subtle ? new DotWidget() : new GhostWidget(ghost.text);
  return Decoration.set([Decoration.widget({ widget, side: 1 }).range(ghost.from)]);
});

const peekKeys = EditorView.domEventHandlers({
  keydown: (event, view) => {
    if (event.key === "Alt" && !view.state.field(peekField)) view.dispatch({ effects: setPeek.of(true) });
    return false;
  },
  keyup: (event, view) => {
    if (event.key === "Alt" && view.state.field(peekField)) view.dispatch({ effects: setPeek.of(false) });
    return false;
  },
  blur: (_event, view) => {
    if (view.state.field(peekField)) view.dispatch({ effects: setPeek.of(false) });
    return false;
  },
});

function accept(view: EditorView, ghost: Ghost) {
  view.dispatch({
    changes: { from: ghost.from, to: ghost.to, insert: ghost.text },
    selection: { anchor: ghost.from + ghost.text.length },
    effects: setGhost.of(null),
    userEvent: "input.complete",
    scrollIntoView: true,
  });
  ghost.accepted?.();
}

const ghostKeys = Prec.highest(
  keymap.of([
    {
      key: "Tab",
      run: (view) => {
        const ghost = view.state.field(ghostField);
        if (!ghost) return false;
        accept(view, ghost);
        return true;
      },
    },
    {
      key: "Mod-ArrowRight",
      run: (view) => {
        const ghost = view.state.field(ghostField);
        if (!ghost) return false;
        const word = nextWord(ghost.text);
        const rest = ghost.text.slice(word.length);
        if (!rest) return (accept(view, ghost), true);
        const from = ghost.from + word.length;
        view.dispatch({
          changes: { from: ghost.from, insert: word },
          selection: { anchor: from },
          effects: setGhost.of({ ...ghost, from, text: rest, to: ghost.to + word.length }),
          userEvent: "input.complete",
        });
        return true;
      },
    },
    { key: "Alt-Tab", preventDefault: true, run: (view) => (predictNow(view), true) },
    {
      key: "Escape",
      run: (view) => {
        if (!view.state.field(ghostField)) return false;
        view.dispatch({ effects: setGhost.of(null) });
        return true;
      },
    },
  ]),
);

type FileInfo = { path: string; uri: string; languageId: string; languageName: string };

/** Asks the provider once typing pauses; a newer keystroke or cursor move makes any pending answer moot. */
const requester = (file: FileInfo) =>
  ViewPlugin.define((view) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let seq = 0;
    const setBusy = (busy: boolean) =>
      useCompletionStore.getState().busy !== busy && useCompletionStore.getState().setBusy(busy);
    const cancel = () => {
      clearTimeout(timer);
      seq++;
      setBusy(false);
    };
    /** `force`: asked explicitly, so also mid-line. Never for excluded or switched-off files. */
    const request = async (force = false) => {
      const { state } = view;
      const { main } = state.selection;
      if (state.selection.ranges.length > 1 || !main.empty || state.doc.length > MAX_DOC || state.readOnly) return;
      const settings = useCompletionStore.getState();
      if (settings.provider === "off" || !predictsFor(settings, file)) return;
      const pos = main.head;
      if (!force && !canTrigger(state.doc.sliceString(pos, state.doc.lineAt(pos).to))) return;
      const id = ++seq;
      const doc = state.doc;
      setBusy(true);
      const suggestion = await withTimeout(fetchSuggestion({ ...file, doc, pos, tabSize: state.tabSize })).catch(
        (error: unknown) => (id === seq && tell(error), null),
      );
      if (id !== seq) return;
      setBusy(false);
      if (!suggestion || view.state.doc !== doc || view.state.selection.main.head !== pos) return;
      view.dispatch({ effects: setGhost.of({ ...suggestion, from: pos }) });
    };
    return {
      update(update: ViewUpdate) {
        if (update.transactions.some((tr) => tr.effects.some((e) => e.is(predictEffect)))) {
          cancel();
          void request(true);
          return;
        }
        if (!update.docChanged && !update.selectionSet) return;
        cancel();
        const typed = update.transactions.some(
          (tr) => tr.isUserEvent("input.type") || tr.isUserEvent("delete.backward"),
        );
        if (typed && !update.state.field(ghostField)) timer = setTimeout(() => void request(), DEBOUNCE);
      },
      destroy: cancel,
    };
  });

const ghostTheme = EditorView.baseTheme({
  ".cm-ghost-text": { opacity: "0.45", whiteSpace: "pre", pointerEvents: "none" },
  ".cm-ghost-anchor": { position: "relative" },
  ".cm-ghost-dot": {
    position: "absolute",
    left: "4px",
    top: "50%",
    width: "5px",
    height: "5px",
    marginTop: "-2.5px",
    borderRadius: "50%",
    pointerEvents: "none",
    backgroundColor: "var(--primary)",
    opacity: "0.8",
  },
});

/** Ghost-text completion for one file (inert while the provider setting is Off). */
export function inlineCompletion(file: FileInfo): Extension {
  return [ghostField, peekField, ghostDecorations, peekKeys, ghostKeys, requester(file), ghostTheme];
}
