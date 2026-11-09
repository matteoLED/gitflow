import type { AgentStep } from "@/types/git";

/** What a tool call does, for icons, summaries and the graph's lanes. */
export type ToolCategory = "read" | "search" | "command" | "edit" | "web" | "other";

const CATEGORIES: Record<string, ToolCategory> = {
  Read: "read",
  NotebookRead: "read",
  Grep: "search",
  Glob: "search",
  LS: "search",
  Bash: "command",
  BashOutput: "command",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "edit",
  NotebookEdit: "edit",
  WebFetch: "web",
  WebSearch: "web",
};

export type ToolCall = {
  key: number;
  tool: string;
  category: ToolCategory;
  /** The argument, shortened: repository-relative paths, no leading `cd <repo> &&`. */
  target: string;
  detail: string | null;
  failed: boolean;
  /** Identical consecutive calls are shown once. */
  repeat: number;
};

/** "Bash · git diff a..b" → tool and argument, as the backend titles tool steps. */
export function parseTool(title: string): { tool: string; arg: string } {
  const at = title.indexOf(" · ");
  return at < 0 ? { tool: title, arg: "" } : { tool: title.slice(0, at), arg: title.slice(at + 3) };
}

export function categoryOf(tool: string): ToolCategory {
  return CATEGORIES[tool] ?? (tool.startsWith("mcp__") ? "web" : "other");
}

export function shorten(arg: string, root: string | null): string {
  let text = arg.trim();
  if (root) {
    const prefix = root.endsWith("/") ? root : `${root}/`;
    text = text.replace(new RegExp(`^cd ${escape(root)}/? *(&&|;) *`), "");
    text = text.split(prefix).join("");
    if (text === `cd ${root}`) text = "cd .";
  }
  return text;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type ChatItem =
  | { type: "prompt"; key: number; text: string }
  | { type: "message"; key: number; text: string }
  | { type: "thinking"; key: number; step: AgentStep }
  | { type: "tools"; key: number; calls: ToolCall[] }
  | { type: "result"; key: number; text: string; failed: boolean }
  | { type: "error"; key: number; step: AgentStep };

/**
 * The transcript as a reader wants it: consecutive tool calls folded into one group (with their result
 * attached and identical repeats merged), text and errors between them.
 */
export function toChat(steps: AgentStep[], root: string | null): ChatItem[] {
  const items: ChatItem[] = [];
  const lastGroup = () => {
    const last = items[items.length - 1];
    return last?.type === "tools" ? last : null;
  };
  steps.forEach((step, key) => {
    const group = lastGroup();
    const lastCall = group?.calls[group.calls.length - 1];
    switch (step.kind) {
      case "tool": {
        const { tool, arg } = parseTool(step.title);
        const call: ToolCall = {
          key,
          tool,
          category: categoryOf(tool),
          target: shorten(arg, root),
          detail: step.detail,
          failed: false,
          repeat: 1,
        };
        if (group) group.calls.push(call);
        else items.push({ type: "tools", key, calls: [call] });
        return;
      }
      case "tool-result":
      case "error":
        if (lastCall && !lastCall.failed && step.kind === "error") {
          lastCall.failed = true;
          lastCall.detail = [lastCall.detail, step.detail ?? step.title].filter(Boolean).join("\n\n— error —\n\n");
          return;
        }
        if (lastCall && step.kind === "tool-result") {
          lastCall.detail = [lastCall.detail, step.detail].filter(Boolean).join("\n\n— output —\n\n") || null;
          return;
        }
        if (step.kind === "error") items.push({ type: "error", key, step });
        return;
      case "prompt":
        items.push({ type: "prompt", key, text: step.detail ?? step.title });
        return;
      case "message":
        items.push({ type: "message", key, text: step.detail ?? step.title });
        return;
      case "thinking":
        items.push({ type: "thinking", key, step });
        return;
      case "result":
        items.push({ type: "result", key, text: step.title, failed: /fail|error/i.test(step.title) });
        return;
      default:
        return;
    }
  });
  for (const item of items) if (item.type === "tools") item.calls = mergeRepeats(item.calls);
  return items;
}

function mergeRepeats(calls: ToolCall[]): ToolCall[] {
  const merged: ToolCall[] = [];
  for (const call of calls) {
    const last = merged[merged.length - 1];
    if (last && last.tool === call.tool && last.target === call.target && last.failed === call.failed) last.repeat++;
    else merged.push({ ...call });
  }
  return merged;
}

/** Counts per category, for a group's one-line summary and the graph header. */
export function countByCategory(calls: ToolCall[]): Record<ToolCategory, number> & { failed: number } {
  const counts = { read: 0, search: 0, command: 0, edit: 0, web: 0, other: 0, failed: 0 };
  for (const call of calls) {
    counts[call.category] += call.repeat;
    if (call.failed) counts.failed += call.repeat;
  }
  return counts;
}
