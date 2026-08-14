import { addDays } from "./dates";
import { dayScore } from "./habits";
import type { AppState } from "./types";

/**
 * Relationships between a logged metric and how the day went.
 *
 * Deliberately conservative. Pearson's r over a handful of days is noise, so a
 * pairing is not reported at all below `MIN_PAIRS`, and the screen says how many
 * observations it is based on. Nothing here claims causation — the wording in
 * the dictionary is about what precedes what.
 */

export const MIN_PAIRS = 5;

export type CorrelationKey = "sleepNextDay" | "sleepSameDay" | "cardioSameDay" | "waterSameDay" | "gymSameDay";

export interface Correlation {
  key: CorrelationKey;
  /** Pearson's r, -1..1 */
  r: number;
  /** How many day-pairs it is based on. */
  n: number;
}

function pearson(pairs: [number, number][]): number | null {
  const n = pairs.length;
  if (n < MIN_PAIRS) return null;
  const mx = pairs.reduce((a, [x]) => a + x, 0) / n;
  const my = pairs.reduce((a, [, y]) => a + y, 0) / n;
  const num = pairs.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0);
  const den = Math.sqrt(
    pairs.reduce((a, [x]) => a + (x - mx) ** 2, 0) *
    pairs.reduce((a, [, y]) => a + (y - my) ** 2, 0),
  );
  return den ? num / den : null;
}

const numeric = (v: unknown): number | null => {
  if (v === "" || v == null || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Every pairing worth computing, as (metric on day D) against (score on day D,
 * or D+1 for the overnight ones).
 */
export function correlations(state: AppState): Correlation[] {
  const out: Correlation[] = [];

  const collect = (
    key: CorrelationKey,
    pick: (m: AppState["metrics"][string]) => number | null,
    dayOffset: 0 | 1,
  ) => {
    const pairs: [number, number][] = [];
    for (const [date, metrics] of Object.entries(state.metrics)) {
      const x = pick(metrics);
      if (x == null) continue;
      const score = dayScore(state, dayOffset ? addDays(date, 1) : date).pct;
      if (score == null) continue;
      pairs.push([x, score]);
    }
    const r = pearson(pairs);
    if (r != null) out.push({ key, r, n: pairs.length });
  };

  collect("sleepNextDay", (m) => numeric(m.sleep), 1);
  collect("sleepSameDay", (m) => numeric(m.sleep), 0);
  collect("cardioSameDay", (m) => numeric(m.cardioMin), 0);
  collect("waterSameDay", (m) => numeric(m.water), 0);
  // A yes/no day treated as 0/1 — point-biserial, which is Pearson underneath.
  collect("gymSameDay", (m) => (m.gym == null ? null : m.gym ? 1 : 0), 0);

  // Strongest relationships first; a flat one is not worth the reader's time.
  return out.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}

export type Strength = "positive" | "negative" | "none";

export const strength = (r: number): Strength =>
  r > 0.3 ? "positive" : r < -0.3 ? "negative" : "none";
