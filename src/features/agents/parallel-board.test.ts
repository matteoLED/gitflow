import { describe, expect, it } from "vitest";
import type { AgentRun } from "@/stores/agents-store";
import { boardRows, compareTouched, fanOutAgents, splitPatch } from "./parallel-board";

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1..2 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
 keep
--- removed line that looks like a header
+++ added line that looks like a header
diff --git a/new file.txt b/new file.txt
new file mode 100644
--- /dev/null
+++ b/new file.txt\t
@@ -0,0 +1 @@
+hi
diff --git a/old.ts b/gone.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/x.ts b/y.ts
similarity index 100%
rename from x.ts
rename to y.ts
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`;

const run = (id: string, extra: Partial<AgentRun> = {}): AgentRun => ({
  id,
  repoPath: "/r",
  agent: "claude",
  task: null,
  title: id,
  status: "done",
  steps: [],
  startedAt: "2026-01-01T00:00:00Z",
  sessionId: null,
  thread: id,
  worktree: { path: `/w/${id}`, branch: `agent/${id}` },
  ...extra,
});

describe("splitPatch", () => {
  const files = splitPatch(PATCH);

  it("finds one entry per file", () => {
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ["src/a.ts", "modified"],
      ["new file.txt", "added"],
      ["old.ts", "deleted"],
      ["y.ts", "renamed"],
      ["img.png", "modified"],
    ]);
  });

  it("counts body lines even when they look like headers", () => {
    expect([files[0].additions, files[0].deletions]).toEqual([1, 1]);
  });

  it("flags binary files and keeps rename sources", () => {
    expect([files[4].binary, files[3].previousPath]).toEqual([true, "x.ts"]);
  });

  it("returns nothing for an empty diff", () => {
    expect(splitPatch("")).toEqual([]);
  });
});

describe("boardRows", () => {
  it("keeps a group's runs adjacent and skips follow-ups and non-isolated runs", () => {
    const runs = [
      run("follow", { thread: "a", status: "running" }),
      run("b", { group: "g" }),
      run("solo"),
      run("plain", { worktree: undefined }),
      run("a", { group: "g" }),
    ];
    const rows = boardRows(runs, "/r");
    expect(rows.map((r) => [r.run.id, r.status])).toEqual([
      ["b", "done"],
      ["a", "running"],
      ["solo", "done"],
    ]);
  });
});

describe("compareTouched", () => {
  it("lists files touched by either side", () => {
    const [a, b] = [splitPatch(PATCH).slice(0, 2), splitPatch(PATCH).slice(1, 3)];
    expect(compareTouched(a, b).map((f) => [f.path, !!f.a, !!f.b])).toEqual([
      ["new file.txt", true, true],
      ["old.ts", false, true],
      ["src/a.ts", true, false],
    ]);
  });
});

describe("fanOutAgents", () => {
  it("runs Claude and Codex side by side when mixed", () => {
    expect(fanOutAgents("mixed", "codex")).toEqual(["claude", "codex"]);
  });

  it("runs the preferred agent twice", () => {
    expect(fanOutAgents("twice", "codex")).toEqual(["codex", "codex"]);
  });
});
