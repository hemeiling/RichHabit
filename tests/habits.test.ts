import { describe, expect, it } from "vitest";
import { addDays, dow, todayISO, weekStart } from "../src/lib/dates";
import {
  blankHabit, dayScore, dayStreak, habitLongestStreak, habitStats, habitStreak,
  isScheduled, moveWithin, rangeScore, scheduledOn, weekSummary,
} from "../src/lib/habits";
import { emptyState } from "../src/lib/types";
import type { AppState, Habit } from "../src/lib/types";

const makeHabit = (over: Partial<Habit> = {}): Habit => ({
  ...blankHabit(), name: "Read", startDate: addDays(todayISO(), -30), ...over,
});

const withHabits = (habits: Habit[]): AppState => ({ ...emptyState(), habits });

const complete = (s: AppState, date: string, ids: string[]) => {
  s.completions[date] = Object.fromEntries(ids.map((id) => [id, { done: true }]));
};

describe("dates", () => {
  it("round-trips addDays", () => {
    expect(addDays(addDays(todayISO(), -7), 7)).toBe(todayISO());
  });
  it("starts weeks on Sunday", () => {
    expect(dow(weekStart(todayISO()))).toBe(0);
  });
});

describe("scheduling", () => {
  it("schedules daily habits every day", () => {
    const h = makeHabit();
    expect(isScheduled(withHabits([h]), h, todayISO())).toBe(true);
  });

  it("never schedules a habit before its start date", () => {
    const h = makeHabit({ startDate: todayISO() });
    expect(isScheduled(withHabits([h]), h, addDays(todayISO(), -1))).toBe(false);
  });

  it("skips paused habits", () => {
    const h = makeHabit({ active: false });
    expect(isScheduled(withHabits([h]), h, todayISO())).toBe(false);
  });

  it("honours specific days of the week", () => {
    const today = todayISO();
    const h = makeHabit({ frequency: { mode: "days", days: [dow(today)], timesPerWeek: 3 } });
    const s = withHabits([h]);
    expect(isScheduled(s, h, today)).toBe(true);
    expect(isScheduled(s, h, addDays(today, 1))).toBe(false);
  });

  it("drops an X-times-a-week habit once the week's target is met", () => {
    const h = makeHabit({ frequency: { mode: "times", days: [], timesPerWeek: 2 } });
    const s = withHabits([h]);
    const start = weekStart(todayISO());
    complete(s, start, [h.id]);
    complete(s, addDays(start, 1), [h.id]);
    const later = addDays(start, 3);
    if (later <= todayISO()) expect(isScheduled(s, h, later)).toBe(false);
  });
});

describe("scoring", () => {
  it("returns null when nothing is scheduled", () => {
    expect(dayScore(emptyState(), todayISO()).pct).toBeNull();
  });

  it("weights high-priority habits more heavily", () => {
    const heavy = makeHabit({ weight: 3, name: "Exercise" });
    const light = makeHabit({ weight: 1, name: "Water" });
    const s = withHabits([heavy, light]);
    complete(s, todayISO(), [heavy.id]);
    expect(dayScore(s, todayISO()).pct).toBe(75); // 3 of 4 weight
    s.prefs.weighted = false;
    expect(dayScore(s, todayISO()).pct).toBe(50); // 1 of 2 habits
  });

  it("counts a perfect day only when everything scheduled is done", () => {
    const a = makeHabit(), b = makeHabit({ name: "Walk" });
    const s = withHabits([a, b]);
    complete(s, todayISO(), [a.id]);
    expect(rangeScore(s, [todayISO()]).perfect).toBe(0);
    complete(s, todayISO(), [a.id, b.id]);
    expect(rangeScore(s, [todayISO()]).perfect).toBe(1);
  });
});

describe("streaks", () => {
  it("counts consecutive completed days", () => {
    const h = makeHabit();
    const s = withHabits([h]);
    for (let i = 0; i < 5; i++) complete(s, addDays(todayISO(), -i), [h.id]);
    expect(habitStreak(s, h)).toBe(5);
  });

  it("does not break the streak just because today is unchecked", () => {
    const h = makeHabit();
    const s = withHabits([h]);
    for (let i = 1; i <= 4; i++) complete(s, addDays(todayISO(), -i), [h.id]);
    expect(habitStreak(s, h)).toBe(4);
  });

  it("breaks the streak on a missed past day", () => {
    const h = makeHabit();
    const s = withHabits([h]);
    complete(s, addDays(todayISO(), -1), [h.id]);
    complete(s, addDays(todayISO(), -3), [h.id]);
    expect(habitStreak(s, h)).toBe(1);
    expect(habitLongestStreak(s, h)).toBe(1);
  });

  it("keeps a day streak while most habits are done", () => {
    const a = makeHabit(), b = makeHabit({ name: "Walk" });
    const s = withHabits([a, b]);
    for (let i = 0; i < 3; i++) complete(s, addDays(todayISO(), -i), [a.id, b.id]);
    expect(dayStreak(s)).toBe(3);
  });
});

describe("stats and summaries", () => {
  it("reports completion, misses and trend", () => {
    const h = makeHabit();
    const s = withHabits([h]);
    for (let i = 0; i < 7; i += 2) complete(s, addDays(todayISO(), -i), [h.id]);
    const stats = habitStats(s, h, 7);
    expect(stats.scheduled).toBe(7);
    expect(stats.done).toBe(4);
    expect(stats.missed).toBe(3);
    expect(stats.pct).toBe(57);
  });

  it("names the best and worst habit of a week", () => {
    const good = makeHabit({ name: "Read" });
    const bad = makeHabit({ name: "Bed on time" });
    const s = withHabits([good, bad]);
    const start = weekStart(todayISO());
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      if (d <= todayISO()) complete(s, d, [good.id]);
    }
    const summary = weekSummary(s, start, null);
    expect(summary.best?.habit.name).toBe("Read");
    expect(summary.worst?.habit.name).toBe("Bed on time");
    expect(summary.best?.pct).toBe(100);
    expect(summary.worst?.pct).toBe(0);
  });

  it("survives an account with no habits at all", () => {
    const s = emptyState();
    expect(scheduledOn(s, todayISO())).toEqual([]);
    expect(rangeScore(s, [todayISO()]).pct).toBeNull();
    expect(dayStreak(s)).toBe(0);
  });
});

describe("moveWithin", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves an item down to where the target sits", () => {
    expect(moveWithin(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item up to where the target sits", () => {
    expect(moveWithin(ids, "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("handles neighbours in both directions", () => {
    expect(moveWithin(ids, "a", "b")).toEqual(["b", "a", "c", "d"]);
    expect(moveWithin(ids, "b", "a")).toEqual(["b", "a", "c", "d"]);
  });

  it("moves to either end", () => {
    expect(moveWithin(ids, "d", "a")).toEqual(["d", "a", "b", "c"]);
    expect(moveWithin(ids, "a", "d")).toEqual(["b", "c", "d", "a"]);
  });

  it("keeps every id exactly once", () => {
    const out = moveWithin(ids, "b", "d");
    expect([...out].sort()).toEqual([...ids].sort());
    expect(out.length).toBe(ids.length);
  });

  it("does nothing when the ids are unknown or the same", () => {
    expect(moveWithin(ids, "a", "a")).toEqual(ids);
    expect(moveWithin(ids, "z", "a")).toEqual(ids);
    expect(moveWithin(ids, "a", "z")).toEqual(ids);
  });

  it("does not mutate the list it was given", () => {
    const original = [...ids];
    moveWithin(ids, "a", "d");
    expect(ids).toEqual(original);
  });
});
