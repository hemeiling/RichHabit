import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { barHeight, dailyProgress, dayIndexAt } from "../src/lib/progressSeries";
import { dayScore } from "../src/lib/habits";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";
import { both } from "../src/lib/i18n/both";
import { emptyState } from "../src/lib/types";
import type { Habit, Priority } from "../src/lib/types";

/**
 * My Progress draws two series in their own units: daily habit completion (a
 * percentage) and priorities completed each day (a count). These tests pin the
 * numbers under the drawing and the rules that keep them apart.
 */

const habit = { id: "h", name: "h", templateKey: null, category: "morning", type: "good",
  frequency: { mode: "daily", days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3 }, tracking: "boolean",
  startDate: "2026-09-01", status: "active", active: true, weight: 1 } as unknown as Habit;
const other = { ...habit, id: "g" } as Habit;

let n = 0;
const pr = (completedOn: string | null, createdOn = "2026-09-01"): Priority => ({
  id: `p${++n}`, text: "x", createdOn, completedOn, category: "urgent_important", plannedOn: null, sortOrder: 0,
});

function scenario() {
  const s = emptyState();
  s.habits = [habit, other];
  s.completions["2026-09-09"] = { h: { done: true } as never };
  s.completions["2026-09-11"] = { h: { done: true } as never, g: { done: true } as never };
  s.priorities = [pr("2026-09-09"), pr("2026-09-11"), pr("2026-09-11"), pr("2026-09-11"), pr("2026-09-11"),
    pr("2026-09-12"), pr("2026-09-12"), pr(null), pr("2026-08-31", "2026-08-30")];
  return s;
}
const DAYS = ["2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12"];

describe("the two series", () => {
  it("counts priorities by completion day: 1, 0, 4, 2", () => {
    expect(dailyProgress(scenario(), DAYS).map((d) => d.count)).toEqual([1, 0, 4, 2]);
  });

  it("uses exactly dayScore for habits", () => {
    const s = scenario();
    const series = dailyProgress(s, DAYS);
    DAYS.forEach((date, i) => expect(series[i].pct).toBe(dayScore(s, date).pct));
    expect(series.map((d) => d.pct)).toEqual([50, 0, 100, 0]);
  });

  it("ignores an open priority and one completed outside the days drawn", () => {
    const series = dailyProgress(scenario(), DAYS);
    expect(series.reduce((a, d) => a + d.count, 0)).toBe(7);
  });

  it("drops a reopened priority from its day", () => {
    const s = scenario();
    s.priorities[1].completedOn = null;
    expect(dailyProgress(s, DAYS)[2].count).toBe(3);
  });

  it("never mixes the units: each day has a percentage and a separate count", () => {
    for (const d of dailyProgress(scenario(), DAYS)) expect(Object.keys(d).sort()).toEqual(["count", "date", "pct"]);
  });
});

describe("chart geometry", () => {
  it("maps a position to the nearest day, clamped to the chart", () => {
    // 4 days across 100px with 4px padding: days at 4, 34.67, 65.33, 96.
    expect(dayIndexAt(4, 100, 4, 4)).toBe(0);
    expect(dayIndexAt(50, 100, 4, 4)).toBe(2);
    expect(dayIndexAt(-20, 100, 4, 4)).toBe(0);
    expect(dayIndexAt(400, 100, 4, 4)).toBe(3);
    expect(dayIndexAt(50, 100, 4, 1)).toBe(0);
  });

  it("scales columns to the busiest day, keeps one visible, and draws nothing for zero", () => {
    expect(barHeight(4, 4, 30)).toBe(30);
    expect(barHeight(0, 4, 30)).toBe(0);
    expect(barHeight(1, 40, 30)).toBeGreaterThanOrEqual(3);
  });

  it("keeps accomplishment columns in the lower band, below the habit scale's midline", () => {
    const panel = fs.readFileSync("src/components/ProgressPanel.tsx", "utf8");
    const H = Number(/const H = (\d+)/.exec(panel)![1]);
    const band = Number(/BAND = (\d+)/.exec(panel)![1]);
    expect(band).toBeLessThan(H / 2);
  });
});

describe("legend wording", () => {
  it("names the series plainly in each language", () => {
    expect(en.progress.legendHabits).toBe("Habits");
    expect(en.progress.legendAccomplishments).toBe("Accomplishments");
    expect(zh.progress.legendHabits).toBe("习惯");
    expect(zh.progress.legendAccomplishments).toBe("成果");
    expect(both.progress.legendAccomplishments).toContain("Accomplishments");
    expect(both.progress.legendAccomplishments).toContain("成果");
    expect(en.progress.legendAccomplishments.toLowerCase()).not.toContain("habit");
  });
});
