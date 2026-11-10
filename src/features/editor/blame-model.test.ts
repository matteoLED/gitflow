import { describe, expect, it } from "vitest";
import { inlineBlame, relativeTime } from "./blame-model";

const NOW = Date.UTC(2026, 0, 10);
const hunk = { startLine: 1, lines: 1, sha: "a1", author: "Ana", authorTime: NOW / 1000 - 3 * 86_400, summary: "Fix" };

describe("blame labels", () => {
  it("speaks in the largest whole unit", () => {
    expect(relativeTime(NOW / 1000 - 3 * 86_400, "en", NOW)).toBe("3 days ago");
  });

  it("names uncommitted lines instead of their placeholder author", () => {
    expect(inlineBlame({ ...hunk, sha: "0000000" }, "en", "Not committed yet")).toBe("Not committed yet");
  });

  it("joins author and a capitalized age, as Zed does", () => {
    expect(inlineBlame({ ...hunk, authorTime: Math.floor(Date.now() / 1000) - 86_400 }, "en", "")).toBe(
      "Ana, Yesterday",
    );
  });
});
