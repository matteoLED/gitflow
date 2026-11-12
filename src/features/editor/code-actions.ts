import { RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, GutterMarker, ViewPlugin, gutter, keymap, type ViewUpdate } from "@codemirror/view";
import { LSPPlugin, type LSPClientExtension } from "@codemirror/lsp-client";
import { getT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { useNoticesStore } from "@/stores/notices-store";
import {
  planWorkspaceEdit,
  sortActions,
  type CodeAction,
  type LspCommand,
  type LspRange,
  type TextEdit,
  type WorkspaceEdit,
} from "./code-actions-logic";

/** Code actions, as in Zed: ⚡ in the gutter when the server has some for the cursor; ⌘; lists them. */

type Diagnostic = { range: LspRange; message: string; severity?: number; code?: string | number; source?: string };

/** The server's own diagnostics per file (the editor's lint copies lose `code`, which quick fixes need). */
const diagnostics = new Map<string, Diagnostic[]>();

/** Client capabilities for code actions and workspace edits, plus the diagnostics capture above. */
export const codeActionClientExtension: LSPClientExtension = {
  clientCapabilities: {
    workspace: {
      applyEdit: true,
      workspaceEdit: { documentChanges: true, resourceOperations: ["create", "rename", "delete"] },
    },
    textDocument: {
      codeAction: {
        codeActionLiteralSupport: {
          codeActionKind: {
            valueSet: [
              "",
              "quickfix",
              "refactor",
              "refactor.extract",
              "refactor.inline",
              "refactor.move",
              "refactor.rewrite",
              "source",
              "source.organizeImports",
              "source.fixAll",
            ],
          },
        },
        isPreferredSupport: true,
        disabledSupport: true,
        dataSupport: true,
        resolveSupport: { properties: ["edit"] },
      },
    },
  },
  notificationHandlers: {
    "textDocument/publishDiagnostics": (_client, params: { uri: string; diagnostics: Diagnostic[] }) => {
      diagnostics.set(params.uri, params.diagnostics);
      return false; // the editor's own handler still shows them
    },
  },
};

/** How the editor page applies a text edit to a file: its view, an open tab, or the file on disk. */
export type EditHost = { editFile: (path: string, edits: TextEdit[]) => Promise<void> };
const hosts = new Map<string, EditHost>();
export function registerEditHost(repo: string, host: EditHost) {
  hosts.set(repo, host);
  return () => void (hosts.get(repo) === host && hosts.delete(repo));
}

/** `ignoreIfExists`: a failed create (the file is there) is fine; a real problem shows up in the next edit. */
const ignoreExisting = (ignore: boolean) => (error: unknown) => {
  if (!ignore) throw error;
};

/** Applies a server's workspace edit; files outside the repository refuse the whole edit. */
export async function applyWorkspaceEdit(repo: string, edit: WorkspaceEdit): Promise<boolean> {
  const host = hosts.get(repo);
  const ops = planWorkspaceEdit(repo, edit);
  if (!host || !ops) return false;
  for (const op of ops) {
    if (op.type === "edit") await host.editFile(op.path, op.edits);
    else if (op.type === "create")
      await (op.overwrite
        ? gitBackend.writeFile(repo, op.path, "", null)
        : gitBackend.createFile(repo, op.path).catch(ignoreExisting(op.ignoreIfExists)));
    else if (op.type === "rename") await gitBackend.renamePath(repo, op.from, op.to);
    else await gitBackend.deletePath(repo, op.path);
  }
  return true;
}

/** A server's `workspace/applyEdit` request (sent while it runs a command), answered as LSP expects. */
export const handleApplyEdit = (repo: string, params: unknown) =>
  applyWorkspaceEdit(repo, (params as { edit: WorkspaceEdit }).edit).then(
    (applied) => ({ applied }),
    (error: unknown) => ({ applied: false, failureReason: toGitError(error).message }),
  );

async function fetchActions(view: EditorView): Promise<CodeAction[]> {
  const plugin = LSPPlugin.get(view);
  if (!plugin?.client.serverCapabilities?.codeActionProvider) return [];
  plugin.client.sync();
  const { from, to } = view.state.selection.main;
  const range = { start: plugin.toPosition(from), end: plugin.toPosition(to) };
  const inRange = (diagnostics.get(plugin.uri) ?? []).filter(
    (d) => d.range.start.line <= range.end.line && d.range.end.line >= range.start.line,
  );
  const items = await plugin.client.request<object, (CodeAction | LspCommand)[] | null>("textDocument/codeAction", {
    textDocument: { uri: plugin.uri },
    range,
    context: { diagnostics: inRange, triggerKind: 2 },
  });
  return sortActions(items ?? []);
}

/** Runs the chosen action: resolves its edit if the server defers it, applies it, then runs its command. */
async function runAction(view: EditorView, repo: string, action: CodeAction) {
  const plugin = LSPPlugin.get(view);
  if (!plugin) return;
  const { client } = plugin;
  const provider = client.serverCapabilities?.codeActionProvider;
  const resolvable = typeof provider === "object" && provider.resolveProvider;
  const full =
    !action.edit && resolvable ? await client.request<CodeAction, CodeAction>("codeAction/resolve", action) : action;
  if (full.edit && !(await applyWorkspaceEdit(repo, full.edit))) throw new Error(getT()("codeActions.outside"));
  if (full.command)
    await client.request("workspace/executeCommand", {
      command: full.command.command,
      arguments: full.command.arguments,
    });
}

export type ActionMenu = { actions: CodeAction[]; x: number; y: number; run: (action: CodeAction) => void };

type Found = { line: number; actions: CodeAction[] };
const setFound = StateEffect.define<Found | null>();
const foundField = StateField.define<Found | null>({
  create: () => null,
  update: (found, tr) => {
    for (const effect of tr.effects) if (effect.is(setFound)) return effect.value;
    return tr.docChanged || tr.selection ? null : found;
  },
});

const ZAP =
  "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z";

class ZapMarker extends GutterMarker {
  constructor(readonly open: () => void) {
    super();
  }
  eq() {
    return true;
  }
  toDOM() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-action-zap";
    button.setAttribute("aria-label", getT()("codeActions.toggle"));
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ZAP);
    svg.append(path);
    const tip = document.createElement("span");
    tip.className = "cm-action-tip";
    const kbd = document.createElement("kbd");
    kbd.textContent = "⌘;";
    tip.append(getT()("codeActions.toggle"), kbd);
    button.append(svg, tip);
    button.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.open();
    });
    return button;
  }
}

type Options = { repo: string; openMenu: (menu: ActionMenu) => void };

function openMenu(view: EditorView, options: Options, actions: CodeAction[]) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const coords = view.coordsAtPos(line.from) ?? view.coordsAtPos(view.state.selection.main.head);
  if (!coords || actions.length === 0) return;
  options.openMenu({
    actions,
    x: coords.left,
    y: coords.bottom + 2,
    run: (action) =>
      void runAction(view, options.repo, action).catch((error: unknown) =>
        useNoticesStore
          .getState()
          .notify({ tone: "error", title: getT()("codeActions.failed"), detail: toGitError(error).message }),
      ),
  });
}

/** ⚡ for the cursor line, asked once the cursor rests; ⌘; opens the list (asking right away if needed). */
export function codeActions(options: Options): Extension {
  const show = async (view: EditorView) => {
    const found = view.state.field(foundField);
    openMenu(view, options, found ? found.actions : await fetchActions(view).catch(() => []));
  };
  const watcher = ViewPlugin.define((view) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let seq = 0;
    const ask = async () => {
      const id = ++seq;
      const doc = view.state.doc;
      const selection = view.state.selection;
      const actions = await fetchActions(view).catch(() => []);
      if (id !== seq || view.state.doc !== doc || !view.state.selection.eq(selection) || actions.length === 0) return;
      view.dispatch({ effects: setFound.of({ line: doc.lineAt(selection.main.head).from, actions }) });
    };
    return {
      update(update: ViewUpdate) {
        if (!update.docChanged && !update.selectionSet && !update.focusChanged) return;
        clearTimeout(timer);
        seq++;
        if (update.view.hasFocus) timer = setTimeout(() => void ask(), 350);
      },
      destroy: () => clearTimeout(timer),
    };
  });
  return [
    foundField,
    watcher,
    gutter({
      class: "cm-action-gutter",
      markers: (view) => {
        const found = view.state.field(foundField);
        return found ? RangeSet.of([new ZapMarker(() => void show(view)).range(found.line)]) : RangeSet.empty;
      },
    }),
    keymap.of([{ key: "Mod-;", preventDefault: true, run: (view) => (void show(view), true) }]),
    actionTheme,
  ];
}

const actionTheme = EditorView.baseTheme({
  ".cm-action-gutter": { width: "16px" },
  ".cm-action-zap": {
    position: "relative",
    display: "grid",
    placeItems: "center",
    width: "16px",
    height: "100%",
    padding: "0",
    border: "none",
    background: "transparent",
    color: "rgb(250 204 21 / 0.85)",
    cursor: "pointer",
  },
  ".cm-action-zap svg": { width: "11px", height: "11px", fill: "currentColor" },
  ".cm-action-zap:hover": { color: "rgb(250 204 21)" },
  ".cm-action-tip": {
    display: "none",
    position: "absolute",
    left: "20px",
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: "20",
    whiteSpace: "nowrap",
    alignItems: "center",
    gap: "6px",
    padding: "4px 8px",
    borderRadius: "6px",
    background: "var(--foreground)",
    color: "var(--background)",
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
    lineHeight: "1.4",
  },
  ".cm-action-zap:hover .cm-action-tip": { display: "flex" },
  ".cm-action-tip kbd": { fontFamily: "var(--font-sans)", opacity: "0.6" },
});
