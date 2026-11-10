import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CaseSensitive, ChevronRight, Regex } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { FileIcon } from "@/components/file-icon";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";
import type { SearchMatch } from "@/types/git";

/** Where the query sits in a result line, to highlight it (null when the pattern can't be re-applied). */
function matchRange(text: string, query: string, regex: boolean, caseSensitive: boolean): [number, number] | null {
  try {
    const pattern = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "" : "i");
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

/** ⇧⌘F: every matching line of the project, grouped by file; a click opens it there. */
export function SearchPanel({ repoPath }: { repoPath: string }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const deferred = useDeferredValue(query.trim());
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const search = useQuery({
    queryKey: ["search", repoPath, deferred, regex, caseSensitive],
    queryFn: () => gitBackend.searchFiles(repoPath, deferred, regex, caseSensitive),
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-2 pb-1.5">
        <div className="flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] pr-1 focus-within:border-primary/60">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("editor.searchPlaceholder")}
            aria-label={t("editor.searchPlaceholder")}
            className="h-7 min-w-0 flex-1 bg-transparent px-2 text-[12.5px] outline-none placeholder:text-muted-foreground"
          />
          <Toggle label={t("editor.matchCase")} on={caseSensitive} onClick={() => setCaseSensitive((v) => !v)}>
            <CaseSensitive aria-hidden className="size-4" />
          </Toggle>
          <Toggle label={t("editor.useRegex")} on={regex} onClick={() => setRegex((v) => !v)}>
            <Regex aria-hidden className="size-3.5" />
          </Toggle>
        </div>
        <p className="mt-1.5 flex h-4 items-center gap-1.5 px-0.5 text-[11.5px] text-muted-foreground">
          {search.isFetching && <BrailleLoader className="text-primary" />}
          {search.isError
            ? toGitError(search.error).message
            : deferred.length >= 2 && search.data
              ? t(search.data.truncated ? "editor.resultsTruncated" : "editor.results", { count, files: groups.length })
              : null}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 font-mono text-[12px]">
        {groups.map(([path, matches]) => {
          const open = !closed.has(path);
          const slash = path.lastIndexOf("/");
          return (
            <div key={path}>
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
              {open &&
                matches.map((m) => {
                  const text = m.text.trimStart();
                  const range = matchRange(text, deferred, regex, caseSensitive);
                  return (
                    <button
                      key={`${m.line}:${m.column}`}
                      type="button"
                      onClick={() => openAt(repoPath, m.path, m.line, m.column)}
                      className="flex h-[22px] w-full items-center gap-2 rounded-md pr-1.5 pl-7 text-left hover:bg-white/[0.05]"
                    >
                      <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">{m.line}</span>
                      <span className="min-w-0 truncate whitespace-pre text-foreground/80">
                        {range ? (
                          <>
                            {text.slice(0, range[0])}
                            <mark className="rounded-[2px] bg-amber-400/30 text-foreground">
                              {text.slice(range[0], range[1])}
                            </mark>
                            {text.slice(range[1])}
                          </>
                        ) : (
                          text
                        )}
                      </span>
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
