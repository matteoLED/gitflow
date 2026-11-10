import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";
import { ChevronDown, ChevronLeft, ChevronRight, Regex, Replace, ReplaceAll, WholeWord, X } from "lucide-react";
import { getT } from "@/i18n";
import { cn } from "@/lib/utils";

const MAX_COUNT = 9999;

/** "3/12": where the selection sits among the matches (counting stops at 9999). */
export function matchPosition(view: EditorView, query: SearchQuery): { index: number; total: number } {
  if (!query.valid) return { index: 0, total: 0 };
  const selection = view.state.selection.main;
  const cursor = query.getCursor(view.state);
  let total = 0;
  let index = 0;
  for (let next = cursor.next(); !next.done && total < MAX_COUNT; next = cursor.next()) {
    total++;
    if (next.value.from === selection.from && next.value.to === selection.to) index = total;
  }
  return { index, total };
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
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={onClick}
      className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-white/[0.06] hover:text-foreground aria-pressed:bg-primary/25 aria-pressed:text-foreground [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

const ICON =
  "grid size-6 place-items-center rounded text-muted-foreground hover:bg-white/[0.06] hover:text-foreground disabled:opacity-40 [&_svg]:size-3.5";
const FIELD =
  "flex h-7 min-w-0 flex-1 items-center gap-0.5 rounded-md border border-white/10 bg-white/[0.03] pr-1 focus-within:border-primary/60";
const INPUT = "h-full min-w-0 flex-1 bg-transparent px-2 font-mono text-[12.5px] outline-none placeholder:font-sans";

/** Zed's find bar: one line with the options inline, the count, and replace one click away. */
function SearchBar({ view, tick }: { view: EditorView; tick: number }) {
  const t = getT();
  const current = getSearchQuery(view.state);
  const [replaceOpen, setReplaceOpen] = useState(!!current.replace);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const update = (patch: Partial<ConstructorParameters<typeof SearchQuery>[0]>) =>
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: current.search,
          caseSensitive: current.caseSensitive,
          regexp: current.regexp,
          wholeWord: current.wholeWord,
          replace: current.replace,
          ...patch,
        }),
      ),
    });
  void tick; // re-rendered on every editor update: the count follows the selection
  const { index, total } = matchPosition(view, current);
  const onKeys = (e: React.KeyboardEvent, enter: () => void) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) findPrevious(view);
      else enter();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(view);
      view.focus();
    }
  };
  return (
    <div className="flex items-start gap-1.5 px-3 py-2 font-sans">
      <button
        type="button"
        aria-label={t("editor.toggleReplace")}
        title={t("editor.toggleReplace")}
        onClick={() => setReplaceOpen((o) => !o)}
        className={cn(ICON, "mt-0.5")}
      >
        <ChevronDown className={cn("transition-transform", !replaceOpen && "-rotate-90")} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <label className={FIELD}>
            <input
              ref={inputRef}
              main-field="true"
              value={current.search}
              onChange={(e) => update({ search: e.target.value })}
              onKeyDown={(e) => onKeys(e, () => findNext(view))}
              placeholder={t("editor.find")}
              aria-label={t("editor.find")}
              className={cn(INPUT, current.search && !current.valid && "text-removed-foreground")}
            />
            <Toggle
              label={t("editor.matchCase")}
              on={current.caseSensitive}
              onClick={() => update({ caseSensitive: !current.caseSensitive })}
            >
              <span className="text-[11px] font-semibold">Aa</span>
            </Toggle>
            <Toggle
              label={t("editor.wholeWord")}
              on={current.wholeWord}
              onClick={() => update({ wholeWord: !current.wholeWord })}
            >
              <WholeWord />
            </Toggle>
            <Toggle
              label={t("editor.useRegex")}
              on={current.regexp}
              onClick={() => update({ regexp: !current.regexp })}
            >
              <Regex />
            </Toggle>
          </label>
          <button
            type="button"
            aria-label={t("editor.previousMatch")}
            title={t("editor.previousMatch")}
            disabled={!total}
            onClick={() => findPrevious(view)}
            className={ICON}
          >
            <ChevronLeft />
          </button>
          <button
            type="button"
            aria-label={t("editor.nextMatch")}
            title={t("editor.nextMatch")}
            disabled={!total}
            onClick={() => findNext(view)}
            className={ICON}
          >
            <ChevronRight />
          </button>
          <span
            className={cn(
              "w-16 shrink-0 text-[12px] tabular-nums",
              current.search && !total ? "text-removed-foreground" : "text-muted-foreground",
            )}
          >
            {current.search ? `${index}/${total >= MAX_COUNT ? `${MAX_COUNT}+` : total}` : ""}
          </span>
        </div>
        {replaceOpen && (
          <div className="flex items-center gap-1.5">
            <label className={FIELD}>
              <input
                value={current.replace}
                onChange={(e) => update({ replace: e.target.value })}
                onKeyDown={(e) => onKeys(e, () => replaceNext(view))}
                placeholder={t("editor.replaceWith")}
                aria-label={t("editor.replaceWith")}
                className={INPUT}
              />
            </label>
            <button
              type="button"
              aria-label={t("editor.replaceNext")}
              title={t("editor.replaceNext")}
              disabled={!total}
              onClick={() => replaceNext(view)}
              className={ICON}
            >
              <Replace />
            </button>
            <button
              type="button"
              aria-label={t("editor.replaceAll")}
              title={t("editor.replaceAll")}
              disabled={!total}
              onClick={() => replaceAll(view)}
              className={ICON}
            >
              <ReplaceAll />
            </button>
            <span className="w-16 shrink-0" />
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label={t("common.close")}
        title={t("common.close")}
        onClick={() => {
          closeSearchPanel(view);
          view.focus();
        }}
        className={cn(ICON, "mt-0.5")}
      >
        <X />
      </button>
    </div>
  );
}

/** CodeMirror's search panel, drawn by React. */
export function createSearchPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  const root = createRoot(dom);
  let tick = 0;
  const render = () => root.render(<SearchBar view={view} tick={tick++} />);
  return {
    dom,
    top: true,
    mount: render,
    update: (update: ViewUpdate) => {
      if (update.docChanged || update.selectionSet || update.transactions.some((tr) => tr.effects.length)) render();
    },
    destroy: () => queueMicrotask(() => root.unmount()),
  };
}
