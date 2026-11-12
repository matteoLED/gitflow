import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { ask } from "@tauri-apps/plugin-dialog";
import { ChangeSet, EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";
import { Code2, FileWarning, Search, Sparkles, X } from "lucide-react";
import { FileIcon } from "@/components/file-icon";
import { EmptyState } from "@/components/states";
import { useViewSettings } from "@/stores/view-settings-store";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { invalidateRepo, repoKey } from "@/lib/git-queries";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { editorOf, useEditorStore } from "@/stores/editor-store";
import { useNoticesStore } from "@/stores/notices-store";
import { useUiStore } from "@/stores/ui-store";
import { LIGHT_SYNTAX_THEMES, useAppearance } from "@/stores/appearance-store";
import { useThemeKind } from "@/features/settings/use-apply-appearance";
import {
  editorExtensions,
  hasLongLine,
  languageFor,
  languageName,
  languageSlot,
  lspSlot,
  setCurrentSyntax,
  setLineChanges,
  syncSyntax,
} from "./codemirror";
import { loadEditorSyntaxTheme } from "./syntax-theme";
import { inlineCompletion } from "./inline-completion";
import { useCompletionStore } from "@/stores/completion-store";
import { PredictionsMenu } from "./PredictionsMenu";
import { codeActions, registerEditHost, type ActionMenu } from "./code-actions";
import { toChanges } from "./code-actions-logic";
import { CodeActionMenu } from "./CodeActionMenu";
import { fileUri, lspClient, lspLanguageOf, registerDisplay } from "./lsp";
import { selectionOf } from "./AskAgent";
import { QuickOpen } from "./QuickOpen";
import { BlameToggle, FileHistoryButton, useBlameLayer } from "./Blame";
import { blameSlot } from "./blame-cm";
import { parseConflicts } from "./conflicts";
import type { WorkingTreeEntry } from "@/types/git";

/**
 * One open file. Its EditorState (text, undo history, selection, folds) lives here while another tab is in
 * front, so switching tabs is instant and keeps everything; only one EditorView exists.
 */
type Buffer = { state: EditorState; saved: Text; mtime: number; scroll?: ReturnType<EditorView["scrollSnapshot"]> };
type Notice = "binary" | "tooLarge" | "error";

const buffers = new Map<string, Buffer>();
const keyOf = (repo: string, path: string) => `${repo}\0${path}`;
/** Buffers are replaced, never mutated: the React compiler can trust what it has seen. */
const patchBuffer = (key: string, patch: Partial<Buffer>) => {
  const buffer = buffers.get(key);
  if (buffer) buffers.set(key, { ...buffer, ...patch });
};

/** Files whose autosave failed: left to ⌘S, so a file changed on disk doesn't raise a notice every second. */
const autosaveFailed = new Set<string>();
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
/** "After delay": the chosen delay after the last keystroke. */
function scheduleAutosave(run: () => void) {
  clearTimeout(autosaveTimer);
  const { autosave, autosaveDelay } = useViewSettings.getState();
  if (autosave === "afterDelay") autosaveTimer = setTimeout(run, autosaveDelay);
}

export function useRepoFiles(repoPath: string) {
  return useQuery({
    queryKey: ["files", repoPath],
    queryFn: () => gitBackend.listFiles(repoPath),
    staleTime: 30_000,
  });
}

/**
 * The caret's place, for the status bar: kept out of the page's state so a keystroke re-renders two spans, not
 * the tabs, toolbar and menus.
 */
const useCursor = create(() => ({ line: 1, col: 1, selected: false }));
function publishCursor(state: EditorState) {
  const { head, empty } = state.selection.main;
  const line = state.doc.lineAt(head);
  useCursor.setState({ line: line.number, col: head - line.from + 1, selected: !empty });
}

function CursorPosition() {
  const t = useT();
  const line = useCursor((s) => s.line);
  const col = useCursor((s) => s.col);
  return <span className="tabular-nums">{t("editor.position", { line, col })}</span>;
}

function AskLabel() {
  const t = useT();
  const selected = useCursor((s) => s.selected);
  return <>{selected ? t("editor.askSelection") : t("editor.askAgent")}</>;
}

const isDirty = (state: EditorState, saved: Text) => state.doc.length !== saved.length || !state.doc.eq(saved);

/** Per repository, the files with unsaved edits: project replace and tree operations leave them alone. */
const unsaved = new Map<string, ReadonlySet<string>>();
export const unsavedPaths = (repo: string): ReadonlySet<string> => unsaved.get(repo) ?? new Set();

/** Above the code, as in Zed: where the file sits, and the search and AI chat toggles. */
function EditorToolbar({
  repoPath,
  path,
  view,
}: {
  repoPath: string;
  path: string;
  view: React.RefObject<EditorView | null>;
}) {
  const t = useT();
  const assistantOpen = useUiStore((s) => s.assistantOpen);
  const parts = path.split("/");
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-white/[0.06] pr-2 pl-3 text-[12px]">
      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={path}>
        {parts.slice(0, -1).map((part, i) => (
          <span key={i}>
            {part}
            <span className="mx-1 opacity-50">/</span>
          </span>
        ))}
        <span className="text-foreground">{parts[parts.length - 1]}</span>
      </span>
      <BlameToggle />
      <FileHistoryButton repoPath={repoPath} path={path} />
      <button
        type="button"
        aria-label={t("editor.find")}
        title={`${t("editor.find")} ⌘F`}
        onClick={() => view.current && openSearchPanel(view.current)}
        className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
      >
        <Search aria-hidden className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={t("editor.aiChat")}
        title={`${t("editor.aiChat")} ⌘I`}
        aria-pressed={assistantOpen}
        onClick={() => useUiStore.getState().setAssistantOpen(!assistantOpen)}
        className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-white/[0.06] hover:text-foreground aria-pressed:bg-primary/20 aria-pressed:text-primary"
      >
        <Sparkles aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}

/** A Zed-like code editor: tabs over one CodeMirror view, saved atomically with ⌘S. */
export function EditorPage({ repoPath }: { repoPath: string }) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const { tabs, active } = useEditorStore((s) => editorOf(s, repoPath));
  const { open, close } = useEditorStore.getState();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const shownRef = useRef<string | null>(null);
  const { apply: applyBlame, card: blameCard } = useBlameLayer(repoPath, active, viewRef, shownRef);
  // Edits survive leaving the page (buffers outlive it): their dots come back with it.
  const [dirty, setDirty] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        [...buffers]
          .filter(([key, b]) => key.startsWith(`${repoPath}\0`) && isDirty(b.state, b.saved))
          .map(([key]) => key.split("\0")[1]),
      ),
  );
  const [notice, setNotice] = useState<{ kind: Notice; message?: string } | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [actionMenu, setActionMenu] = useState<ActionMenu | null>(null);
  const reveal = useEditorStore((s) => s.reveal);
  // ⌘L: the selection (or the current line) goes to the chat, as a card in its composer.
  const askRef = useRef(() => {});
  useEffect(() => {
    askRef.current = () => {
      const view = viewRef.current;
      const path = shownRef.current;
      if (view && path) useUiStore.getState().askAbout(selectionOf(view, path));
    };
  });

  useEffect(() => {
    unsaved.set(repoPath, dirty);
  }, [dirty, repoPath]);

  const markDirty = useCallback((path: string, value: boolean) => {
    setDirty((d) => {
      if (d.has(path) === value) return d;
      const next = new Set(d);
      if (value) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  // The blame reloads on its own after a save (its query is invalidated): only the change marks are asked here.
  const refreshGutter = useCallback(
    (path: string) => {
      gitBackend
        .lineChanges(repoPath, path)
        .then((changes) => {
          if (shownRef.current === path) viewRef.current?.dispatch({ effects: setLineChanges.of(changes) });
        })
        .catch(() => undefined); // the gutter is a hint: no marks is a fine fallback
    },
    [repoPath],
  );

  // Read by CodeMirror's ⌘S binding and the "Overwrite" action, which outlive any one render.
  const saveRef = useRef<(force?: boolean, auto?: boolean, target?: string) => Promise<void>>(async () => undefined);
  /** Saves `target` (the file in front by default), from the view when shown, else from its buffer. */
  const save = useCallback(
    async (force = false, auto = false, target?: string) => {
      const path = target ?? shownRef.current;
      const buffer = path && buffers.get(keyOf(repoPath, path));
      if (!path || !buffer) return;
      const current = () =>
        shownRef.current === path && viewRef.current
          ? viewRef.current.state
          : (buffers.get(keyOf(repoPath, path))?.state ?? buffer.state);
      // Autosave never retries a file whose last save failed (changed on disk…): ⌘S settles it, once.
      if (auto && (autosaveFailed.has(keyOf(repoPath, path)) || !isDirty(current(), buffer.saved))) return;
      const doc = current().doc;
      try {
        const mtime = await gitBackend.writeFile(repoPath, path, doc.toString(), force ? null : buffer.mtime);
        patchBuffer(keyOf(repoPath, path), { mtime, saved: doc });
        autosaveFailed.delete(keyOf(repoPath, path));
        markDirty(path, isDirty(current(), doc));
        refreshGutter(path);
        void invalidateRepo(client, repoPath, ["working-tree", "working-diff", "blame"]);
        // A conflicted file saved without markers left: offer to mark it resolved (never done behind the user's back).
        const tree = client.getQueryData<WorkingTreeEntry[]>([...repoKey(repoPath), "working-tree"]);
        const conflicted = tree?.some((entry) => entry.path === path && entry.conflicted);
        if (conflicted && parseConflicts(doc.toString()).length === 0)
          notify({
            tone: "success",
            title: t("conflicts.fileClean", { name: path.split("/").pop() ?? path }),
            action: {
              label: t("conflicts.markResolved"),
              run: () =>
                void gitBackend.stageFiles(repoPath, [path]).finally(() => void invalidateRepo(client, repoPath)),
            },
          });
      } catch (error) {
        const e = toGitError(error);
        if (auto) autosaveFailed.add(keyOf(repoPath, path));
        notify({
          tone: "error",
          title: e.kind === "changedOnDisk" ? t("editor.changedOnDisk") : t("editor.saveFailed"),
          detail: e.message,
          action:
            e.kind === "changedOnDisk"
              ? { label: t("editor.overwrite"), run: () => void saveRef.current(true) }
              : undefined,
        });
      }
    },
    [client, markDirty, notify, refreshGutter, repoPath, t],
  );
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const stateFor = useCallback(
    (path: string, doc: string, readOnly: boolean) =>
      EditorState.create({
        doc,
        extensions: [
          editorExtensions(
            () => void saveRef.current(),
            () => askRef.current(),
            readOnly,
          ),
          blameSlot.of([]),
          codeActions({ repo: repoPath, openMenu: setActionMenu }),
          inlineCompletion({
            path,
            uri: fileUri(repoPath, path),
            languageId: lspLanguageOf(path)?.languageId ?? (languageName(path) ?? "plaintext").toLowerCase(),
            languageName: languageName(path) ?? "Plain text",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const buffer = buffers.get(keyOf(repoPath, path));
              if (buffer) markDirty(path, isDirty(update.state, buffer.saved));
              // This file, even if another tab is in front when the delay ends.
              scheduleAutosave(() => void saveRef.current(false, true, path));
            }
            // Leaving the file (another tab, another page, another app) saves it, as in Zed.
            if (update.focusChanged && !update.view.hasFocus && useViewSettings.getState().autosave !== "off")
              void saveRef.current(false, true, path);
            if (update.docChanged || update.selectionSet) publishCursor(update.state);
          }),
        ],
      }),
    [markDirty, repoPath, setActionMenu],
  );

  // The single view, created once and handed each tab's state in turn.
  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({ parent: hostRef.current });
    viewRef.current = view;
    return () => {
      const shown = shownRef.current;
      const buffer = shown && buffers.get(keyOf(repoPath, shown));
      if (buffer && shown) patchBuffer(keyOf(repoPath, shown), { state: view.state, scroll: view.scrollSnapshot() });
      view.destroy();
      viewRef.current = null;
      shownRef.current = null;
    };
  }, [repoPath]);

  // Code colors follow the syntax theme setting, like the diffs (a dark one falls back on a light interface).
  const chosen = useAppearance((st) => st.syntaxTheme);
  const kind = useThemeKind();
  const syntaxTheme = kind === "light" && !LIGHT_SYNTAX_THEMES.has(chosen) ? "github-light" : chosen;
  useEffect(() => {
    let cancelled = false;
    void loadEditorSyntaxTheme(syntaxTheme).then((syntax) => {
      if (cancelled) return;
      setCurrentSyntax(syntax);
      if (viewRef.current) syncSyntax(viewRef.current);
    });
    return () => {
      cancelled = true;
    };
  }, [syntaxTheme]);

  /** Hooks the shown file to its language server (completion, hover, diagnostics, go to definition). */
  const connectServer = useCallback(
    async (path: string) => {
      const language = lspLanguageOf(path);
      if (!language) return;
      const client = await lspClient(repoPath, language.server);
      const view = viewRef.current;
      if (!client || !view || shownRef.current !== path) return;
      view.dispatch({ effects: lspSlot.reconfigure(client.plugin(fileUri(repoPath, path), language.languageId)) });
    },
    [repoPath],
  );

  // A jump to a definition in another file: bring its tab forward, then hand back the view showing it.
  const displayed = useRef(new Map<string, (view: EditorView | null) => void>());
  useEffect(
    () =>
      registerDisplay(repoPath, (path) => {
        if (shownRef.current === path) return Promise.resolve(viewRef.current);
        return new Promise((resolve) => {
          displayed.current.set(path, resolve);
          useEditorStore.getState().open(repoPath, path);
        });
      }),
    [repoPath],
  );
  // Code action edits: the file in front through its view, other tabs in memory (left unsaved), others on disk.
  useEffect(
    () =>
      registerEditHost(repoPath, {
        editFile: async (path, edits) => {
          const view = viewRef.current;
          if (view && shownRef.current === path) {
            view.dispatch({ changes: toChanges(view.state.doc, edits), userEvent: "input.codeAction" });
            return;
          }
          const key = keyOf(repoPath, path);
          const buffer = buffers.get(key);
          if (buffer) {
            const state = buffer.state.update({ changes: toChanges(buffer.state.doc, edits) }).state;
            patchBuffer(key, { state });
            markDirty(path, isDirty(state, buffer.saved));
            return;
          }
          const file = await gitBackend.readFile(repoPath, path);
          if (file.content === null) throw new Error(t("codeActions.unreadable", { path }));
          const doc = Text.of(file.content.split("\n"));
          const next = ChangeSet.of(toChanges(doc, edits), doc.length).apply(doc).toString();
          await gitBackend.writeFile(repoPath, path, next, file.mtime);
        },
      }),
    [markDirty, repoPath, t],
  );
  const settleDisplay = useCallback((path: string) => {
    const resolve = displayed.current.get(path);
    if (!resolve) return;
    displayed.current.delete(path);
    resolve(viewRef.current);
  }, []);

  /** Selects and centers the pending place (search result, diff line) once its file is in front. */
  const applyReveal = useCallback(() => {
    const target = useEditorStore.getState().reveal;
    const view = viewRef.current;
    if (!target || !view || target.repo !== repoPath || target.path !== shownRef.current) return;
    const doc = view.state.doc;
    const line = doc.line(Math.min(Math.max(target.line, 1), doc.lines));
    const at = Math.min(line.from + Math.max(target.column - 1, 0), line.to);
    view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
    view.focus();
    useEditorStore.getState().clearReveal();
  }, [repoPath]);
  // A new place in the file already in front.
  useEffect(() => {
    if (reveal) applyReveal();
  }, [reveal, applyReveal]);

  // Bring the active tab forward: from memory when it was open before, from disk otherwise.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const previous = shownRef.current;
    const previousBuffer = previous && buffers.get(keyOf(repoPath, previous));
    if (previousBuffer && previous)
      patchBuffer(keyOf(repoPath, previous), { state: view.state, scroll: view.scrollSnapshot() });
    shownRef.current = active;
    setNotice(null);
    if (!active) return;
    const cached = buffers.get(keyOf(repoPath, active));
    if (cached) {
      view.setState(cached.state);
      // setState scrolls to the top: back to where the tab was left.
      if (cached.scroll) view.dispatch({ effects: cached.scroll });
      publishCursor(cached.state);
      syncSyntax(view);
      applyBlame();
      refreshGutter(active);
      view.focus();
      applyReveal();
      settleDisplay(active);
      return;
    }
    view.setState(EditorState.create({ doc: "" }));
    let cancelled = false;
    gitBackend
      .readFile(repoPath, active)
      .then(async (file) => {
        if (cancelled) return;
        if (file.content === null) {
          setNotice({ kind: file.tooLarge ? "tooLarge" : "binary" });
          return;
        }
        // The language goes into the stored state: a tab left before its parser loaded keeps its colors.
        const plain = stateFor(active, file.content, false);
        const language = hasLongLine(plain.doc) ? [] : await languageFor(active).catch(() => []);
        if (cancelled) return;
        const state = plain.update({ effects: languageSlot.reconfigure(language) }).state;
        buffers.set(keyOf(repoPath, active), { state, saved: state.doc, mtime: file.mtime });
        if (shownRef.current !== active) return;
        view.setState(state);
        publishCursor(state);
        syncSyntax(view);
        view.focus();
        applyBlame();
        refreshGutter(active);
        applyReveal();
        settleDisplay(active);
        await connectServer(active);
      })
      .catch((error) => !cancelled && setNotice({ kind: "error", message: toGitError(error).message }));
    return () => {
      cancelled = true;
    };
  }, [active, applyBlame, applyReveal, connectServer, refreshGutter, repoPath, settleDisplay, stateFor]);

  // Files changed on disk (an agent, a checkout): clean tabs follow, edited ones keep the user's text.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ repoPath: string; worktree: boolean }>("repo-changed", ({ payload }) => {
          if (payload.repoPath !== repoPath || !payload.worktree) return;
          void client.invalidateQueries({ queryKey: ["files", repoPath] });
          for (const [key, buffer] of buffers) {
            const [repo, path] = key.split("\0");
            if (repo !== repoPath) continue;
            const shown = shownRef.current === path ? viewRef.current : null;
            const state = shown ? shown.state : buffer.state;
            if (isDirty(state, buffer.saved)) continue;
            void gitBackend
              .readFile(repoPath, path)
              .then((file) => {
                if (file.mtime === buffer.mtime || file.content === null) return;
                patchBuffer(key, { mtime: file.mtime });
                const view = viewRef.current;
                if (shownRef.current === path && view) {
                  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: file.content } });
                  patchBuffer(key, { saved: view.state.doc });
                  markDirty(path, false);
                  applyBlame();
                  refreshGutter(path);
                } else buffers.delete(key); // reloaded from disk when brought forward
              })
              .catch(() => buffers.delete(key)); // deleted or moved: the tab shows why when opened
          }
        }),
      )
      .then((stop) => (disposed ? stop() : (unlisten = stop)))
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [applyBlame, client, markDirty, refreshGutter, repoPath]);

  const closeTab = async (path: string) => {
    const buffer = buffers.get(keyOf(repoPath, path));
    const state = shownRef.current === path && viewRef.current ? viewRef.current.state : buffer?.state;
    if (buffer && state && isDirty(state, buffer.saved)) {
      const discard = await ask(t("editor.discardConfirm", { name: path.split("/").pop() ?? path }), {
        kind: "warning",
        okLabel: t("editor.discard"),
      });
      if (!discard) return;
    }
    buffers.delete(keyOf(repoPath, path));
    markDirty(path, false);
    close(repoPath, path);
  };
  // ⌘P opens a file by name, as in Zed (the repository switcher steps aside on this page).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setQuickOpen(true);
      }
      // ⌃⌘I: edit predictions everywhere; ⌃⌘E: in this file.
      if (e.metaKey && e.ctrlKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        useCompletionStore.getState().toggleEnabled();
      }
      if (e.metaKey && e.ctrlKey && e.key.toLowerCase() === "e" && shownRef.current) {
        e.preventDefault();
        useCompletionStore.getState().toggleFile(fileUri(repoPath, shownRef.current));
      }
      if (e.metaKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "w" && shownRef.current) {
        e.preventDefault();
        void closeTab(shownRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <section aria-label={t("view.editor")} className="flex h-full min-h-0 flex-col">
      {tabs.length > 0 && (
        <div role="tablist" className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-white/[0.06]">
          {tabs.map((path) => {
            const selected = path === active;
            return (
              <div
                key={path}
                role="tab"
                aria-selected={selected}
                title={path}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    void closeTab(path);
                  }
                }}
                className={cn(
                  "group flex shrink-0 items-center gap-1.5 border-r border-white/[0.06] pr-1.5 pl-3 text-[12.5px]",
                  selected ? "bg-white/[0.04] text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <button type="button" onClick={() => open(repoPath, path)} className="flex items-center gap-1.5">
                  <FileIcon path={path} className="size-3.5" />
                  {path.split("/").pop()}
                  {/* Not saved yet: a dot by the name, as in Zed; the close button stays where it is. */}
                  {dirty.has(path) && (
                    <span
                      aria-label={t("editor.unsaved")}
                      className="size-1.5 shrink-0 rounded-full bg-foreground/70"
                    />
                  )}
                </button>
                <button
                  type="button"
                  aria-label={t("editor.closeTab")}
                  onClick={() => void closeTab(path)}
                  className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
                >
                  <X aria-hidden className={cn("size-3.5", !selected && "opacity-0 group-hover:opacity-100")} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {active && <EditorToolbar repoPath={repoPath} path={active} view={viewRef} />}
      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className={cn("absolute inset-0", (!active || notice) && "invisible")} />
        {!active && (
          <EmptyState
            icon={<Code2 />}
            title={t("editor.empty")}
            hint={t("editor.emptyHint")}
            action={{ label: t("editor.quickOpen"), shortcut: "⌘P", onClick: () => setQuickOpen(true) }}
            secondary={{
              label: t("editor.searchProject"),
              shortcut: "⇧⌘F",
              onClick: () => useEditorStore.getState().setSidebar("search"),
            }}
          />
        )}
        {active && notice && (
          <EmptyState
            icon={<FileWarning />}
            title={t(
              notice.kind === "binary"
                ? "editor.binary"
                : notice.kind === "tooLarge"
                  ? "editor.tooLarge"
                  : "editor.loadFailed",
            )}
            hint={notice.message}
          />
        )}
      </div>
      {active && !notice && (
        <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-white/[0.06] px-3 text-[11.5px] whitespace-nowrap text-muted-foreground">
          <span className="min-w-0 truncate">{active}</span>
          <button
            type="button"
            onClick={() => askRef.current()}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-white/[0.06] hover:text-foreground"
          >
            <Sparkles aria-hidden className="size-3" />
            <AskLabel />
            <kbd className="font-sans">⌘L</kbd>
          </button>
          <PredictionsMenu
            uri={fileUri(repoPath, active)}
            languageName={languageName(active) ?? "Plain text"}
            languageLabel={languageName(active) ?? t("editor.plainText")}
            view={viewRef}
          />
          <CursorPosition />
          <span>{languageName(active) ?? t("editor.plainText")}</span>
        </footer>
      )}
      {blameCard}
      {actionMenu && (
        <CodeActionMenu
          menu={actionMenu}
          onClose={() => {
            setActionMenu(null);
            viewRef.current?.focus();
          }}
        />
      )}
      <QuickOpen repoPath={repoPath} open={quickOpen} onOpenChange={setQuickOpen} />
    </section>
  );
}
