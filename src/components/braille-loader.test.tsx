import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { BrailleLoader } from "./braille-loader";

const litDots = () =>
  [...screen.getByRole("status").children].filter((dot) => (dot as HTMLElement).style.opacity === "1").length;

describe("BrailleLoader", () => {
  afterEach(() => vi.useRealTimers());

  it("lights the next frame of a grid variant on each tick", () => {
    vi.useFakeTimers();
    render(<BrailleLoader variant="grid-columns" intervalMs={100} />);
    act(() => vi.advanceTimersByTime(100));
    expect(litDots()).toBe(10);
  });

  it("cycles braille characters for text variants", () => {
    vi.useFakeTimers();
    render(<BrailleLoader variant="orbit" intervalMs={50} />);
    act(() => vi.advanceTimersByTime(50));
    expect(screen.getByRole("status")).toHaveTextContent("⠙");
  });
});
