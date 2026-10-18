import { describe, expect, it } from "vitest";
import { addDays } from "../src/lib/dates";
import {
  blankHabit, dayScore, frequencyDefaults, isScheduled, sameFrequency, scheduleProblem, withScheduleVersion,
} from "../src/lib/habits";
import { dictionaries } from "../src/lib/i18n";
import { frequencyLabel } from "../src/lib/templates";
import { emptyState } from "../src/lib/types";
import type { AppState, Frequency, Habit } from "../src/lib/types";
import { parseHabit } from "../src/lib/validate";

/**
 * HT-2b. Three more ways to repeat: every N days from an anchor, N times in a
 * calendar month, and chosen days of the month. Each is a schedule version like
 * the original three, so HT-2a's rule — a day is judged by the version in force
 * on it — covers them unchanged.
 */

const base: Frequency = { mode: "daily", days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3 };
const habitWith = (f: Partial<Frequency>, over: Partial<Habit> = {}): Habit => ({
  ...blankHabit(), name: "Water the plants", startDate: "2026-09-01",
  frequency: { ...base, ...f }, ...over,
});
const state = (habits: Habit[], done: Record<string, string[]> = {}): AppState => ({
  ...emptyState(),
  habits,
  completions: Object.fromEntries(Object.entries(done).map(([d, ids]) =>
    [d, Object.fromEntries(ids.map((id) => [id, { done: true }]))])),
});
const scheduledDays = (s: AppState, h: Habit, from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isScheduled(s, h, d)) out.push(d);
  return out;
};

describe("every N days", () => {
  const h = habitWith({ mode: "every_n_days", intervalDays: 3, anchorDate: "2026-10-02" });

  it("falls on the anchor and every third day after it, and never before it", () => {
    expect(scheduledDays(state([h]), h, "2026-09-28", "2026-10-15"))
      .toEqual(["2026-10-02", "2026-10-05", "2026-10-08", "2026-10-11", "2026-10-14"]);
  });

  it("keeps its rhythm after a missed day — the next one does not move", () => {
    // Done on the 2nd, missed the 5th: the 8th is still the next one.
    const s = state([h], { "2026-10-02": [h.id] });
    expect(isScheduled(s, h, "2026-10-06")).toBe(false);
    expect(isScheduled(s, h, "2026-10-08")).toBe(true);
    expect(dayScore(s, "2026-10-05")).toMatchObject({ done: 0, total: 1 });
  });

  it("crosses a month and a daylight-saving change without drifting", () => {
    const weekly = habitWith({ mode: "every_n_days", intervalDays: 7, anchorDate: "2026-10-25" });
    // US clocks change on Nov 1 2026; the rhythm is in days, not hours.
    expect(scheduledDays(state([weekly]), weekly, "2026-10-25", "2026-11-15"))
      .toEqual(["2026-10-25", "2026-11-01", "2026-11-08", "2026-11-15"]);
  });

  it("counts from the habit's start when a version carries no anchor", () => {
    const loose = habitWith({ mode: "every_n_days", intervalDays: 2 }, { startDate: "2026-10-01" });
    expect(scheduledDays(state([loose]), loose, "2026-10-01", "2026-10-06"))
      .toEqual(["2026-10-01", "2026-10-03", "2026-10-05"]);
  });
});

describe("days of the month", () => {
  it("falls on the chosen days", () => {
    const h = habitWith({ mode: "month_days", daysOfMonth: [1, 15] });
    expect(scheduledDays(state([h]), h, "2026-10-01", "2026-10-31")).toEqual(["2026-10-01", "2026-10-15"]);
  });

  it("puts a day the month lacks on its last day, once", () => {
    const h = habitWith({ mode: "month_days", daysOfMonth: [29, 30, 31] }, { startDate: "2026-01-01" });
    expect(scheduledDays(state([h]), h, "2026-02-01", "2026-02-28")).toEqual(["2026-02-28"]);
    expect(scheduledDays(state([h]), h, "2028-02-01", "2028-02-29")).toEqual(["2028-02-29"]);   // leap year
    expect(scheduledDays(state([h]), h, "2026-04-01", "2026-04-30")).toEqual(["2026-04-29", "2026-04-30"]);
    expect(dayScore(state([h]), "2026-02-28").total).toBe(1);
  });
});

describe("N times a month", () => {
  const h = habitWith({ mode: "month_times", timesPerMonth: 2 });

  it("stays on the list until the month's count is met, like times a week", () => {
    const s = state([h], { "2026-10-03": [h.id], "2026-10-09": [h.id] });
    expect(isScheduled(s, h, "2026-10-01")).toBe(true);
    expect(isScheduled(s, h, "2026-10-05")).toBe(true);    // one of two so far
    expect(isScheduled(s, h, "2026-10-09")).toBe(true);    // done that day: it counts
    expect(isScheduled(s, h, "2026-10-10")).toBe(false);   // two of two: done for October
  });

  it("starts again on the first of the next month", () => {
    const s = state([h], { "2026-10-03": [h.id], "2026-10-09": [h.id] });
    expect(isScheduled(s, h, "2026-10-31")).toBe(false);
    expect(isScheduled(s, h, "2026-11-01")).toBe(true);
  });
});

describe("versions across the new modes", () => {
  it("judges each day by its own version: daily, then every 3 days, then days of the month", () => {
    const h = habitWith({ mode: "month_days", daysOfMonth: [20] }, {
      frequencyHistory: [
        { from: "2026-09-01", frequency: base },
        { from: "2026-10-01", frequency: { ...base, mode: "every_n_days", intervalDays: 3, anchorDate: "2026-10-01" } },
        { from: "2026-10-15", frequency: { ...base, mode: "month_days", daysOfMonth: [20] } },
      ],
    });
    const s = state([h]);
    expect(isScheduled(s, h, "2026-09-30")).toBe(true);    // daily
    expect(isScheduled(s, h, "2026-10-02")).toBe(false);   // every 3 days from the 1st
    expect(isScheduled(s, h, "2026-10-04")).toBe(true);
    expect(isScheduled(s, h, "2026-10-16")).toBe(false);   // only the 20th from the 15th
    expect(isScheduled(s, h, "2026-10-20")).toBe(true);
  });

  it("opens a version only when a mode's own setting changes", () => {
    const every = { ...base, mode: "every_n_days" as const, intervalDays: 3, anchorDate: "2026-10-01" };
    const h = habitWith(every, { frequencyHistory: [{ from: "2026-10-01", frequency: every }] });
    expect(withScheduleVersion({ ...h, name: "renamed" }, "2026-10-18").frequencyHistory).toHaveLength(1);
    expect(withScheduleVersion({ ...h, frequency: { ...every, intervalDays: 4 } }, "2026-10-18")
      .frequencyHistory).toHaveLength(2);
    expect(sameFrequency(every, { ...every, anchorDate: "2026-10-02" })).toBe(false);
    expect(sameFrequency({ ...base, mode: "month_days", daysOfMonth: [15, 1] },
      { ...base, mode: "month_days", daysOfMonth: [1, 15] })).toBe(true);
    expect(sameFrequency({ ...base, mode: "month_times", timesPerMonth: 2 },
      { ...base, mode: "month_times", timesPerMonth: 3 })).toBe(false);
  });
});

describe("the editor's rules", () => {
  it("fills in each mode's settings on the way in, and keeps what was chosen", () => {
    expect(frequencyDefaults(base, "every_n_days", "2026-10-18"))
      .toMatchObject({ mode: "every_n_days", intervalDays: 2, anchorDate: "2026-10-18" });
    expect(frequencyDefaults(base, "month_times", "2026-10-18")).toMatchObject({ timesPerMonth: 4 });
    expect(frequencyDefaults(base, "month_days", "2026-10-18")).toMatchObject({ daysOfMonth: [18] });
    const chosen = { ...base, intervalDays: 5, anchorDate: "2026-10-03" };
    expect(frequencyDefaults(frequencyDefaults(chosen, "daily", "2026-10-18"), "every_n_days", "2026-10-18"))
      .toMatchObject({ intervalDays: 5, anchorDate: "2026-10-03" });
  });

  it("says what is missing before a save is allowed", () => {
    expect(scheduleProblem({ ...base, mode: "days", days: [] })).toBe("pickWeekday");
    expect(scheduleProblem({ ...base, mode: "every_n_days", intervalDays: 1, anchorDate: "2026-10-01" })).toBe("intervalRange");
    expect(scheduleProblem({ ...base, mode: "every_n_days", intervalDays: 3 })).toBe("anchorMissing");
    expect(scheduleProblem({ ...base, mode: "month_times", timesPerMonth: 0 })).toBe("monthTimesRange");
    expect(scheduleProblem({ ...base, mode: "month_days", daysOfMonth: [] })).toBe("pickMonthDay");
    expect(scheduleProblem({ ...base, mode: "every_n_days", intervalDays: 3, anchorDate: "2026-10-01" })).toBeNull();
  });
});

describe("the server's parse", () => {
  const body = (frequency: Record<string, unknown>) => ({
    id: "11111111-2222-4333-8444-555555555555", name: "Water", description: "", category: "morning",
    type: "good", frequency: { days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3, ...frequency },
    startDate: "2026-10-01", active: true, weight: 2, goalId: null, createdAt: 1,
  });

  it("accepts each new mode with its settings, and keeps only that mode's", () => {
    expect(parseHabit(body({ mode: "every_n_days", intervalDays: 3, anchorDate: "2026-10-02", timesPerMonth: 9 })).frequency)
      .toEqual({ mode: "every_n_days", days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3, intervalDays: 3, anchorDate: "2026-10-02" });
    expect(parseHabit(body({ mode: "month_times", timesPerMonth: 4 })).frequency.timesPerMonth).toBe(4);
    expect(parseHabit(body({ mode: "month_days", daysOfMonth: [15, 1, 1, 40] })).frequency.daysOfMonth).toEqual([1, 15]);
    expect(parseHabit(body({ mode: "daily", intervalDays: 3, daysOfMonth: [2] })).frequency)
      .toEqual({ mode: "daily", days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3 });
  });

  it("anchors a rhythm without an anchor at the habit's start", () => {
    expect(parseHabit(body({ mode: "every_n_days", intervalDays: 3 })).frequency.anchorDate).toBe("2026-10-01");
  });

  it("refuses an incomplete or out-of-range setting as a 400, before Postgres sees it", () => {
    expect(() => parseHabit(body({ mode: "every_n_days", intervalDays: 1 }))).toThrow(/2 to 365/);
    expect(() => parseHabit(body({ mode: "every_n_days", intervalDays: 2.5 }))).toThrow(/whole number/);
    expect(() => parseHabit(body({ mode: "every_n_days", intervalDays: 3, anchorDate: "soon" }))).toThrow(/YYYY-MM-DD/);
    expect(() => parseHabit(body({ mode: "month_times", timesPerMonth: 32 }))).toThrow(/1 to 31/);
    expect(() => parseHabit(body({ mode: "month_days", daysOfMonth: [0, 32] }))).toThrow(/day of the month/);
    expect(() => parseHabit(body({ mode: "fortnightly" }))).toThrow(/frequency.mode must be one of/);
  });
});

describe("how a repeat reads", () => {
  const { en, zh, both } = dictionaries;
  it("in English, with ordinals", () => {
    expect(frequencyLabel({ ...base, mode: "every_n_days", intervalDays: 3 }, en)).toBe("Every 3 days");
    expect(frequencyLabel({ ...base, mode: "month_times", timesPerMonth: 4 }, en)).toBe("4× a month");
    expect(frequencyLabel({ ...base, mode: "month_days", daysOfMonth: [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31] }, en))
      .toBe("On the 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd, 23rd, 31st");
    expect(frequencyLabel(base, en)).toBe("Every day");
    expect(frequencyLabel({ ...base, mode: "times", timesPerWeek: 2 }, en)).toBe("2× a week");
  });

  it("in Chinese, and in both at once", () => {
    expect(frequencyLabel({ ...base, mode: "every_n_days", intervalDays: 3 }, zh)).toBe("每 3 天一次");
    expect(frequencyLabel({ ...base, mode: "month_times", timesPerMonth: 4 }, zh)).toBe("每月 4 次");
    expect(frequencyLabel({ ...base, mode: "month_days", daysOfMonth: [1, 15] }, zh)).toBe("每月 1、15 日");
    expect(frequencyLabel({ ...base, mode: "month_days", daysOfMonth: [1, 15] }, both)).toBe("On the 1st, 15th · 每月 1、15 日");
  });
});
