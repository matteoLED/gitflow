import { describe, expect, it } from "vitest";
import { contextWindowOf, costOf } from "./pricing";

const tokens = { input: 1_000_000, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };

describe("pricing", () => {
  it("prices a model by its family", () => {
    expect(costOf("claude-opus-4-8", tokens)).toBe(5);
  });
  it("uses the model's own cache-read price", () => {
    expect(costOf("claude-opus-5-5", { ...tokens, input: 0, cacheRead: 1_000_000 })).toBe(0.2);
  });
  it("charges 1-hour cache writes double", () => {
    expect(costOf("claude-sonnet-4-6", { ...tokens, input: 0, cacheWrite1h: 1_000_000 })).toBe(6);
  });
  it("has no price for an unknown model", () => {
    expect(costOf("gpt-5", tokens)).toBeNull();
  });
  it("gives older models a 200K window", () => {
    expect(contextWindowOf("claude-haiku-4-5-20251001")).toBe(200_000);
  });
  it("gives current models a 1M window", () => {
    expect(contextWindowOf("claude-opus-4-8")).toBe(1_000_000);
  });
});
