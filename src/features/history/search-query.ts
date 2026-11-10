import type { HistorySearch } from "@/types/git";

type Field = Exclude<keyof HistorySearch, "regex">;

/** Token keys accepted in the search box, e.g. `author:mat file:src/x.ts since:2024-01-01 "text"`. */
const KEYS: Record<string, Field> = {
  author: "author",
  file: "path",
  path: "path",
  content: "content",
  code: "content",
  since: "since",
  after: "since",
  until: "until",
  before: "until",
  message: "message",
  msg: "message",
};

const FIELD_ORDER: Field[] = ["author", "path", "content", "since", "until"];
const TOKEN = /(\w+):"([^"]*)"|(\w+):(\S+)|"([^"]*)"|(\S+)/g;

export function parseHistoryQuery(text: string): HistorySearch {
  const search: HistorySearch = {};
  const free: string[] = [];
  for (const [, quotedKey, quotedValue, key, value, quoted, word] of text.matchAll(TOKEN)) {
    const name = (quotedKey ?? key)?.toLowerCase();
    const field = name ? KEYS[name] : undefined;
    const fieldValue = quotedValue ?? value ?? "";
    if (name === "is" && fieldValue === "regex") search.regex = true;
    else if (field) search[field] = fieldValue;
    else free.push(quoted ?? word ?? `${quotedKey ?? key}:${fieldValue}`);
  }
  const message = [search.message, ...free].filter(Boolean).join(" ").trim();
  if (message) search.message = message;
  else delete search.message;
  return search;
}

const quote = (value: string) => (/[\s:"]/.test(value) ? `"${value.replaceAll('"', "")}"` : value);

/** Inverse of parseHistoryQuery, so the filter form and the text box edit the same thing. */
export function formatHistoryQuery(search: HistorySearch): string {
  const tokens = FIELD_ORDER.filter((f) => search[f]).map(
    (f) => `${f === "path" ? "file" : f}:${quote(search[f] ?? "")}`,
  );
  if (search.regex) tokens.push("is:regex");
  if (search.message) tokens.push(quote(search.message));
  return tokens.join(" ");
}

export const isEmptySearch = (search: HistorySearch) =>
  !search.message && !search.author && !search.path && !search.content && !search.since && !search.until;
