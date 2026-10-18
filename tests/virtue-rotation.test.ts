import { describe, expect, it } from "vitest";
import { addDays } from "../src/lib/dates";
import { dayScore, isScheduled } from "../src/lib/habits";
import { dictionaries } from "../src/lib/i18n";
import { habitFromLibrary, libraryByKey } from "../src/lib/library";
import { FRANKLIN_VIRTUES, rotationItemOn, rotationStartFor } from "../src/lib/rotation";
import { habitNameOn, rotationLabel, rotationPrecept } from "../src/lib/templates";
import { emptyState } from "../src/lib/types";
import type { AppState, Habit } from "../src/lib/types";
import { parseHabit } from "../src/lib/validate";

/**
 * HT-2c, Design A: one "Virtue of the week" habit that rotates through
 * Franklin's thirteen virtues, a week each, then round again.
 *
 * It is one habit — one row, one history, one place on the active list — and
 * which virtue a day belongs to is derived from a start fixed at creation, so
 * every past week keeps the virtue it had.
 */

// 2026-10-18 is a Sunday: the first week of the cycle below.
const START = "2026-10-18";
const week = (n: number) => addDays(START, 7 * n);
const virtueHabit = (over: Partial<Habit> = {}): Habit => ({
  ...habitFromLibrary(libraryByKey.get("franklin_virtue_week")!),
  startDate: START, rotationStart: START, ...over,
});
const state = (habits: Habit[], done: Record<string, string[]> = {}): AppState => ({
  ...emptyState(), habits,
  completions: Object.fromEntries(Object.entries(done).map(([d, ids]) =>
    [d, Object.fromEntries(ids.map((id) => [id, { done: true }]))])),
});

describe("which virtue a week belongs to", () => {
  it("follows Franklin's order, one virtue for the whole Sunday-to-Saturday week", () => {
    expect(rotationItemOn("franklin_virtues", START, START).key).toBe("franklin_temperance");
    expect(rotationItemOn("franklin_virtues", START, addDays(START, 6)).key).toBe("franklin_temperance");   // Saturday
    expect(rotationItemOn("franklin_virtues", START, week(1)).key).toBe("franklin_silence");
    expect(rotationItemOn("franklin_virtues", START, week(12)).key).toBe("franklin_humility");
    expect(FRANKLIN_VIRTUES.map((_, i) => rotationItemOn("franklin_virtues", START, week(i)).key))
      .toEqual(FRANKLIN_VIRTUES.map((v) => `franklin_${v}`));
  });

  it("starts again with Temperance after the thirteenth week — a new course", () => {
    const thirteenth = rotationItemOn("franklin_virtues", START, week(12));
    const fourteenth = rotationItemOn("franklin_virtues", START, week(13));
    expect(thirteenth).toMatchObject({ index: 12, course: 1 });
    expect(fourteenth).toMatchObject({ key: "franklin_temperance", index: 0, course: 2 });
    // Four courses make a year, as Franklin reckoned it.
    expect(rotationItemOn("franklin_virtues", START, week(52))).toMatchObject({ key: "franklin_temperance", course: 5 });
  });

  it("keeps its weeks when the clocks change and across a year boundary", () => {
    expect(rotationItemOn("franklin_virtues", START, "2026-11-01").key).toBe("franklin_order");      // US DST ends
    expect(rotationItemOn("franklin_virtues", START, "2027-01-10").key).toBe(`franklin_${FRANKLIN_VIRTUES[12]}`);
    expect(rotationItemOn("franklin_virtues", START, "2027-01-17").key).toBe("franklin_temperance");
  });

  it("can start on any virtue: 'start this week with Order' means the cycle began two weeks ago", () => {
    const start = rotationStartFor("2026-10-21", 2);   // a Wednesday
    expect(start).toBe("2026-10-04");
    expect(rotationItemOn("franklin_virtues", start, "2026-10-21").key).toBe("franklin_order");
  });
});

describe("one habit, with its history kept", () => {
  it("counts as one habit and is tracked daily", () => {
    const h = virtueHabit();
    expect(h.frequency.mode).toBe("daily");
    const s = state([h]);
    expect(dayScore(s, week(3)).total).toBe(1);
    expect(isScheduled(s, h, addDays(week(3), 4))).toBe(true);
  });

  it("names each past day by its own week's virtue — a later look does not re-label it", () => {
    const h = virtueHabit();
    const { en } = dictionaries;
    expect(habitNameOn(h, en, START)).toBe("Virtue of the week: Temperance");
    expect(habitNameOn(h, en, addDays(week(2), 3))).toBe("Virtue of the week: Order");
    expect(rotationLabel(h, en, week(2))).toBe("This week: Order · week 3 of 13");
    expect(rotationPrecept(h, en, week(2))).toMatch(/Let all your things have their places/);
  });

  it("treats a missed day as just that day: the week's other days and the next virtue are unaffected", () => {
    const h = virtueHabit();
    const done = { [START]: [h.id], [addDays(START, 2)]: [h.id] };   // Sunday done, Monday missed, Tuesday done
    const s = state([h], done);
    expect(dayScore(s, addDays(START, 1))).toMatchObject({ done: 0, total: 1 });
    expect(dayScore(s, addDays(START, 2))).toMatchObject({ done: 1, total: 1 });
    expect(habitNameOn(h, dictionaries.en, week(1))).toBe("Virtue of the week: Silence");
  });

  it("reads in Chinese and in both languages", () => {
    const h = virtueHabit();
    expect(habitNameOn(h, dictionaries.zh, week(2))).toBe("本周美德：秩序");
    expect(rotationLabel(h, dictionaries.zh, week(2))).toBe("本周：秩序 · 第 3/13 周");
    expect(habitNameOn(h, dictionaries.both, START)).toBe("Virtue of the week: Temperance · 本周美德：节制");
  });

  it("an ordinary habit is untouched by any of this", () => {
    const plain = { ...virtueHabit(), rotation: null, rotationStart: null, name: "Read", templateKey: null };
    expect(habitNameOn(plain, dictionaries.en, START)).toBe("Read");
    expect(rotationLabel(plain, dictionaries.en, START)).toBeNull();
  });
});

describe("adding it and the server's parse", () => {
  it("is added from the library starting this week with Temperance", () => {
    const h = habitFromLibrary(libraryByKey.get("franklin_virtue_week")!);
    expect(h.rotation).toBe("franklin_virtues");
    expect(new Date(`${h.rotationStart}T12:00:00`).getDay()).toBe(0);   // a Sunday
  });

  it("keeps only a known rotation, and always starts it on a Sunday", () => {
    const body = {
      id: "11111111-2222-4333-8444-555555555555", name: "Virtue of the week", templateKey: "franklin_virtue_week",
      description: "", category: "nighttime", type: "good",
      frequency: { mode: "daily", days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3 },
      startDate: "2026-10-21", active: true, weight: 2, goalId: null, createdAt: 1,
    };
    expect(parseHabit({ ...body, rotation: "franklin_virtues", rotationStart: "2026-10-21" }))
      .toMatchObject({ rotation: "franklin_virtues", rotationStart: "2026-10-18" });
    expect(parseHabit({ ...body, rotation: "franklin_virtues" }).rotationStart).toBe("2026-10-18");
    expect(parseHabit({ ...body, rotation: "stoics", rotationStart: "2026-10-18" }))
      .toMatchObject({ rotation: null, rotationStart: null });
    expect(() => parseHabit({ ...body, rotation: "franklin_virtues", rotationStart: "next week" })).toThrow(/YYYY-MM-DD/);
  });
});
