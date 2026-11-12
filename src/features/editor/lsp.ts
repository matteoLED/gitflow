import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  LSPClient,
  LSPPlugin,
  Workspace,
  languageServerExtensions,
  type Transport,
  type WorkspaceFile,
} from "@codemirror/lsp-client";
import type { Text } from "@codemirror/state";

type WorkspaceFileUpdate = ReturnType<Workspace["syncFiles"]>[number];
import type { EditorView } from "@codemirror/view";
import { getT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { useNoticesStore } from "@/stores/notices-store";
import { codeActionClientExtension, handleApplyEdit } from "./code-actions";
import { fileUri, repoPathOf } from "./code-actions-logic";

/** The server family a file belongs to, and the LSP language id it's opened with. */
export function lspLanguageOf(path: string): { server: string; languageId: string } | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, [string, string]> = {
    ts: ["typescript", "typescript"],
    mts: ["typescript", "typescript"],
    cts: ["typescript", "typescript"],
    tsx: ["typescript", "typescriptreact"],
    js: ["typescript", "javascript"],
    mjs: ["typescript", "javascript"],
    cjs: ["typescript", "javascript"],
    jsx: ["typescript", "javascriptreact"],
    rs: ["rust", "rust"],
    py: ["python", "python"],
    go: ["go", "go"],
  };
  const found = map[ext];
  return found ? { server: found[0], languageId: found[1] } : null;
}

export { fileUri };

/** Opens a file of the repository in the editor and resolves with the view once it shows it. */
export type DisplayFile = (path: string) => Promise<EditorView | null>;

/** Set by the editor page while it's mounted: how a jump to another file gets that file in front. */
const displayers = new Map<string, DisplayFile>();
export function registerDisplay(repo: string, display: DisplayFile) {
  displayers.set(repo, display);
  return () => void (displayers.get(repo) === display && displayers.delete(repo));
}

class EditorFile implements WorkspaceFile {
  constructor(
    readonly uri: string,
    readonly languageId: string,
    public version: number,
    public doc: Text,
    public view: EditorView,
  ) {}
  getView() {
    return this.view;
  }
}

/**
 * The editor shows one file at a time in a single view: a file is open on the server while its tab is in
 * front. Jumping to a definition elsewhere opens that file's tab.
 */
class EditorWorkspace extends Workspace {
  files: EditorFile[] = [];
  private versions: Record<string, number> = {};
  constructor(
    client: LSPClient,
    private readonly repo: string,
  ) {
    super(client);
  }
  private nextVersion(uri: string) {
    return (this.versions[uri] = (this.versions[uri] ?? -1) + 1);
  }
  syncFiles(): readonly WorkspaceFileUpdate[] {
    const updates: WorkspaceFileUpdate[] = [];
    for (const file of this.files) {
      const plugin = LSPPlugin.get(file.view);
      if (!plugin || plugin.unsyncedChanges.empty) continue;
      updates.push({ changes: plugin.unsyncedChanges, file, prevDoc: file.doc });
      file.doc = file.view.state.doc;
      file.version = this.nextVersion(file.uri);
      plugin.clear();
    }
    return updates;
  }
  openFile(uri: string, languageId: string, view: EditorView) {
    if (this.getFile(uri)) this.closeFile(uri);
    const file = new EditorFile(uri, languageId, this.nextVersion(uri), view.state.doc, view);
    this.files.push(file);
    this.client.didOpen(file);
  }
  closeFile(uri: string) {
    if (!this.getFile(uri)) return;
    this.files = this.files.filter((f) => f.uri !== uri);
    this.client.didClose(uri);
  }
  async displayFile(uri: string): Promise<EditorView | null> {
    const path = repoPathOf(this.repo, uri);
    const display = path && displayers.get(this.repo);
    return display ? display(path) : null;
  }
}

/** Answers a request the server sends us; undefined when not handled (the LSP client then refuses it). */
export type ServerRequests = (method: string, params: unknown) => Promise<unknown> | undefined;

/** Tauri events in, `lsp_send` out: the JSON-RPC stream of one server process. */
export async function tauriTransport(
  id: string,
  onExit = () => void clients.delete(id),
  onRequest?: ServerRequests,
): Promise<Transport> {
  let handlers: ((message: string) => void)[] = [];
  const send = (message: string) => void invoke("lsp_send", { id, message }).catch(() => undefined);
  /** Server-to-client requests we answer ourselves (the CodeMirror client answers every one "not found"). */
  const answered = (raw: string) => {
    if (!onRequest || !raw.includes('"method"')) return false;
    const message = JSON.parse(raw) as { id?: number | string; method?: string; params?: unknown };
    const reply = message.id !== undefined && message.method ? onRequest(message.method, message.params) : undefined;
    if (!reply) return false;
    void reply.then(
      (result) => send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result })),
      (error: unknown) =>
        send(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: String(error) } })),
    );
    return true;
  };
  await listen<{ type: "message" | "exited"; id: string; message?: string }>("lsp", ({ payload }) => {
    if (payload.id !== id) return;
    if (payload.type === "message" && payload.message && !answered(payload.message))
      for (const h of handlers) h(payload.message);
    if (payload.type === "exited") onExit();
  });
  return {
    send,
    subscribe: (handler) => void handlers.push(handler),
    unsubscribe: (handler) => void (handlers = handlers.filter((h) => h !== handler)),
  };
}

const clients = new Map<string, Promise<LSPClient | null>>();
const warned = new Set<string>();

/**
 * The client for a repository's language, started on first use and shared by every tab. Null when no server
 * is installed: the editor then works without it (the user is told once how to install one).
 */
export function lspClient(repo: string, server: string): Promise<LSPClient | null> {
  const key = `${server}:${repo}`;
  const known = clients.get(key);
  if (known) return known;
  const started = invoke<string>("lsp_start", { repoPath: repo, language: server })
    .then(async (id) => {
      const transport = await tauriTransport(id, undefined, (method, params) =>
        method === "workspace/applyEdit" ? handleApplyEdit(repo, params) : undefined,
      );
      return new LSPClient({
        rootUri: fileUri(repo, "").replace(/\/$/, ""),
        workspace: (client) => new EditorWorkspace(client, repo),
        extensions: [codeActionClientExtension, ...languageServerExtensions()],
        timeout: 10_000,
      }).connect(transport);
    })
    .catch((error) => {
      clients.delete(key);
      if (!warned.has(key)) {
        warned.add(key);
        useNoticesStore
          .getState()
          .notify({ tone: "error", title: getT()("editor.noLanguageServer"), detail: toGitError(error).message });
      }
      return null;
    });
  clients.set(key, started);
  return started;
}
