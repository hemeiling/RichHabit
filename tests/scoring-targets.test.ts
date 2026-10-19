import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import {
  accomplishment, blankHabit, dayScore, habitStats, habitStatus, rangeScore, weekSummary, weekTarget,
} from "@/lib/habits";
import { emptyState } from "@/lib/types";
import type { AppState, Frequency, Habit } from "@/lib/types";

/**
 * The scoring revision (PO-approved): target progress, schedule status and the
 * accomplishment score are three different answers, from one rule — a target
 * counts once it is met or once its time is up, and earns at most what it
 * asked for. Week of Sun Oct 11 – Sat Oct 17, 2026.
 */
const DAILY: Frequency = { mode: "daily", days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3 };
const habit = (id: string, f: Partial<Frequency> = {}, over: Partial<Habit> = {}): Habit => ({
  ...blankHabit(), id, name: id, startDate: "2026-09-01", weight: 1, frequency: { ...DAILY, ...f }, ...over,
});
const weekly = (n = 3, over: Partial<Habit> = {}) => habit("gym", { mode: "times", timesPerWeek: n }, over);
const state = (habits: Habit[], done: Record<string, string[]>): AppState => {
  const s: AppState = { ...emptyState(), habits };
  for (const [id, dates] of Object.entries(done)) for (const d of dates) (s.completions[d] ??= {})[id] = { done: true };
  return s;
};
const days = (a: string, b: string) => { const o: string[] = []; for (let d = a; d <= b; d = addDays(d, 1)) o.push(d); return o; };
const WEEK = days("2026-10-11", "2026-10-17");

describe("a weekly target", () => {
  it("3 of 3 is 100%, counted the moment the third session is done", () => {
    const s = state([weekly()], { gym: ["2026-10-12", "2026-10-14", "2026-10-16"] });
    expect(accomplishment(s, WEEK, "2026-10-16")).toMatchObject({ pct: 100, earned: 3, required: 3, open: 0 });
    expect(habitStatus(s, s.habits[0], "2026-10-16")).toEqual({ status: "completed", done: 3, target: 3, period: "week" });
    expect(weekSummary(s, "2026-10-11", null).pct ?? 100).toBe(100);
  });

  it("doing more never scores over 100%", () => {
    const s = state([weekly()], { gym: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"] });
    expect(accomplishment(s, WEEK, "2026-10-18")).toMatchObject({ pct: 100, earned: 3, required: 3 });
  });

  it("2 of 3 mid-week is progress, not a score: nothing is credited or missed until the week is over", () => {
    const s = state([weekly()], { gym: ["2026-10-12", "2026-10-14"] });
    const status = habitStatus(s, s.habits[0], "2026-10-14");
    expect(status).toMatchObject({ done: 2, target: 3 });                                  // 67% target progress
    expect(accomplishment(s, WEEK, "2026-10-14")).toMatchObject({ pct: null, open: 1 }); // not 100%
    expect(accomplishment(s, WEEK, "2026-10-18")).toMatchObject({ pct: 67, earned: 2, required: 3 });
  });

  it("schedule status is its own answer: On track, Due today, Behind, Completed", () => {
    const s = state([weekly()], { gym: ["2026-10-12"] });
    const h = s.habits[0];
    expect(habitStatus(s, h, "2026-10-14").status).toBe("on_track");   // 2 to go, 4 days left
    expect(habitStatus(s, h, "2026-10-16").status).toBe("due");        // 2 to go, 2 days left
    expect(habitStatus(s, h, "2026-10-17").status).toBe("behind");     // 2 to go, 1 day left
    for (const d of ["2026-10-14", "2026-10-16", "2026-10-17"]) expect(habitStatus(s, h, d)).toMatchObject({ done: 1, target: 3 });
  });

  it("is owed on Today only when the week needs it — leaving it on an on-track day costs nothing", () => {
    const s = state([weekly()], { gym: ["2026-10-12"] });
    expect(dayScore(s, "2026-10-14")).toMatchObject({ total: 0, pct: null });     // on track: not owed
    expect(dayScore(s, "2026-10-16")).toMatchObject({ total: 1, done: 0 });       // due: owed
    const done = state([weekly()], { gym: ["2026-10-12", "2026-10-14"] });
    expect(dayScore(done, "2026-10-14")).toMatchObject({ total: 1, done: 1, pct: 100 });  // a session toward it counts
  });

  it("a habit created mid-week asks its fair share; one created on the last day starts next week", () => {
    const share = (start: string) => weekTarget(state([], {}), weekly(3, { startDate: start }), "2026-10-11").target;
    expect(share("2026-10-11")).toBe(3);
    expect(share("2026-10-14")).toBe(2);   // Wed: 3 × 4/7 = 1.71
    expect(share("2026-10-15")).toBe(1);   // Thu: 3 × 3/7 = 1.29
    expect(share("2026-10-17")).toBe(0);   // Sat: 3 × 1/7 = 0.43 — no target this week
    const sat = weekly(3, { startDate: "2026-10-17" });
    const s = state([sat], { gym: ["2026-10-17"] });
    expect(accomplishment(s, WEEK, "2026-10-18")).toMatchObject({ pct: null, required: 0 });   // a head start, unscored
    expect(habitStatus(s, sat, "2026-10-18")).toMatchObject({ status: "on_track", done: 0, target: 3 });
  });
});

describe("fixed days and unscheduled days", () => {
  it("unscheduled days are never missed, and a tick on one earns nothing extra", () => {
    const yoga = habit("yoga", { mode: "days", days: [1, 3, 5] });
    const s = state([yoga], { yoga: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-16"] });   // + an extra Tuesday
    expect(accomplishment(s, WEEK, "2026-10-18")).toMatchObject({ pct: 100, earned: 3, required: 3 });
    const missedFri = state([yoga], { yoga: ["2026-10-12", "2026-10-14"] });
    expect(accomplishment(missedFri, WEEK, "2026-10-18")).toMatchObject({ pct: 67, earned: 2, required: 3 });
  });

  it("today's sessions count once done and are never a miss before the day is over", () => {
    const walk = habit("walk");
    const s = state([walk], { walk: days("2026-10-01", "2026-10-13") });
    const mtd = days("2026-10-01", "2026-10-14");
    expect(rangeScore(s, mtd, "2026-10-14")).toMatchObject({ pct: 100, earned: 13, required: 13, open: 1 });
    expect(dayScore(s, "2026-10-14")).toMatchObject({ total: 1, done: 0 });       // Today's ring still asks for it
    expect(rangeScore(s, mtd, "2026-10-15")).toMatchObject({ pct: 93, earned: 13, required: 14 });   // the day ended
  });
});

describe("one rule across screens", () => {
  it("Week, Insights and Community read the same numbers", () => {
    const s = state([habit("walk"), weekly()], {
      walk: WEEK.filter((d) => d !== "2026-10-13"), gym: ["2026-10-12", "2026-10-15"],
    });
    const asOf = "2026-10-18";
    const score = rangeScore(s, WEEK, asOf);
    expect(score).toMatchObject({ earned: 8, required: 10, pct: 80 });              // 6/7 walks + 2/3 gym
    expect(accomplishment(s, WEEK, asOf).pct).toBe(score.pct);
    const unweighted = { ...s, prefs: { ...s.prefs, weighted: false } };            // Community's view
    expect(rangeScore(unweighted, WEEK, asOf).pct).toBe(80);
  });

  it("weights count only when the person asks for weighting", () => {
    const heavy = habit("walk", {}, { weight: 3 });
    const s = state([heavy, weekly()], { walk: WEEK, gym: ["2026-10-12"] });
    const plain = { ...s, prefs: { ...s.prefs, weighted: false } };
    expect(rangeScore(plain, WEEK, "2026-10-18").pct).toBe(80);                   // 7 + 1 of 7 + 3
    const weighted = { ...s, prefs: { ...s.prefs, weighted: true } };
    expect(rangeScore(weighted, WEEK, "2026-10-18").pct).toBe(92);                // 21 + 1 of 21 + 3
  });

  it("a range ending today counts the current week once it is met — and only then", () => {
    const lastWeek = ["2026-10-12", "2026-10-14", "2026-10-16"];                   // last week: 3 of 3
    const lastSeven = days("2026-10-14", "2026-10-20");
    const inProgress = state([weekly()], { gym: [...lastWeek, "2026-10-19", "2026-10-20"] });
    expect(accomplishment(inProgress, lastSeven, "2026-10-20")).toMatchObject({ earned: 3, required: 3, open: 1 });
    const met = state([weekly()], { gym: [...lastWeek, "2026-10-18", "2026-10-19", "2026-10-20"] });
    expect(accomplishment(met, lastSeven, "2026-10-20")).toMatchObject({ earned: 6, required: 6, open: 0 });
  });
});

describe("history is read as recorded", () => {
  it("a schedule changed mid-week judges each day by the version in force on it", () => {
    // Daily until Wednesday, then 3 a week: Sun–Tue are sessions; Wed–Sat carry 3 × 4/7 → 2.
    const h = weekly(3, { frequencyHistory: [
      { from: "2026-09-01", frequency: DAILY },
      { from: "2026-10-14", frequency: { ...DAILY, mode: "times", timesPerWeek: 3 } },
    ] });
    const s = state([h], { gym: ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-15", "2026-10-17"] });
    expect(weekTarget(s, h, "2026-10-11")).toMatchObject({ target: 2, done: 2 });
    expect(accomplishment(s, WEEK, "2026-10-18")).toMatchObject({ pct: 100, earned: 5, required: 5 });
  });

  it("per-habit stats use the same targets (no credit for unscheduled ticks, no penalty for today)", () => {
    const yoga = habit("yoga", { mode: "days", days: [1, 3, 5] });
    const s = state([yoga], { yoga: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-16"] });
    const st = habitStats(s, yoga, 30);
    expect(st.done).toBeLessThanOrEqual(st.scheduled);
    expect(st.missed).toBe(st.scheduled - st.done);
  });
});
