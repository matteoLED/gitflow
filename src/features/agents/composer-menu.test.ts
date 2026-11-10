import { describe, expect, it } from "vitest";
import type { SlashCommand } from "@/types/git";
import { chipBefore, complete, expandMentions, matchCommands, mentionName, segments, triggerAt } from "./composer-menu";

const command = (name: string): SlashCommand => ({
  name,
  description: "",
  argumentHint: "",
  skill: false,
  scope: "user",
});

describe("composer completion", () => {
  it("completes a slash command only while it opens the message", () => {
    expect([triggerAt("/rev", 4)?.kind, triggerAt("/review now", 11), triggerAt("hi /x", 5)]).toEqual([
      "slash",
      null,
      null,
    ]);
  });

  it("completes an @file anywhere, at the caret", () => {
    expect(triggerAt("look at @src/ap please", 15)).toEqual({ kind: "mention", query: "src/ap", start: 8 });
  });

  it("replaces the typed token and puts the caret after it", () => {
    const text = "look at @src/ap please";
    const trigger = triggerAt(text, 15);
    expect(trigger && complete(text, 15, trigger, "src/app.ts")).toEqual(["look at @src/app.ts please", 20]);
  });

  it("puts names starting with the query before those containing it", () => {
    const names = matchCommands([command("pr-review"), command("review")], "rev").map((c) => c.name);
    expect(names).toEqual(["review", "pr-review"]);
  });
});

describe("file chips", () => {
  const mentions = { "app.ts": "src/app.ts" };

  it("names a file by its basename unless another tagged file has it", () => {
    expect([mentionName("src/app.ts", {}), mentionName("lib/app.ts", mentions)]).toEqual(["app.ts", "lib/app.ts"]);
  });

  it("cuts the text around tagged files only", () => {
    expect(segments("see @app.ts and @x", mentions)).toEqual([
      { text: "see " },
      { text: "@app.ts", path: "src/app.ts" },
      { text: " and @x" },
    ]);
  });

  it("sends the full path of each chip", () => {
    expect(expandMentions("@app.ts, fix it", mentions)).toBe("@src/app.ts, fix it");
  });

  it("finds the chip right before the caret", () => {
    expect([chipBefore("see @app.ts", 11, mentions), chipBefore("see @app.t", 10, mentions)]).toEqual([4, null]);
  });
});
