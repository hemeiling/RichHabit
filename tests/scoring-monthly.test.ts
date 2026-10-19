import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import { accomplishment, blankHabit, dayScore, habitStatus, monthTarget, rangeScore } from "@/lib/habits";
import { emptyState } from "@/lib/types";
import type { AppState, Frequency, Habit } from "@/lib/types";

/**
 * The scoring revision with HT-2b's repeat options: a "times a month" habit is
 * a monthly target by the same rule as a weekly one (met or month over, capped,
 * prorated by day), and "every N days" / "days of the month" are fixed-day
 * sessions — their other days are never missed. October 2026: 31 days, Thu 1st.
 */
const DAILY: Frequency = { mode: "daily", days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3 };
const habit = (id: string, f: Partial<Frequency> = {}, over: Partial<Habit> = {}): Habit => ({
  ...blankHabit(), id, name: id, startDate: "2026-09-01", weight: 1, frequency: { ...DAILY, ...f }, ...over,
});
const monthly = (n = 4, over: Partial<Habit> = {}) => habit("call", { mode: "month_times", timesPerMonth: n }, over);
const state = (habits: Habit[], done: Record<string, string[]>): AppState => {
  const s: AppState = { ...emptyState(), habits };
  s.prefs = { ...s.prefs, weighted: false };
  for (const [id, dates] of Object.entries(done)) for (const d of dates) (s.completions[d] ??= {})[id] = { done: true };
  return s;
};
const days = (a: string, b: string) => { const o: string[] = []; for (let d = a; d <= b; d = addDays(d, 1)) o.push(d); return o; };
const OCT = days("2026-10-01", "2026-10-31");

describe("a monthly target", () => {
  it("4 of 4 is 100%, counted the day the fourth session is done", () => {
    const s = state([monthly()], { call: ["2026-10-03", "2026-10-08", "2026-10-15", "2026-10-20"] });
    expect(accomplishment(s, days("2026-10-01", "2026-10-20"), "2026-10-20")).toMatchObject({ pct: 100, earned: 4, required: 4 });
    expect(habitStatus(s, s.habits[0], "2026-10-20")).toEqual({ status: "completed", done: 4, target: 4, period: "month" });
  });

  it("2 of 4 is 50% target progress — never 100% — and not scored until the month is over", () => {
    const s = state([monthly()], { call: ["2026-10-03", "2026-10-08"] });
    expect(habitStatus(s, s.habits[0], "2026-10-10")).toEqual({ status: "on_track", done: 2, target: 4, period: "month" });
    expect(accomplishment(s, days("2026-10-01", "2026-10-10"), "2026-10-10")).toMatchObject({ pct: null, open: 1 });
    expect(accomplishment(s, OCT, "2026-11-01")).toMatchObject({ pct: 50, earned: 2, required: 4 });
  });

  it("more than the target never scores over 100%", () => {
    const s = state([monthly()], { call: ["2026-10-02", "2026-10-05", "2026-10-09", "2026-10-12", "2026-10-19", "2026-10-26"] });
    expect(accomplishment(s, OCT, "2026-11-01")).toMatchObject({ pct: 100, earned: 4, required: 4 });
  });

  it("status near the end of the month: Due today, then Behind", () => {
    const s = state([monthly()], { call: ["2026-10-03"] });
    expect(habitStatus(s, s.habits[0], "2026-10-29").status).toBe("due");      // 3 to go, 3 days left
    expect(habitStatus(s, s.habits[0], "2026-10-30").status).toBe("behind");   // 3 to go, 2 days left
    expect(dayScore(s, "2026-10-29")).toMatchObject({ total: 1, done: 0 });    // owed on Today
    expect(dayScore(s, "2026-10-20")).toMatchObject({ total: 0 });             // on track: not owed
  });

  it("a habit started late in the month asks its fair share; too late, it starts next month", () => {
    const share = (start: string) => monthTarget(state([], {}), monthly(4, { startDate: start }), "2026-10").target;
    expect(share("2026-10-01")).toBe(4);
    expect(share("2026-10-25")).toBe(1);   // 4 × 7/31 = 0.90
    expect(share("2026-10-28")).toBe(1);   // 4 × 4/31 = 0.52
    expect(share("2026-10-29")).toBe(0);   // 4 × 3/31 = 0.39 → starts in November
    const late = monthly(4, { startDate: "2026-10-29" });
    expect(habitStatus(state([late], {}), late, "2026-10-30")).toMatchObject({ status: "on_track", target: 0, period: "month" });
  });

  it("Community's live month does not reward an unfinished monthly target", () => {
    const s = state([habit("walk"), monthly()], { walk: days("2026-10-01", "2026-10-13"), call: ["2026-10-03", "2026-10-08"] });
    expect(rangeScore(s, days("2026-10-01", "2026-10-14"), "2026-10-14")).toMatchObject({ pct: 100, earned: 13, required: 13, open: 2 });
  });
});

describe("fixed-day repeat options", () => {
  it("every 3 days: only rhythm days are owed; the days between are never missed", () => {
    const h = habit("water", { mode: "every_n_days", intervalDays: 3, anchorDate: "2026-10-01" });
    const rhythm = ["2026-10-01", "2026-10-04", "2026-10-07", "2026-10-10"];
    const s = state([h], { water: rhythm });
    expect(accomplishment(s, days("2026-10-01", "2026-10-11"), "2026-10-12")).toMatchObject({ pct: 100, earned: 4, required: 4 });
    const missedOne = state([h], { water: rhythm.slice(0, 3) });
    expect(accomplishment(missedOne, days("2026-10-01", "2026-10-11"), "2026-10-12")).toMatchObject({ pct: 75, earned: 3, required: 4 });
  });

  it("days of the month: the 1st, 15th and 31st are sessions, nothing else", () => {
    const h = habit("bills", { mode: "month_days", daysOfMonth: [1, 15, 31] });
    const s = state([h], { bills: ["2026-10-01", "2026-10-15"] });
    expect(accomplishment(s, OCT, "2026-11-01")).toMatchObject({ pct: 67, earned: 2, required: 3 });
  });
});
