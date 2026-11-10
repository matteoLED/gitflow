import type { LinearState, SlashCommand } from "@/types/git";

/** What the caret is completing: a `/command` opening the message, or an `@file` anywhere. */
export type Trigger = { kind: "slash" | "mention"; query: string; start: number };

export function triggerAt(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret);
  const slash = /^\/([\w:.-]*)$/.exec(before);
  if (slash) return { kind: "slash", query: slash[1], start: 0 };
  const mention = /(^|\s)@([^\s@]*)$/.exec(before);
  if (mention) return { kind: "mention", query: mention[2], start: caret - mention[2].length - 1 };
  return null;
}

/** The text once the trigger is completed with `value`, and where the caret goes. */
export function complete(text: string, caret: number, trigger: Trigger, value: string): [string, number] {
  const insert = `${trigger.kind === "slash" ? "/" : "@"}${value} `;
  const rest = text.slice(caret).replace(/^\S*/, "").replace(/^ /, "");
  const next = text.slice(0, trigger.start) + insert + rest;
  return [next, trigger.start + insert.length];
}

/** Names starting with the query first, then those containing it. */
export function matchCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase();
  const starts = commands.filter((c) => c.name.toLowerCase().startsWith(q));
  const contains = commands.filter((c) => !starts.includes(c) && c.name.toLowerCase().includes(q));
  return [...starts, ...contains];
}

/** Something tagged with `@`: a file of the repository, a pull request or a Linear issue. */
export type Mention =
  | { kind: "file"; path: string }
  | { kind: "pr"; number: number; title: string; url: string; state: "OPEN" | "MERGED" | "CLOSED"; isDraft: boolean }
  | { kind: "issue"; identifier: string; title: string; url: string; color: string; stateType: LinearState["type"] };

/** Tagged items, by the name shown in the composer. */
export type Mentions = Readonly<Record<string, Mention>>;

const NBSP = " ";
const MAX_TITLE = 48;

const sameMention = (a: Mention, b: Mention) => JSON.stringify(a) === JSON.stringify(b);

/** A title as one token: its spaces become non-breaking ones, so it reads as typed but stays one chip. */
function titleName(title: string): string {
  const short = title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1).trimEnd()}…` : title;
  return short
    .trim()
    .replace(/[.,;:!?)\]]+$/, "")
    .replace(/[ \t\n]+/g, NBSP);
}

/**
 * How a tagged item reads in the composer: a file by its name, a pull request or an issue by its title.
 * Falls back to the path, `#number` or the issue identifier when another tagged item already has that name.
 */
export function mentionName(mention: Mention, mentions: Mentions): string {
  const [preferred, fallback] =
    mention.kind === "file"
      ? [mention.path.slice(mention.path.lastIndexOf("/") + 1), mention.path]
      : mention.kind === "pr"
        ? [titleName(mention.title), `#${mention.number}`]
        : [titleName(mention.title), mention.identifier];
  const taken = mentions[preferred];
  return preferred && (!taken || sameMention(taken, mention)) ? preferred : fallback;
}

// Names run to the next plain space or line break (titles hold non-breaking ones); trailing punctuation stays
// out: "@app.ts," tags app.ts.
const NAME = String.raw`([^ \t\n@]*[^ \t\n@.,;:!?)\]])`;
const TOKEN = new RegExp(String.raw`(^|[ \t\n])@` + NAME, "g");

/** The text cut into plain runs and tagged items, for drawing the chips. */
export function segments(text: string, mentions: Mentions): { text: string; mention?: Mention }[] {
  const out: { text: string; mention?: Mention }[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const mention = mentions[m[2]];
    if (mention === undefined) continue;
    const start = m.index + m[1].length;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: `@${m[2]}`, mention });
    last = start + m[2].length + 1;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** What the agent reads for a chip: a file as `@path` (resolved from the working directory), the rest spelled out. */
function spelled(mention: Mention): string {
  if (mention.kind === "file") return `@${mention.path}`;
  if (mention.kind === "pr") return `pull request #${mention.number} "${mention.title}" (${mention.url})`;
  return `Linear issue ${mention.identifier} "${mention.title}" (${mention.url})`;
}

export const expandMentions = (text: string, mentions: Mentions) =>
  text.replace(TOKEN, (all, space: string, name: string) =>
    mentions[name] === undefined ? all : `${space}${spelled(mentions[name])}`,
  );

/** Where the chip right before the caret starts: backspace there removes it whole. */
export function chipBefore(text: string, caret: number, mentions: Mentions): number | null {
  const m = new RegExp(String.raw`(^|[ \t\n])@` + NAME + "$").exec(text.slice(0, caret));
  return m && mentions[m[2]] !== undefined ? caret - m[2].length - 1 : null;
}
