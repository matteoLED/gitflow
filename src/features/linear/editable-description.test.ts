import { describe, expect, it } from "vitest";
import { editableDescription } from "./editable-description";

describe("editableDescription", () => {
  it("keeps generics in prose editable", () => {
    expect(editableDescription("Return a Vec<String> or Option<u8>.")).toBe(true);
  });

  it("ignores tags inside code", () => {
    expect(editableDescription("Use `<div>` here.\n\n```html\n<div>x</div>\n| a | b |\n```")).toBe(true);
  });

  it("keeps tables read-only", () => {
    expect(editableDescription("| a | b |\n| - | - |\n| 1 | 2 |")).toBe(false);
  });

  it("keeps raw HTML read-only", () => {
    expect(editableDescription("<details><summary>Logs</summary>…</details>")).toBe(false);
  });
});
