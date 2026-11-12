import { invoke } from "@tauri-apps/api/core";
import { LSPClient } from "@codemirror/lsp-client";
import type { Text } from "@codemirror/state";
import { ghostOfItem, type Suggestion, type SuggestionRequest } from "./inline-completion-logic";
import { tauriTransport } from "./lsp";

/**
 * GitHub Copilot through its official language server (as Zed does): one server for the app, spoken to
 * with the CodeMirror LSP client for its requests only (it never drives an editor view).
 */
type Position = { line: number; character: number };
type Command = { command: string; arguments?: unknown[]; title?: string };
type Item = { insertText: string | { value: string }; range?: { start: Position; end: Position }; command?: Command };
type SignIn = { status?: string; userCode?: string; verificationUri?: string; command?: Command };
export type CopilotStatus = { status: string; user?: string };

let client: Promise<LSPClient> | null = null;
/** Text last sent per document: the server gets a full-text change when it differs. */
const opened = new Map<string, { doc: Text; version: number }>();

export function copilotClient(): Promise<LSPClient> {
  client ??= invoke<string>("copilot_start")
    .then(async (id) => {
      const transport = await tauriTransport(id, () => {
        client = null;
        opened.clear();
      });
      const lsp = new LSPClient({
        initializationOptions: {
          editorInfo: { name: "gitflow", version: "0.1.0" },
          editorPluginInfo: { name: "gitflow-copilot", version: "0.1.0" },
        },
        timeout: 60_000, // the first start may download the server through npx
        unhandledNotification: () => undefined, // status and telemetry notices
      }).connect(transport);
      await lsp.initializing;
      return lsp;
    })
    .catch((error: unknown) => {
      client = null;
      throw error;
    });
  return client;
}

function sync(lsp: LSPClient, uri: string, languageId: string, doc: Text): number {
  const known = opened.get(uri);
  if (known?.doc === doc) return known.version;
  const version = (known?.version ?? 0) + 1;
  if (known)
    lsp.notification("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text: doc.toString() }],
    });
  else lsp.notification("textDocument/didOpen", { textDocument: { uri, languageId, version, text: doc.toString() } });
  opened.set(uri, { doc, version });
  return version;
}

const positionOf = (doc: Text, pos: number): Position => {
  const line = doc.lineAt(pos);
  return { line: line.number - 1, character: pos - line.from };
};
const offsetOf = (doc: Text, { line, character }: Position) => {
  const at = doc.line(Math.min(Math.max(line + 1, 1), doc.lines));
  return Math.min(at.from + character, at.to);
};

export async function copilotSuggest({
  uri,
  languageId,
  doc,
  pos,
  tabSize,
}: SuggestionRequest): Promise<Suggestion | null> {
  const lsp = await copilotClient();
  const version = sync(lsp, uri, languageId, doc);
  const result = await lsp.request<object, { items?: Item[] } | null>("textDocument/inlineCompletion", {
    textDocument: { uri, version },
    position: positionOf(doc, pos),
    context: { triggerKind: 2 },
    formattingOptions: { tabSize, insertSpaces: true },
  });
  const item = result?.items?.[0];
  if (!item || typeof item.insertText !== "string") return null;
  const from = item.range ? offsetOf(doc, item.range.start) : pos;
  let to = item.range ? Math.max(pos, offsetOf(doc, item.range.end)) : pos;
  if (from > pos) return null;
  let text = ghostOfItem(item.insertText, doc.sliceString(from, pos));
  // The item often re-types what follows the cursor (a closing bracket): show it once, not twice.
  const rest = doc.sliceString(pos, to);
  if (text && rest && text.endsWith(rest)) {
    text = text.slice(0, -rest.length);
    to = pos;
  }
  if (!text) return null;
  lsp.notification("textDocument/didShowCompletion", { item });
  const command = item.command;
  return {
    text,
    to,
    accepted: command ? () => void lsp.request("workspace/executeCommand", command).catch(() => undefined) : undefined,
  };
}

export const SIGNED_IN = new Set(["OK", "AlreadySignedIn", "MaybeOk"]);

export async function copilotStatus(): Promise<CopilotStatus> {
  return (await copilotClient()).request<object, CopilotStatus>("checkStatus", {});
}

/**
 * Starts GitHub's device flow: the code to type at the verification page, or null when already signed in.
 * The server finishes the flow on its own (newer servers through the returned command); the caller polls
 * `copilotStatus` meanwhile.
 */
export async function copilotSignIn(): Promise<{ userCode: string; verificationUri: string } | null> {
  const lsp = await copilotClient();
  const result = await lsp.request<object, SignIn>("signIn", {});
  if (!result.userCode || !result.verificationUri) return null;
  const finish = result.command
    ? lsp.request("workspace/executeCommand", result.command)
    : lsp.request("signInConfirm", { userCode: result.userCode });
  void finish.catch(() => undefined); // times out on our side while the user types the code; status polling decides
  return { userCode: result.userCode, verificationUri: result.verificationUri };
}

export async function copilotSignOut(): Promise<void> {
  await (await copilotClient()).request("signOut", {});
}
