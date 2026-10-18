import { describe, expect, it } from "vitest";
import { addDays, dow } from "../src/lib/dates";
import {
  blankHabit, dayScore, frequencyOn, isScheduled, rangeScore, sameFrequency, withScheduleVersion,
} from "../src/lib/habits";
import { emptyState } from "../src/lib/types";
import type { AppState, Frequency, Habit } from "../src/lib/types";

/**
 * HT-2a. Each day is judged by the schedule that was in force on it.
 *
 * Before this, only the newest schedule version was read, so changing a habit
 * from daily to Mondays-Wednesdays-Fridays today also made every past Tuesday
 * "not scheduled" — and every score built on those days, the Community board's
 * included, moved with it.
 */

const DAILY: Frequency = { mode: "daily", days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3 };
const MWF: Frequency = { mode: "days", days: [1, 3, 5], timesPerWeek: 3 };
const TWICE: Frequency = { mode: "times", days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 2 };

/** Daily from October 1st, then Mondays, Wednesdays and Fridays from the 12th. */
const changed = (over: Partial<Habit> = {}): Habit => ({
  ...blankHabit(), name: "Stretch", startDate: "2026-10-01",
  frequency: MWF,
  frequencyHistory: [{ from: "2026-10-01", frequency: DAILY }, { from: "2026-10-12", frequency: MWF }],
  ...over,
});

const state = (habits: Habit[], done: Record<string, string[]> = {}): AppState => ({
  ...emptyState(),
  habits,
  completions: Object.fromEntries(Object.entries(done).map(([d, ids]) =>
    [d, Object.fromEntries(ids.map((id) => [id, { done: true }]))])),
});

const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

describe("the schedule in force on a day", () => {
  it("is the habit's own frequency when there is no history (a habit not saved yet)", () => {
    const h = { ...blankHabit(), frequency: MWF };
    expect(frequencyOn(h, "2026-10-06")).toEqual(MWF);
  });

  it("runs from a version's first day until the next one starts", () => {
    const h = changed();
    expect(frequencyOn(h, "2026-10-01")).toEqual(DAILY);
    expect(frequencyOn(h, "2026-10-11")).toEqual(DAILY);
    expect(frequencyOn(h, "2026-10-12")).toEqual(MWF);
    expect(frequencyOn(h, "2026-12-31")).toEqual(MWF);
  });

  it("judges a day before the first version by the first version", () => {
    // Rows written under the old UTC rule can be dated a day after the start.
    const h = changed({ startDate: "2026-09-30" });
    expect(frequencyOn(h, "2026-09-30")).toEqual(DAILY);
    expect(isScheduled(state([h]), h, "2026-09-30")).toBe(true);
  });
});

describe("a schedule change leaves the days before it alone", () => {
  const tuesdayBefore = "2026-10-06";
  const tuesdayAfter = "2026-10-13";

  it("keeps an earlier Tuesday scheduled under the daily rule it was lived under", () => {
    expect(dow(tuesdayBefore)).toBe(2);
    expect(dow(tuesdayAfter)).toBe(2);
    const h = changed();
    const s = state([h]);
    expect(isScheduled(s, h, tuesdayBefore)).toBe(true);
    expect(isScheduled(s, h, tuesdayAfter)).toBe(false);
    expect(isScheduled(s, h, "2026-10-12")).toBe(true);   // the Monday it changed
  });

  it("scores the past the same as before the change, and the future by the new rule", () => {
    const h = changed();
    const done = { [tuesdayBefore]: [h.id], "2026-10-07": [h.id] };
    // What the account looked like on the 11th, before the change existed.
    const before = { ...h, frequency: DAILY, frequencyHistory: [{ from: "2026-10-01", frequency: DAILY }] };
    const window = days("2026-10-01", "2026-10-11");

    expect(rangeScore(state([h], done), window)).toEqual(rangeScore(state([before], done), window));
    expect(dayScore(state([h], done), tuesdayBefore).pct).toBe(100);
    expect(dayScore(state([h], done), tuesdayAfter).total).toBe(0);
  });

  it("is exactly what the old rule got wrong", () => {
    const h = changed();
    const done = { [tuesdayBefore]: [h.id] };
    const latestOnly = { ...h, frequencyHistory: undefined };
    // The old rule dropped the completed Tuesday from the score entirely.
    expect(dayScore(state([latestOnly], done), tuesdayBefore).total).toBe(0);
    expect(dayScore(state([h], done), tuesdayBefore).pct).toBe(100);
  });

  it("counts a weekly target by the version in force on the day", () => {
    // Daily until Wednesday the 14th, then twice a week.
    const h = changed({
      frequency: TWICE,
      frequencyHistory: [{ from: "2026-10-01", frequency: DAILY }, { from: "2026-10-14", frequency: TWICE }],
    });
    const s = state([h], { "2026-10-12": [h.id], "2026-10-13": [h.id] });
    expect(isScheduled(s, h, "2026-10-13")).toBe(true);    // daily then: done, so scheduled
    expect(isScheduled(s, h, "2026-10-15")).toBe(false);   // twice already this week
  });
});

describe("withScheduleVersion — the browser's copy of the server's save rule", () => {
  const today = "2026-10-18";

  it("adds nothing when the schedule did not change (the order of days aside)", () => {
    const h = changed();
    const renamed = { ...h, name: "Stretch well", frequency: { ...MWF, days: [5, 1, 3] } };
    expect(withScheduleVersion(renamed, today)).toBe(renamed);
  });

  it("starts a changed schedule today and keeps every earlier version", () => {
    const next = withScheduleVersion({ ...changed(), frequency: TWICE }, today);
    expect(next.frequencyHistory).toEqual([
      { from: "2026-10-01", frequency: DAILY },
      { from: "2026-10-12", frequency: MWF },
      { from: today, frequency: TWICE },
    ]);
  });

  it("replaces a version already made today", () => {
    const once = withScheduleVersion({ ...changed(), frequency: TWICE }, today);
    const twice = withScheduleVersion({ ...once, frequency: DAILY }, today);
    expect(twice.frequencyHistory).toHaveLength(3);
    expect(twice.frequencyHistory?.[2]).toEqual({ from: today, frequency: DAILY });
  });

  it("amends a version dated ahead of today rather than being overruled by it", () => {
    const ahead = changed({
      frequencyHistory: [{ from: "2026-10-01", frequency: DAILY }, { from: "2026-10-19", frequency: MWF }],
    });
    const next = withScheduleVersion({ ...ahead, frequency: TWICE }, today);
    expect(next.frequencyHistory).toEqual([
      { from: "2026-10-01", frequency: DAILY },
      { from: "2026-10-19", frequency: TWICE },
    ]);
  });

  it("gives a new habit its first version", () => {
    const h = { ...blankHabit(), frequency: MWF };
    expect(withScheduleVersion(h, today).frequencyHistory).toEqual([{ from: today, frequency: MWF }]);
  });
});

describe("what counts as the same schedule", () => {
  it("compares the chosen days as a set", () => {
    expect(sameFrequency(MWF, { ...MWF, days: [5, 3, 1] })).toBe(true);
    expect(sameFrequency(MWF, { ...MWF, days: [1, 3] })).toBe(false);
  });

  it("reads the weekly count only in times-per-week mode, as it is stored", () => {
    expect(sameFrequency(DAILY, { ...DAILY, timesPerWeek: 5 })).toBe(true);
    expect(sameFrequency(TWICE, { ...TWICE, timesPerWeek: 3 })).toBe(false);
    expect(sameFrequency(DAILY, TWICE)).toBe(false);
  });
});
