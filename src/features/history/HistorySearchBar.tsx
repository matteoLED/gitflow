import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FilterInput } from "@/components/layout/panel";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import type { HistorySearch } from "@/types/git";
import { useHistorySearchStore } from "./history-search-store";
import { formatHistoryQuery, isEmptySearch, parseHistoryQuery } from "./search-query";

type TextField = "message" | "author" | "path" | "content" | "since" | "until";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function Field({
  field,
  search,
  onChange,
}: {
  field: TextField;
  search: HistorySearch;
  onChange: (s: HistorySearch) => void;
}) {
  const t = useT();
  const id = useId();
  const date = field === "since" || field === "until";
  const value = search[field] ?? "";
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-[11.5px] text-muted-foreground">
        {t(`history.field.${field}`)}
      </label>
      <Input
        id={id}
        type={date ? "date" : "text"}
        value={date && !DAY.test(value) ? "" : value}
        onChange={(e) => onChange({ ...search, [field]: e.target.value })}
        className="h-7 text-[12px] md:text-[12px]"
      />
    </div>
  );
}

/** The search box (token syntax) and a form editing the same query, run by `git log` across the whole history. */
export function HistorySearchBar() {
  const t = useT();
  const regexId = useId();
  const { query, setQuery, focusRequested, focusHandled } = useHistorySearchStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const search = parseHistoryQuery(query);
  const edit = (next: HistorySearch) => setQuery(formatHistoryQuery(next));

  const clearOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !query) return;
    event.preventDefault();
    setQuery("", true);
  };

  useEffect(() => {
    if (!focusRequested) return;
    // ponytail: waits out the palette's close animation, whose focus restore would steal focus back.
    const id = setTimeout(() => {
      inputRef.current?.focus();
      focusHandled();
    }, 250);
    return () => clearTimeout(id);
  }, [focusRequested, focusHandled]);

  return (
    <>
      <FilterInput
        ref={inputRef}
        icon="search"
        label={t("history.search")}
        placeholder={t("history.searchPlaceholder")}
        value={query}
        onValueChange={setQuery}
        onKeyDown={clearOnEscape}
        className="flex-1"
      />
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("history.searchFilters")}
                className={cn("rounded-md text-muted-foreground", !isEmptySearch(search) && "text-primary")}
              >
                <SlidersHorizontal />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("history.searchFilters")}</TooltipContent>
        </Tooltip>
        <PopoverContent align="end" className="grid w-72 gap-2 p-3">
          {(["message", "author", "path", "content"] as const).map((field) => (
            <Field key={field} field={field} search={search} onChange={edit} />
          ))}
          <div className="grid grid-cols-2 gap-2">
            <Field field="since" search={search} onChange={edit} />
            <Field field="until" search={search} onChange={edit} />
          </div>
          <div className="flex items-center justify-between gap-3 pt-1">
            <label htmlFor={regexId} className="text-[12px] text-foreground/85">
              {t("history.regex")}
              <span className="block text-[11px] text-muted-foreground">{t("history.regexHint")}</span>
            </label>
            <Switch
              id={regexId}
              className="origin-right scale-[0.85]"
              checked={!!search.regex}
              onCheckedChange={(regex) => edit({ ...search, regex })}
            />
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">{t("history.searchHint")}</p>
          {query && (
            <Button variant="ghost" size="xs" className="justify-self-start" onClick={() => setQuery("", true)}>
              {t("history.clearSearch")}
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}

/** Wraps case-insensitive occurrences of `term` in <mark>. */
export function Highlight({ text, term }: { text: string; term: string | undefined }) {
  if (!term) return text;
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1 && needle; at = lower.indexOf(needle, from)) {
    parts.push(
      text.slice(from, at),
      <mark key={at} className="rounded-sm bg-primary/25 text-inherit">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return parts;
}
