import { describe, expect, it } from "vitest";
import {
  advance,
  buildPrompt,
  canTrigger,
  cleanAnswer,
  DEFAULT_EXCLUDED,
  ghostOfItem,
  isExcluded,
  nextWord,
  predictsFor,
} from "./inline-completion-logic";

describe("canTrigger", () => {
  it("asks at a line end or before closing brackets", () => {
    expect(canTrigger("")).toBe(true);
    expect(canTrigger("  )];")).toBe(true);
    expect(canTrigger(" )}")).toBe(true);
  });

  it("asks inside a string or call that auto-closing finished", () => {
    expect(canTrigger('"')).toBe(true);
    expect(canTrigger("');")).toBe(true);
    expect(canTrigger("`,")).toBe(true);
  });

  it("stays quiet in the middle of code", () => {
    expect(canTrigger("foo)")).toBe(false);
  });
});

describe("buildPrompt", () => {
  it("frames the cursor with a bounded window", () => {
    const prompt = buildPrompt("a.ts", "TypeScript", "x".repeat(7000), "y".repeat(3000));
    expect(prompt).toBe(`File: a.ts\nLanguage: TypeScript\n\n${"x".repeat(6000)}<CURSOR>${"y".repeat(2000)}`);
  });
});

describe("cleanAnswer", () => {
  it("removes Markdown fences", () => {
    expect(cleanAnswer("```ts\na + b;\n```", "", "")).toBe("a + b;");
  });

  it("drops an echoed line start", () => {
    expect(cleanAnswer("return a + b;", "    return ", "")).toBe("a + b;");
  });

  it("drops an echoed closing line", () => {
    expect(cleanAnswer("\n  return 1;\n}", "", "\n}\n")).toBe("\n  return 1;");
  });

  it("turns blank answers into nothing", () => {
    expect(cleanAnswer("  \n ", "", "")).toBe("");
  });
});

describe("advance", () => {
  it("keeps the rest of the ghost when typing follows it", () => {
    expect(advance("hello()", "he")).toBe("llo()");
  });

  it("cancels on a different character", () => {
    expect(advance("hello()", "x")).toBeNull();
  });

  it("ends once everything was typed", () => {
    expect(advance("ab", "ab")).toBeNull();
  });
});

describe("nextWord", () => {
  it("takes leading whitespace and one word", () => {
    expect(nextWord("  foo.bar()")).toBe("  foo");
  });

  it("takes a run of punctuation", () => {
    expect(nextWord(".bar()")).toBe(".");
  });
});

describe("ghostOfItem", () => {
  it("shows what follows the text already typed", () => {
    expect(ghostOfItem("const x = 1;", "const x")).toBe(" = 1;");
  });

  it("refuses items that rewrite typed text", () => {
    expect(ghostOfItem("let y", "const")).toBeNull();
  });
});

describe("isExcluded", () => {
  it("matches file names in any folder", () => {
    expect(isExcluded("config/.env.local", DEFAULT_EXCLUDED)).toBe(true);
  });

  it("matches key files", () => {
    expect(isExcluded("certs/server.pem", DEFAULT_EXCLUDED)).toBe(true);
  });

  it("matches secrets folders at any depth", () => {
    expect(isExcluded("app/secrets/db.json", DEFAULT_EXCLUDED)).toBe(true);
  });

  it("matches a top-level secrets folder", () => {
    expect(isExcluded("secrets/db.json", DEFAULT_EXCLUDED)).toBe(true);
  });

  it("leaves ordinary code alone", () => {
    expect(isExcluded("src/environment.ts", DEFAULT_EXCLUDED)).toBe(false);
  });

  it("keeps single stars within one folder", () => {
    expect(isExcluded("src/a/b.ts", ["src/*.ts"])).toBe(false);
  });

  it("treats dots literally", () => {
    expect(isExcluded("akey", ["*.key"])).toBe(false);
  });
});

describe("predictsFor", () => {
  const scope = { enabled: true, disabledFiles: ["file:///r/a.ts"], disabledLanguages: ["Go"], excluded: [".env*"] };
  const file = (uri: string, path: string, languageName = "TypeScript") => ({ uri, path, languageName });

  it("allows ordinary files", () => {
    expect(predictsFor(scope, file("file:///r/b.ts", "b.ts"))).toBe(true);
  });

  it("skips files turned off", () => {
    expect(predictsFor(scope, file("file:///r/a.ts", "a.ts"))).toBe(false);
  });

  it("skips languages turned off", () => {
    expect(predictsFor(scope, file("file:///r/m.go", "m.go", "Go"))).toBe(false);
  });

  it("skips excluded files", () => {
    expect(predictsFor(scope, file("file:///r/.env", ".env"))).toBe(false);
  });

  it("skips everything when disabled", () => {
    expect(predictsFor({ ...scope, enabled: false }, file("file:///r/b.ts", "b.ts"))).toBe(false);
  });
});
