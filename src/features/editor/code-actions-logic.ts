/** Pure helpers of LSP code actions: ordering them, and turning workspace edits into checked file operations. */
import type { ChangeSpec, Text } from "@codemirror/state";

export type LspPosition = { line: number; character: number };
export type LspRange = { start: LspPosition; end: LspPosition };
export type TextEdit = { range: LspRange; newText: string };
export type LspCommand = { title: string; command: string; arguments?: unknown[] };
type ResourceFlags = { overwrite?: boolean; ignoreIfExists?: boolean };
type DocumentChange =
  | { textDocument: { uri: string }; edits: TextEdit[] }
  | { kind: "create"; uri: string; options?: ResourceFlags }
  | { kind: "rename"; oldUri: string; newUri: string; options?: ResourceFlags }
  | { kind: "delete"; uri: string };
export type WorkspaceEdit = { changes?: Record<string, TextEdit[]>; documentChanges?: DocumentChange[] };
export type CodeAction = {
  title: string;
  kind?: string;
  isPreferred?: boolean;
  disabled?: { reason: string };
  edit?: WorkspaceEdit;
  command?: LspCommand;
  data?: unknown;
};

export type FileOp =
  | { type: "edit"; path: string; edits: TextEdit[] }
  | { type: "create"; path: string; overwrite: boolean; ignoreIfExists: boolean }
  | { type: "rename"; from: string; to: string; overwrite: boolean; ignoreIfExists: boolean }
  | { type: "delete"; path: string };

export const fileUri = (repo: string, path: string) =>
  `file://${`${repo}/${path}`.split("/").map(encodeURIComponent).join("/")}`;

/** The repository-relative path of a `file://` URI; null when it points outside the repository. */
export function repoPathOf(repo: string, uri: string): string | null {
  const prefix = fileUri(repo, "");
  if (!uri.startsWith(prefix)) return null;
  let path: string;
  try {
    path = decodeURIComponent(uri.slice(prefix.length));
  } catch {
    return null;
  }
  const parts = path.split("/");
  return parts.every((part) => part && part !== "." && part !== "..") ? path : null;
}

/** The server's answer as code actions (bare commands wrapped), disabled ones dropped, quick fixes first. */
export function sortActions(items: readonly (CodeAction | LspCommand)[]): CodeAction[] {
  const rank = (a: CodeAction) =>
    a.kind?.startsWith("quickfix") ? (a.isPreferred ? 0 : 1) : a.kind?.startsWith("refactor") ? 2 : 3;
  return items
    .map((item): CodeAction =>
      typeof item.command === "string" ? { title: item.title, command: item as LspCommand } : (item as CodeAction),
    )
    .filter((a) => !a.disabled)
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
    .map(({ a }) => a);
}

/** The file operations of a workspace edit, in order; null when any of them leaves the repository. */
export function planWorkspaceEdit(repo: string, edit: WorkspaceEdit): FileOp[] | null {
  const ops: (FileOp | null)[] = [];
  const pathOf = (uri: string) => repoPathOf(repo, uri);
  const flags = (o?: ResourceFlags) => ({ overwrite: !!o?.overwrite, ignoreIfExists: !!o?.ignoreIfExists });
  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if ("textDocument" in change) {
        const path = pathOf(change.textDocument.uri);
        ops.push(path ? { type: "edit", path, edits: change.edits } : null);
      } else if (change.kind === "create") {
        const path = pathOf(change.uri);
        ops.push(path ? { type: "create", path, ...flags(change.options) } : null);
      } else if (change.kind === "rename") {
        const from = pathOf(change.oldUri);
        const to = pathOf(change.newUri);
        ops.push(from && to ? { type: "rename", from, to, ...flags(change.options) } : null);
      } else {
        const path = pathOf(change.uri);
        ops.push(path ? { type: "delete", path } : null);
      }
    }
  } else {
    for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
      const path = pathOf(uri);
      ops.push(path ? { type: "edit", path, edits } : null);
    }
  }
  return ops.every((op) => op !== null) ? (ops as FileOp[]) : null;
}

const offsetOf = (doc: Text, { line, character }: LspPosition) => {
  if (line >= doc.lines) return doc.length;
  const at = doc.line(line + 1);
  return Math.min(at.from + character, at.to);
};

/** LSP text edits (all against the same original text) as CodeMirror changes. */
export const toChanges = (doc: Text, edits: readonly TextEdit[]): ChangeSpec[] =>
  edits.map((e) => ({ from: offsetOf(doc, e.range.start), to: offsetOf(doc, e.range.end), insert: e.newText }));
