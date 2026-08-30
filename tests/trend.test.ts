import { describe, expect, it } from "vitest";
import { pointCount, runsOf } from "../src/lib/trend";
import { monthSoFar } from "../src/lib/dates";

/**
 * The bug this exists to prevent: the first version of this logic was a clever
 * one-liner inside the chart component, and it drew nothing at all. Nothing
 * caught it but a screenshot.
 */
describe("splitting a series into drawable runs", () => {
  it("keeps an unbroken series as one run", () => {
    expect(runsOf([10, 20, 30])).toEqual([[
      { index: 0, value: 10 }, { index: 1, value: 20 }, { index: 2, value: 30 },
    ]]);
  });

  it("breaks the line where a day had nothing scheduled", () => {
    const runs = runsOf([10, null, 30, 40]);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual([{ index: 0, value: 10 }]);
    expect(runs[1]).toEqual([{ index: 2, value: 30 }, { index: 3, value: 40 }]);
  });

  it("keeps the x positions of the original series, so gaps stay gaps", () => {
    // The 40 belongs on day 5, not day 2 — a run must not be re-indexed, or
    // the line would slide left across the days it skipped.
    expect(runsOf([10, null, null, null, 40])[1]).toEqual([{ index: 4, value: 40 }]);
  });

  it("handles a series that begins or ends with a gap", () => {
    expect(runsOf([null, 10])).toEqual([[{ index: 1, value: 10 }]]);
    expect(runsOf([10, null])).toEqual([[{ index: 0, value: 10 }]]);
    expect(runsOf([null, null])).toEqual([]);
  });

  it("treats zero as a real value, not a gap", () => {
    // A day where everything was missed is 0%, and that is the point of the
    // chart. Only "nothing was scheduled" is absent.
    expect(runsOf([0, 0])).toEqual([[{ index: 0, value: 0 }, { index: 1, value: 0 }]]);
    expect(pointCount(runsOf([0, 0]))).toBe(2);
  });

  it("counts how much of the series is real", () => {
    expect(pointCount(runsOf([1, null, 2, 3]))).toBe(3);
    expect(pointCount(runsOf([]))).toBe(0);
    expect(pointCount(runsOf([null]))).toBe(0);
  });

  it("says there is not enough to draw when there is one point or none", () => {
    expect(pointCount(runsOf([50]))).toBeLessThan(2);
    expect(pointCount(runsOf([null, 50]))).toBeLessThan(2);
  });
});

/**
 * The window the chart and the month-to-date figure share. It is derived from
 * the date, so it rolls into a new month with no reset step anywhere.
 */
describe("this month so far", () => {
  it("is every day from the 1st up to today", () => {
    expect(monthSoFar("2026-08-30")).toHaveLength(30);
    expect(monthSoFar("2026-08-30")[0]).toBe("2026-08-01");
    expect(monthSoFar("2026-08-30")[29]).toBe("2026-08-30");
  });

  it("is a single day on the 1st, which is why the chart holds off", () => {
    expect(monthSoFar("2026-09-01")).toEqual(["2026-09-01"]);
    expect(pointCount(runsOf([50]))).toBeLessThan(2);
  });

  it("rolls into the new month on its own", () => {
    // The last day of August, then the first of September: the window resets
    // because it is computed from the date, not carried over.
    expect(monthSoFar("2026-08-31")).toHaveLength(31);
    expect(monthSoFar("2026-09-01")).toHaveLength(1);
    expect(monthSoFar("2026-09-01")[0]).toBe("2026-09-01");
  });

  it("crosses a year without losing the month", () => {
    expect(monthSoFar("2026-12-31")).toHaveLength(31);
    expect(monthSoFar("2027-01-05")).toEqual([
      "2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04", "2027-01-05",
    ]);
  });

  it("handles February, leap year included", () => {
    expect(monthSoFar("2026-02-28")).toHaveLength(28);
    expect(monthSoFar("2028-02-29")).toHaveLength(29);
    expect(monthSoFar("2028-02-29")[28]).toBe("2028-02-29");
  });
});
