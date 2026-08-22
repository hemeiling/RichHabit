import { describe, expect, it } from "vitest";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";
import { both } from "../src/lib/i18n/both";
import { dayScore, rangeScore } from "../src/lib/habits";
import { monthToDate } from "../src/lib/community";
import { emptyState } from "../src/lib/types";
import type { AppState, Habit } from "../src/lib/types";

/**
 * Today's dial and the Community figure are different measurements, and they
 * were reported as a bug: 28% on Today, 8% on the board. They are both right.
 * These tests pin down why, and pin the labelling that has to say so — an
 * unexplained smaller number beside a bigger one reads as a stale copy.
 */

const habit = (id: string, weight: 1 | 2 | 3): Habit => ({
  id, name: id, templateKey: null, description: "", category: "morning", type: "good",
  frequency: { mode: "daily", days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3 },
  tracking: "boolean", minimum: null, target: null, unit: "",
  anchor: "", environment: "", friction: "",
  startDate: "2026-08-01", status: "active", active: true, weight,
} as unknown as Habit);

const TODAY = "2026-08-21";
const tick = (s: AppState, d: string, id: string) => {
  (s.completions[d] ??= {})[id] = { done: true } as never;
};

/** Ten daily habits; a quiet first three weeks and a good showing today. */
function scenario(): AppState {
  const s = emptyState();
  s.habits = Array.from({ length: 10 }, (_, i) => habit(`h${i}`, ((i % 3) + 1) as 1 | 2 | 3));
  const { dates } = monthToDate(TODAY);
  dates.slice(0, 20).filter((_, i) => i % 10 !== 0 && i % 7 !== 0)
    .forEach((d) => tick(s, d, "h0"));
  for (const id of ["h0", "h1", "h2"]) tick(s, TODAY, id);
  return s;
}

const unweighted = (s: AppState): AppState => ({ ...s, prefs: { ...s.prefs, weighted: false } });

describe("why Today and Community show different numbers", () => {
  const { dates } = monthToDate(TODAY);

  it("Today is one day; Community is every day since the 1st", () => {
    const s = scenario();
    const today = dayScore(s, TODAY).pct!;
    const month = rangeScore(unweighted(s), dates).pct!;

    console.log(`\n    Today's dial       ${today}%   (1 day, weighted)`);
    console.log(`    Community          ${month}%   (${dates.length} days, unweighted)`);
    console.log(`    Same work — ${dates.length}x the denominator.\n`);

    expect(today).toBeGreaterThan(month * 2);
  });

  it("and Community forces weighting off, which moves it again", () => {
    const s = scenario();
    s.completions[TODAY] = {};
    for (const id of ["h2", "h5"]) tick(s, TODAY, id);   // weight 3 each

    const w = dayScore(s, TODAY).pct!;
    const u = dayScore(unweighted(s), TODAY).pct!;
    console.log(`\n    today weighted ${w}%   unweighted ${u}%\n`);
    expect(w).not.toBe(u);
  });

  /* The load-bearing one: if the month figure moves when a habit is ticked,
     then a Community number that will not move is staleness, not method. */
  it("ticking one habit does move the month-to-date figure", () => {
    const s = scenario();
    const before = rangeScore(unweighted(s), dates).pct!;
    tick(s, TODAY, "h3");
    const after = rangeScore(unweighted(s), dates).pct!;

    console.log(`\n    month-to-date before ${before}%  ->  after one tick ${after}%\n`);
    expect(after).toBeGreaterThan(before);
  });

  it("and un-ticking moves it back", () => {
    const s = scenario();
    const before = rangeScore(unweighted(s), dates).pct!;
    // All three of today's, because the figure is rounded to whole percent and
    // one tick on the 21st of the month is under half a point.
    s.completions[TODAY] = {};
    const after = rangeScore(unweighted(s), dates).pct!;
    console.log(`\n    month-to-date before ${before}%  ->  after un-tick ${after}%\n`);
    expect(after).toBeLessThan(before);
  });
});

describe("the labels that keep the two numbers apart", () => {
  it("names the window rather than calling it 'my completeness'", () => {
    expect(en.community.myCompleteness).toMatch(/month-to-date/i);
    expect(zh.community.myCompleteness).toContain("本月截至今日");
  });

  it("has a short form for the rail, where the confusion actually happens", () => {
    expect(en.community.monthToDate).toMatch(/month to date/i);
    expect(zh.community.monthToDate).toContain("本月截至今日");
    // It sits in a 300px column beside the day's dial.
    expect(en.community.monthToDate.length).toBeLessThan(20);
  });

  it("says outright that it is not today's score", () => {
    expect(en.community.basis).toMatch(/not today/i);
    expect(zh.community.basis).toContain("不是今天");
  });
});

describe("marking your own row", () => {
  /* The username has to stay visible: seeing it is how you know how you look
     to everyone else. The tag marks the row; it does not replace the name. */
  it("is a tag to append, not a word to swap in", () => {
    expect(en.community.youTag).toBe("(You)");
    expect(zh.community.youTag).toBe("（你）");
  });

  it("carries both languages in bilingual mode", () => {
    expect(both.community.youTag).toContain("You");
    expect(both.community.youTag).toContain("你");
  });

  it("is short enough to sit after a long username", () => {
    for (const d of [en, zh, both]) expect(d.community.youTag.length).toBeLessThan(14);
  });
});
