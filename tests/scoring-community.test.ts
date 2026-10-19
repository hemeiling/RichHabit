import { describe, expect, it, vi } from "vitest";
import { addDays } from "@/lib/dates";
import { blankHabit, rangeScore } from "@/lib/habits";
import { emptyState } from "@/lib/types";
import type { AppState, Frequency, Habit } from "@/lib/types";

/**
 * Community scores by the same targets (the scoring revision), each window as
 * of its own day: the live month waits for today's sessions, a finished
 * month's archive counts its last day, and an unfinished week is never
 * rewarded early.
 */
vi.mock("@/lib/db/pool", () => ({ query: async () => [], transaction: async () => { throw new Error("unused"); } }));
vi.mock("@/lib/db/queries", () => ({ loadState: async () => emptyState() }));
const { monthToDate, wholeMonth } = await import("../src/lib/community");

const DAILY: Frequency = { mode: "daily", days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3 };
const habit = (id: string, f: Partial<Frequency> = {}): Habit => ({
  ...blankHabit(), id, name: id, startDate: "2026-09-01", weight: 1, frequency: { ...DAILY, ...f },
});
const plain = (habits: Habit[], done: Record<string, string[]>): AppState => {
  const s: AppState = { ...emptyState(), habits };
  s.prefs = { ...s.prefs, weighted: false };   // Community is unweighted
  for (const [id, dates] of Object.entries(done)) for (const d of dates) (s.completions[d] ??= {})[id] = { done: true };
  return s;
};
const days = (a: string, b: string) => { const o: string[] = []; for (let d = a; d <= b; d = addDays(d, 1)) o.push(d); return o; };

describe("Community windows", () => {
  it("month-to-date waits for today; the finished month counts its last day", () => {
    const s = plain([habit("walk")], { walk: days("2026-10-01", "2026-10-30") });   // not yet on Oct 31
    const live = monthToDate("2026-10-31");
    expect(live.asOf).toBe("2026-10-31");
    expect(rangeScore(s, live.dates, live.asOf)).toMatchObject({ pct: 100, earned: 30, required: 30, open: 1 });
    const archive = wholeMonth("2026-10");
    expect(archive.asOf).toBe("2026-11-01");
    expect(rangeScore(s, archive.dates, archive.asOf)).toMatchObject({ pct: 97, earned: 30, required: 31, open: 0 });
  });

  it("an unfinished weekly target is not rewarded as accomplished mid-month", () => {
    // Weeks ending in October so far are complete; this week has 2 of 3 by Wednesday.
    const gym = habit("gym", { mode: "times", timesPerWeek: 3 });
    const s = plain([gym], { gym: [
      "2026-09-28", "2026-09-30", "2026-10-02", "2026-10-05", "2026-10-07", "2026-10-09",
      "2026-10-12", "2026-10-13",
    ] });
    const live = monthToDate("2026-10-14");
    expect(rangeScore(s, live.dates, live.asOf)).toMatchObject({ pct: 100, earned: 6, required: 6, open: 1 });
    // Missing the third session by Saturday makes that week 2 of 3 once it is over.
    const later = monthToDate("2026-10-18");
    expect(rangeScore(s, later.dates, later.asOf)).toMatchObject({ earned: 8, required: 9, pct: 89 });
  });
});
