import type { EditorView } from "@codemirror/view";
import type { CodeSelection } from "@/stores/ui-store";

/** The selection, or the line under the cursor when nothing is selected. */
export function selectionOf(view: EditorView, path: string): CodeSelection {
  const { state } = view;
  const range = state.selection.main;
  const from = state.doc.lineAt(range.from);
  const to = state.doc.lineAt(range.to);
  const code = range.empty ? from.text : state.sliceDoc(range.from, range.to);
  return { path, from: from.number, to: to.number, code };
}

export const whereOf = (s: CodeSelection) => `${s.path}:${s.from}${s.to > s.from ? `-${s.to}` : ""}`;

/** What the agent reads after the user's message: where the code is, and the code. */
const MAX_CODE = 12_000;
export const selectionPrompt = (s: CodeSelection) => {
  const code =
    s.code.length > MAX_CODE ? `${s.code.slice(0, MAX_CODE)}\n… (truncated, read the file for the rest)` : s.code;
  return `About ${whereOf(s)}:\n\n\`\`\`\n${code}\n\`\`\``;
};
