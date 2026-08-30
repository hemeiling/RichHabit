/**
 * Splitting a series into the stretches that can honestly be joined by a line.
 *
 * A month of daily completion has holes in it: a day with nothing scheduled has
 * no completion rate, which is not the same as a rate of zero. Drawing one line
 * through the holes would invent a trend across days nothing was asked of you,
 * and the line would slope towards a number that was never true.
 *
 * So the series becomes a set of unbroken runs, each drawn separately, and the
 * gaps stay gaps. Pure and free of React so it can be tested on its own — the
 * previous version of this lived inside the component, was written as a clever
 * one-liner, and silently drew nothing at all.
 */

export interface TrendPoint {
  /** Position along the x-axis: which day of the month this is. */
  index: number;
  value: number;
}

/**
 * The runs of consecutive non-null values, in order.
 *
 * `null` marks a gap. A run of a single point is kept: the caller decides
 * whether one point is worth drawing, and a lone day is still a fact.
 */
export function runsOf(values: (number | null)[]): TrendPoint[][] {
  const runs: TrendPoint[][] = [];
  let current: TrendPoint[] | null = null;

  values.forEach((value, index) => {
    if (value === null) {
      current = null;          // the gap ends whatever run was in progress
      return;
    }
    if (!current) {
      current = [];
      runs.push(current);
    }
    current.push({ index, value });
  });

  return runs;
}

/** How many points across every run — i.e. how much of the series is real. */
export const pointCount = (runs: TrendPoint[][]): number =>
  runs.reduce((n, run) => n + run.length, 0);
