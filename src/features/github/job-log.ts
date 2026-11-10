import { stripAnsi } from "./ansi";

export type LogLine = { at: number | null; text: string; error: boolean };
export type LogItem = { kind: "line"; line: LogLine } | { kind: "group"; title: LogLine; lines: LogLine[] };
export type StepLog = { items: LogItem[]; start: number | null; end: number | null };

const TIMESTAMP = /^\uFEFF?(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) ?/;
const ERROR =
  /(^|\s)(FAIL|✗|×)(\s|$)|AssertionError|^\s*(Error|error)(\[\w+\])?:|npm ERR!|ELIFECYCLE|Process completed with exit code [1-9]/;

/**
 * `gh run view --log` lines ("job<TAB>step<TAB>timestamp text") by step, with GitHub's `##[group]` folds kept
 * as groups and `##[error]` (or a line that reads like a failure) flagged.
 */
export function parseJobLog(log: string): Map<string, StepLog> {
  const steps = new Map<string, StepLog>();
  let group: Extract<LogItem, { kind: "group" }> | null = null;
  for (const raw of log.split("\n")) {
    if (!raw.trim()) continue;
    const parts = raw.split("\t");
    const name = parts.length >= 3 ? parts[1] : "";
    const rest = parts.length >= 3 ? parts.slice(2).join("\t") : raw;
    const stamp = rest.match(TIMESTAMP);
    const at = stamp ? Date.parse(stamp[1]) : null;
    let text = stamp ? rest.slice(stamp[0].length) : rest;
    const step = steps.get(name) ?? { items: [], start: at, end: at };
    if (!steps.has(name)) {
      steps.set(name, step);
      group = null;
    }
    if (at !== null) {
      step.start ??= at;
      step.end = at;
    }
    if (text.startsWith("##[endgroup]")) {
      group = null;
      continue;
    }
    const marked = text.startsWith("##[error]");
    text = text.replace(/^##\[(error|warning|notice|debug)\]/, "");
    if (text.startsWith("##[group]")) {
      group = { kind: "group", title: { at, text: text.slice(9), error: false }, lines: [] };
      step.items.push(group);
      continue;
    }
    const line = { at, text, error: marked || ERROR.test(stripAnsi(text)) };
    if (group) group.lines.push(line);
    else step.items.push({ kind: "line", line });
  }
  return steps;
}

/** "+2ms", "+1.4s", "+2min": time since the previous line. */
export function delta(ms: number): string {
  if (ms < 1000) return `+${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(1)}s`;
  return `+${Math.round(ms / 60_000)}min`;
}

/** "0s", "12s", "2min": how long a step ran. */
export function span(ms: number): string {
  return ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}min`;
}
