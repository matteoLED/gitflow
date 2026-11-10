import type { SlashCommand } from "@/types/git";

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

/** Tagged files, by the name shown in the composer. */
export type Mentions = Readonly<Record<string, string>>;

/** A file shows as its name, or its path when another tagged file already has that name. */
export function mentionName(path: string, mentions: Mentions): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return mentions[name] === undefined || mentions[name] === path ? name : path;
}

// Trailing punctuation stays out of the name: "@app.ts," tags app.ts.
const NAME = String.raw`(\S*[^\s.,;:!?)\]])`;
const TOKEN = new RegExp(String.raw`(^|\s)@` + NAME, "g");

/** The text cut into plain runs and tagged files, for drawing the chips. */
export function segments(text: string, mentions: Mentions): { text: string; path?: string }[] {
  const out: { text: string; path?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const path = mentions[m[2]];
    if (path === undefined) continue;
    const start = m.index + m[1].length;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: `@${m[2]}`, path });
    last = start + m[2].length + 1;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** What the agent gets: every chip spelled as its path, so `@` resolves from the working directory. */
export const expandMentions = (text: string, mentions: Mentions) =>
  text.replace(TOKEN, (all, space: string, name: string) =>
    mentions[name] === undefined ? all : `${space}@${mentions[name]}`,
  );

/** Where the chip right before the caret starts: backspace there removes it whole. */
export function chipBefore(text: string, caret: number, mentions: Mentions): number | null {
  const m = new RegExp(String.raw`(^|\s)@` + NAME + "$").exec(text.slice(0, caret));
  return m && mentions[m[2]] !== undefined ? caret - m[2].length - 1 : null;
}
