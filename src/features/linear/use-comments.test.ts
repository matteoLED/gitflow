import { describe, expect, it } from "vitest";
import type { LinearComment } from "@/types/git";
import { applyComment, threads } from "./use-comments";

const comment = (id: string, createdAt: string, parent: string | null = null): LinearComment => ({
  id,
  body: id,
  createdAt,
  parent: parent ? { id: parent } : null,
  user: null,
  botActor: null,
});

const list = [comment("b", "2026-01-02"), comment("r", "2026-01-03", "a"), comment("a", "2026-01-01")];

describe("comment threads", () => {
  it("puts threads oldest first with their replies", () => {
    expect(threads(list).map((t) => [t.root.id, t.replies.map((r) => r.id)])).toEqual([
      ["a", ["r"]],
      ["b", []],
    ]);
  });

  it("shows a reply whose thread isn't loaded on its own", () => {
    expect(threads([comment("r", "2026-01-03", "gone")]).map((t) => t.root.id)).toEqual(["r"]);
  });
});

describe("applyComment", () => {
  it("adds a pending reply to its thread", () => {
    const next = applyComment(list, { kind: "create", body: "hi", parentId: "a" }, null, "2026-01-04");
    expect(threads(next)[0].replies.map((r) => r.body)).toEqual(["r", "hi"]);
  });

  it("rewrites an edited comment", () => {
    const next = applyComment(list, { kind: "update", id: "b", body: "new" }, null, "");
    expect(next.find((c) => c.id === "b")?.body).toBe("new");
  });

  it("removes a deleted thread with its replies", () => {
    expect(applyComment(list, { kind: "delete", id: "a" }, null, "").map((c) => c.id)).toEqual(["b"]);
  });
});
