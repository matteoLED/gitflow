import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ask } from "@tauri-apps/plugin-dialog";
import { CaseSensitive, ChevronDown, ChevronRight, Regex, Replace, ReplaceAll, WholeWord } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { FileIcon } from "@/components/file-icon";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";
import { useNoticesStore } from "@/stores/notices-store";
import type { MatchOptions, SearchMatch } from "@/types/git";
import { unsavedPaths } from "./EditorPage";

/** Where the query sits in a result line, to highlight it (null when the pattern can't be re-applied). */
function matchRange(text: string, query: string, opts: MatchOptions): [number, number] | null {
  try {
    const source = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(opts.wholeWord ? `\\b(?:${source})\\b` : source, opts.caseSensitive ? "" : "i");
    const m = pattern.exec(text);
    return m && m[0] ? [m.index, m.index + m[0].length] : null;
  } catch {
    return null;
  }
}

function Toggle({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={onClick}
      className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground aria-pressed:bg-primary/25 aria-pressed:text-foreground"
    >
      {children}
    </button>
  );
}

/** Shown on hover over a result row: replaces there only. */
function HoverReplace({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="absolute top-0.5 right-1 hidden size-5 place-items-center rounded bg-popover text-muted-foreground group-hover:grid group-focus-within:grid hover:text-foreground"
    >
      <Replace aria-hidden className="size-3.5" />
    </button>
  );
}

const FIELD =
  "flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] pr-1 focus-within:border-primary/60";
const INPUT = "h-7 min-w-0 flex-1 bg-transparent px-2 text-[12.5px] outline-none placeholder:text-muted-foreground";

/** ⇧⌘F: every matching line of the project, grouped by file; a click opens it there. Replace is one toggle away. */
export function SearchPanel({ repoPath }: { repoPath: string }) {
  const t = useT();
  const client = useQueryClient();
  const notify = useNoticesStore((s) => s.notify);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [opts, setOpts] = useState<MatchOptions>({ regex: false, caseSensitive: false, wholeWord: false });
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  // Searched once typing pauses: each search is a `git grep` over the whole tree.
  const [deferred, setDeferred] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDeferred(query.trim()), 200);
    return () => clearTimeout(id);
  }, [query]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const search = useQuery({
    queryKey: ["search", repoPath, deferred, opts],
    queryFn: () => gitBackend.searchFiles(repoPath, deferred, opts),
    enabled: deferred.length >= 2,
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
  const groups = useMemo(() => {
    const byFile = new Map<string, SearchMatch[]>();
    for (const m of search.data?.matches ?? []) byFile.set(m.path, [...(byFile.get(m.path) ?? []), m]);
    return [...byFile];
  }, [search.data]);
  const openAt = useEditorStore((s) => s.openAt);
  const count = search.data?.matches.length ?? 0;
  const flip = (key: keyof MatchOptions) => setOpts((o) => ({ ...o, [key]: !o[key] }));

  /** Writes the replacement; files with unsaved edits in the editor are skipped and reported. */
  const replace = async (paths: string[] | null, line: number | null = null) => {
    const unsaved = unsavedPaths(repoPath);
    const skipped = (paths ?? groups.map(([path]) => path)).filter((p) => unsaved.has(p));
    setBusy(true);
    try {
      const done = await gitBackend.replaceInFiles(repoPath, {
        ...opts,
        query: deferred,
        replacement,
        paths,
        line,
        skip: [...unsaved],
      });
      notify({
        tone: "success",
        title: t("editor.replaceDone", { replacements: done.replacements, files: done.files }),
        detail: skipped.length ? t("editor.replaceSkipped", { files: skipped.join(", ") }) : null,
      });
    } catch (error) {
      notify({ tone: "error", title: t("editor.replaceFailed"), detail: toGitError(error).message });
    } finally {
      setBusy(false);
      void client.invalidateQueries({ queryKey: ["search", repoPath] });
    }
  };
  const replaceAll = async () => {
    const truncated = search.data?.truncated ?? false;
    const confirmed = await ask(
      t("editor.replaceAllConfirm", { count: truncated ? `${count}+` : count, files: groups.length }),
      { kind: "warning", okLabel: t("editor.replaceAll") },
    );
    // Truncated results don't list every file: let the backend find them all.
    if (confirmed) await replace(truncated ? null : groups.map(([path]) => path));
  };
  const canReplace = replaceOpen && !busy && count > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-1 px-2 pb-1.5">
        <button
          type="button"
          aria-label={t("editor.toggleReplace")}
          title={t("editor.toggleReplace")}
          aria-expanded={replaceOpen}
          onClick={() => setReplaceOpen((o) => !o)}
          className="mt-0.5 grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
        >
          <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", !replaceOpen && "-rotate-90")} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className={FIELD}>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("editor.searchPlaceholder")}
              aria-label={t("editor.searchPlaceholder")}
              className={INPUT}
            />
            <Toggle label={t("editor.matchCase")} on={opts.caseSensitive} onClick={() => flip("caseSensitive")}>
              <CaseSensitive aria-hidden className="size-4" />
            </Toggle>
            <Toggle label={t("editor.wholeWord")} on={opts.wholeWord} onClick={() => flip("wholeWord")}>
              <WholeWord aria-hidden className="size-4" />
            </Toggle>
            <Toggle label={t("editor.useRegex")} on={opts.regex} onClick={() => flip("regex")}>
              <Regex aria-hidden className="size-3.5" />
            </Toggle>
          </div>
          {replaceOpen && (
            <div className={FIELD}>
              <input
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.metaKey && canReplace) void replaceAll();
                }}
                placeholder={t("editor.replaceWith")}
                aria-label={t("editor.replaceWith")}
                className={INPUT}
              />
              <button
                type="button"
                aria-label={t("editor.replaceAll")}
                title={`${t("editor.replaceAll")} ⌘↵`}
                disabled={!canReplace}
                onClick={() => void replaceAll()}
                className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <ReplaceAll aria-hidden className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
      <p className="flex h-4 items-center gap-1.5 px-2.5 pb-1.5 text-[11.5px] text-muted-foreground">
        {(search.isFetching || busy) && <BrailleLoader className="text-primary" />}
        {search.isError
          ? toGitError(search.error).message
          : deferred.length >= 2 && search.data
            ? t(search.data.truncated ? "editor.resultsTruncated" : "editor.results", { count, files: groups.length })
            : null}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 font-mono text-[12px]">
        {groups.map(([path, matches]) => {
          const open = !closed.has(path);
          const slash = path.lastIndexOf("/");
          return (
            <div key={path}>
              <div className="group relative">
                <button
                  type="button"
                  onClick={() =>
                    setClosed((s) => (s.has(path) ? new Set([...s].filter((p) => p !== path)) : new Set([...s, path])))
                  }
                  className="flex h-6 w-full items-center gap-1.5 rounded-md px-1.5 text-left font-sans text-[12.5px] hover:bg-white/[0.05]"
                  title={path}
                >
                  <ChevronRight
                    aria-hidden
                    className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
                  />
                  <FileIcon path={path} className="size-3.5 shrink-0" />
                  <span className="shrink-0">{path.slice(slash + 1)}</span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
                    {path.slice(0, Math.max(slash, 0))}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{matches.length}</span>
                </button>
                {canReplace && <HoverReplace label={t("editor.replaceInFile")} onClick={() => void replace([path])} />}
              </div>
              {open &&
                matches.map((m) => {
                  const text = m.text.trimStart();
                  const range = matchRange(text, deferred, opts);
                  return (
                    <div key={`${m.line}:${m.column}`} className="group relative">
                      <button
                        type="button"
                        onClick={() => openAt(repoPath, m.path, m.line, m.column)}
                        className="flex h-[22px] w-full items-center gap-2 rounded-md pr-1.5 pl-7 text-left hover:bg-white/[0.05]"
                      >
                        <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">{m.line}</span>
                        <span className="min-w-0 truncate whitespace-pre text-foreground/80">
                          {range ? (
                            <>
                              {text.slice(0, range[0])}
                              <mark
                                className={cn(
                                  "rounded-[2px] bg-amber-400/30 text-foreground",
                                  replaceOpen && "bg-removed/30 line-through",
                                )}
                              >
                                {text.slice(range[0], range[1])}
                              </mark>
                              {replaceOpen && replacement && !opts.regex && (
                                <mark className="rounded-[2px] bg-added/30 text-foreground">{replacement}</mark>
                              )}
                              {text.slice(range[1])}
                            </>
                          ) : (
                            text
                          )}
                        </span>
                      </button>
                      {canReplace && (
                        <HoverReplace label={t("editor.replaceLine")} onClick={() => void replace([m.path], m.line)} />
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
