import { accomplishedOn } from "@/lib/accomplishments";
import { dayScore } from "@/lib/habits";
import type { AppState } from "@/lib/types";

/**
 * The two day-by-day series My Progress draws, and the small geometry the chart
 * needs to read a pointer. Pure, so the numbers under the drawing are tested
 * without a browser.
 *
 * The series are deliberately kept in their own units. `pct` is a habit
 * completion rate on 0–100 (null on a day with nothing scheduled, which is a
 * gap rather than a zero). `count` is how many priorities were completed that
 * day. Nothing here converts one into the other or adds them up.
 */

export interface DayProgress {
  date: string;
  /** Daily habit completion, exactly `dayScore` — the same call Today's dial makes. */
  pct: number | null;
  /** Priorities whose `completed_on` is this day, by the shared accomplishment rule. */
  count: number;
}

export function dailyProgress(state: AppState, days: string[]): DayProgress[] {
  return days.map((date) => ({
    date,
    pct: dayScore(state, date).pct,
    count: accomplishedOn(state.priorities, date).length,
  }));
}

/**
 * Which day a horizontal position falls on, for hover and tap. Days sit at
 * evenly spaced points from `pad` to `width - pad`; the nearest one wins, and a
 * position outside the chart snaps to the first or last day.
 */
export function dayIndexAt(px: number, width: number, pad: number, days: number): number {
  if (days <= 1) return 0;
  const step = (width - pad * 2) / (days - 1);
  if (step <= 0) return 0;
  return Math.min(days - 1, Math.max(0, Math.round((px - pad) / step)));
}

/**
 * A bar's height for a count, on the accomplishments' own scale: the busiest day
 * of the month reaches `band`, and any completed priority is at least `floor`
 * tall so a single one is never invisible. Zero draws nothing.
 */
export function barHeight(count: number, max: number, band: number, floor = 3): number {
  if (count <= 0 || max <= 0) return 0;
  return floor + (count / max) * (band - floor);
}
