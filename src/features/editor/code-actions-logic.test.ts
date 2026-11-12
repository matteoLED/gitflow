import { describe, expect, it } from "vitest";
import { ChangeSet, Text } from "@codemirror/state";
import { planWorkspaceEdit, repoPathOf, sortActions, toChanges, fileUri } from "./code-actions-logic";

const REPO = "/Users/me/my repo";
const uri = (path: string) => fileUri(REPO, path);
const range = (line: number, from: number, to: number) => ({
  start: { line, character: from },
  end: { line, character: to },
});

describe("repoPathOf", () => {
  it("reads paths inside the repository", () => {
    expect(repoPathOf(REPO, uri("src/a b.ts"))).toBe("src/a b.ts");
  });

  it("refuses paths climbing out", () => {
    expect(repoPathOf(REPO, uri("src/../../etc/passwd"))).toBeNull();
  });

  it("refuses other folders", () => {
    expect(repoPathOf(REPO, "file:///etc/passwd")).toBeNull();
  });

  it("refuses encoded traversal", () => {
    expect(repoPathOf(REPO, `${uri("src")}/%2E%2E/%2E%2E/x`)).toBeNull();
  });
});

describe("sortActions", () => {
  it("puts preferred quick fixes, then quick fixes, then refactors first", () => {
    const sorted = sortActions([
      { title: "source", kind: "source.organizeImports" },
      { title: "move", kind: "refactor.move" },
      { title: "fix", kind: "quickfix" },
      { title: "best", kind: "quickfix", isPreferred: true },
    ]);
    expect(sorted.map((a) => a.title)).toEqual(["best", "fix", "move", "source"]);
  });

  it("wraps bare commands and drops disabled actions", () => {
    const sorted = sortActions([
      { title: "run", command: "x.run" },
      { title: "off", disabled: { reason: "no" } },
    ]);
    expect(sorted).toEqual([{ title: "run", command: { title: "run", command: "x.run" } }]);
  });
});

describe("planWorkspaceEdit", () => {
  it("maps document changes to file operations in order", () => {
    const ops = planWorkspaceEdit(REPO, {
      documentChanges: [
        { kind: "create", uri: uri("src/new.ts") },
        { textDocument: { uri: uri("src/new.ts") }, edits: [{ range: range(0, 0, 0), newText: "x" }] },
        { kind: "rename", oldUri: uri("a.ts"), newUri: uri("b.ts"), options: { overwrite: true } },
      ],
    });
    expect(ops).toEqual([
      { type: "create", path: "src/new.ts", overwrite: false, ignoreIfExists: false },
      { type: "edit", path: "src/new.ts", edits: [{ range: range(0, 0, 0), newText: "x" }] },
      { type: "rename", from: "a.ts", to: "b.ts", overwrite: true, ignoreIfExists: false },
    ]);
  });

  it("maps plain changes", () => {
    expect(planWorkspaceEdit(REPO, { changes: { [uri("a.ts")]: [] } })).toEqual([
      { type: "edit", path: "a.ts", edits: [] },
    ]);
  });

  it("rejects the whole edit when one file is outside the repository", () => {
    expect(planWorkspaceEdit(REPO, { changes: { [uri("a.ts")]: [], "file:///tmp/evil": [] } })).toBeNull();
  });
});

describe("toChanges", () => {
  it("applies edits against the original text", () => {
    const doc = Text.of(["const a = 1;", "use(a);"]);
    const changes = toChanges(doc, [
      { range: range(0, 6, 7), newText: "value" },
      { range: range(1, 4, 5), newText: "value" },
    ]);
    expect(ChangeSet.of(changes, doc.length).apply(doc).toString()).toBe("const value = 1;\nuse(value);");
  });
});
