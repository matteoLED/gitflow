import { describe, expect, it } from "vitest";
import { byHour, calendar, change, peak, perDay, topAuthors } from "./activity-stats";

const now = new Date(2026, 10, 13, 15).getTime(); // a Friday
const at = (daysAgo: number, hour = 10) => ({
  at: Math.floor(new Date(2026, 10, 13 - daysAgo, hour).getTime() / 1000),
  author: daysAgo % 2 ? "Ann" : "Bob",
});

describe("activity stats", () => {
  it("counts commits per day, today last", () => {
    expect(perDay([at(0), at(0), at(2)], 3, now)).toEqual([1, 0, 2]);
  });

  it("has no change without a previous period", () => {
    expect(change(5, 0)).toBeNull();
  });

  it("lays weeks out Monday first and leaves the days to come empty", () => {
    const { columns } = calendar([at(0)], now - 7 * 86_400_000, now, now);
    expect(columns.at(-1)).toEqual([0, 0, 0, 0, 1, null, null]);
  });

  it("leaves the days before the range empty", () => {
    const { columns } = calendar([], new Date(2026, 10, 11).getTime(), now, now); // a Wednesday
    expect(columns[0].slice(0, 3)).toEqual([null, null, 0]);
  });

  it("counts commits per hour of the day", () => {
    expect(byHour([at(0, 14), at(1, 14)])[14]).toBe(2);
  });

  it("finds the busiest weekday and hour", () => {
    expect(peak([at(0, 14), at(7, 14), at(1, 9)])).toEqual([5, 14]);
  });

  it("groups authors past the top ones", () => {
    expect(topAuthors([at(0), at(2), at(1)], 1).others).toEqual({ people: 1, count: 1 });
  });
});
