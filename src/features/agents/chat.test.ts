import { describe, expect, it } from "vitest";
import type { AgentStep } from "@/types/git";
import { countByCategory, shorten, toChat } from "./steps-model";

const step = (kind: AgentStep["kind"], title: string, detail: string | null = null): AgentStep => ({
  kind,
  title,
  detail,
  at: null,
});

describe("toChat", () => {
  it("folds consecutive tool calls into one group with their results", () => {
    const items = toChat([step("tool", "Read · a.ts"), step("tool-result", "ok"), step("tool", "Bash · ls")], null);
    expect(items.map((i) => i.type)).toEqual(["tools"]);
  });

  it("merges identical consecutive calls", () => {
    const items = toChat([step("tool", "Bash · ls"), step("tool", "Bash · ls")], null);
    expect(items[0].type === "tools" && items[0].calls[0].repeat).toBe(2);
  });

  it("marks a call failed when an error follows it", () => {
    const items = toChat([step("tool", "Read · x"), step("error", "denied")], null);
    expect(items[0].type === "tools" && countByCategory(items[0].calls).failed).toBe(1);
  });

  it("drops session info lines", () => {
    expect(toChat([step("info", "Session started")], null)).toEqual([]);
  });
});

describe("shorten", () => {
  it("makes paths relative to the repository and drops a leading cd", () => {
    expect(shorten("cd /r/repo && git show /r/repo/a.ts", "/r/repo")).toBe("git show a.ts");
  });
});
