import { Editor } from "@tiptap/react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { descriptionExtensions } from "./IssueDescriptionEditor";
import { useAutosave } from "./use-update-issue";

const roundTrip = (markdown: string) => {
  const editor = new Editor({
    extensions: descriptionExtensions(undefined, (key) => key),
    content: markdown,
    contentType: "markdown",
  });
  const out = editor.getMarkdown();
  editor.destroy();
  return out;
};

describe("description editor", () => {
  it("keeps Linear's Markdown as it is", () => {
    const text = [
      "## Steps",
      "",
      "- [ ] write **the** test",
      "- [x] see [the doc](https://linear.app/x)",
      "",
      "1. one",
      "2. `two`",
      "",
      "![shot](https://uploads.linear.app/a/b.png)",
    ].join("\n");
    expect(roundTrip(text)).toBe(text);
  });

  it("keeps quotes, code with its language, dividers and nested lists", () => {
    const text = [
      "> a quote",
      "",
      "```ts",
      "const a: Vec<String> = [];",
      "```",
      "",
      "---",
      "",
      "- one",
      "  - nested",
      "- two",
    ].join("\n");
    expect(roundTrip(text)).toBe(text);
  });
});

describe("useAutosave", () => {
  afterEach(() => vi.useRealTimers());

  it("saves only the last change, once typing pauses", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const { result } = renderHook(() => useAutosave("a", save));
    act(() => {
      result.current.schedule("ab");
      result.current.schedule("abc");
      vi.advanceTimersByTime(800);
    });
    expect(save.mock.calls).toEqual([["abc"]]);
  });

  it("doesn't save what is already saved", () => {
    const save = vi.fn();
    const { result } = renderHook(() => useAutosave("a", save));
    act(() => {
      result.current.schedule("a");
      result.current.flush();
    });
    expect(save).not.toHaveBeenCalled();
  });
});
