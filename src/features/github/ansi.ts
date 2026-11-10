/** A run of text and the SGR style it was printed with. Colors are the 0–7 ANSI palette index. */
export type AnsiSpan = { text: string; fg?: number; bg?: number; bold?: boolean; dim?: boolean };
type Style = Omit<AnsiSpan, "text">;

// eslint-disable-next-line no-control-regex
const OTHER_ESCAPES = /\x1b\[[\d;?]*[A-Za-ln-z]/g;
// eslint-disable-next-line no-control-regex
const SGR = /\x1b\[([\d;]*)m/g;

function apply(style: Style, params: string): Style {
  const codes = (params || "0").split(";").map(Number);
  let next = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c === 0) next = {};
    else if (c === 1) next.bold = true;
    else if (c === 2) next.dim = true;
    else if (c === 22) next = { ...next, bold: undefined, dim: undefined };
    else if (c === 39) next.fg = undefined;
    else if (c === 49) next.bg = undefined;
    else if (c >= 30 && c <= 37) next.fg = c - 30;
    else if (c >= 90 && c <= 97) next.fg = c - 90;
    else if (c >= 40 && c <= 47) next.bg = c - 40;
    else if (c >= 100 && c <= 107) next.bg = c - 100;
    // 256-color and truecolor (38;5;n / 38;2;r;g;b): skipped, so their numbers aren't read as codes.
    else if (c === 38 || c === 48) i += codes[i + 1] === 5 ? 2 : 4;
  }
  return next;
}

/** Splits a terminal line into styled spans, dropping escapes that aren't colors (cursor moves…). */
export function parseAnsi(line: string): AnsiSpan[] {
  const text = line.replace(OTHER_ESCAPES, "");
  const spans: AnsiSpan[] = [];
  let style: Style = {};
  let last = 0;
  for (const m of text.matchAll(SGR)) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index), ...style });
    style = apply(style, m[1]);
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last), ...style });
  return spans;
}

/** The line without any escape. */
export const stripAnsi = (line: string) =>
  parseAnsi(line)
    .map((s) => s.text)
    .join("");
