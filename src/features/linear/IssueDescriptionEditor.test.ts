import { Editor } from "@tiptap/react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { descriptionExtensions } from "./IssueDescriptionEditor";
import { imageProblem, mentionContent } from "./editor-extras";
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

describe("editor extras", () => {
  it("keeps mentions as profile links and uploaded images as Markdown images", () => {
    const text = "[@Ada Lovelace](https://linear.app/acme/profiles/ada) see ![](https://uploads.linear.app/a/b/c.png)";
    expect(roundTrip(text)).toBe(text);
  });

  it("writes an inserted mention as a profile link", () => {
    const editor = new Editor({ extensions: descriptionExtensions(undefined, (key) => key) });
    editor.commands.insertContent(mentionContent({ name: "Ada", url: "https://linear.app/acme/profiles/ada" }));
    const out = editor.getMarkdown();
    editor.destroy();
    expect(out.trim()).toBe("[@Ada](https://linear.app/acme/profiles/ada)");
  });

  it("mentions someone without a profile as plain text", () => {
    expect(mentionContent({ name: "Ada" })[0]).toEqual({ type: "text", text: "@Ada" });
  });

  it("refuses SVGs", () => {
    expect(imageProblem({ type: "image/svg+xml", size: 10 })).toBe("linear.editor.imageType");
  });

  it("refuses images over 10 MB", () => {
    expect(imageProblem({ type: "image/png", size: 10 * 1024 * 1024 + 1 })).toBe("linear.editor.imageSize");
  });

  it("takes a small WebP", () => {
    expect(imageProblem({ type: "image/webp", size: 1024 })).toBeNull();
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
