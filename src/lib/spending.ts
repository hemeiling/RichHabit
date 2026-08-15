/**
 * Spending awareness arithmetic (reference §27).
 *
 * Pure, and separate from the screen, for two reasons: the percentages are the
 * whole point of the module and deserve tests, and month arithmetic is easy to
 * get quietly wrong. Subtracting a month with `Date.setMonth` lands on March 3
 * when today is March 31, which would silently compare a month against itself.
 * Months are handled here as `YYYY-MM` strings, where the arithmetic is exact.
 *
 * Nothing here judges. There is no budget, no target and no "over". §27 asks
 * for awareness, and a module that scored people would become the opposite.
 */

import { SPENDING_CATEGORIES } from "@/lib/types";
import type { SpendingRecord } from "@/lib/types";

export interface CategoryShare {
  key: string;
  spent: number;
  /** Share of the month's tracked spending, 0–100. */
  pct: number;
}

export interface SpendingSummary {
  total: number;
  /** Not planned for ahead of time. */
  unplanned: number;
  /** Wanted rather than needed. Someone's own judgement, not ours. */
  wants: number;
  /** Percentages, or null when there is nothing to take a percentage of. */
  unplannedPct: number | null;
  wantPct: number | null;
  /** Change against the previous month, or null when there is no month to compare. */
  changePct: number | null;
  /** Only categories with spending, largest first. */
  byCategory: CategoryShare[];
}

/** The `YYYY-MM` a date belongs to. */
export const monthOf = (iso: string): string => iso.slice(0, 7);

/** The `YYYY-MM` before a given one. Handles the January boundary. */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1
    ? `${y - 1}-12`
    : `${y}-${String(m - 1).padStart(2, "0")}`;
}

const sum = (rs: SpendingRecord[]) => rs.reduce((a, r) => a + r.amount, 0);

/** Rounded to cents, so summed floats do not surface as 41.900000000000006. */
const cents = (n: number) => Math.round(n * 100) / 100;

const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

export function summarise(records: SpendingRecord[], month: string): SpendingSummary {
  const current = records.filter((r) => monthOf(r.date) === month);
  const previous = records.filter((r) => monthOf(r.date) === previousMonth(month));

  const total = cents(sum(current));
  const before = cents(sum(previous));
  const unplanned = cents(sum(current.filter((r) => !r.planned)));
  const wants = cents(sum(current.filter((r) => r.needWant === "want")));

  /**
   * A category the user has never used contributes nothing and is left out
   * entirely — an empty row reads as a prompt to spend there.
   */
  const byCategory = SPENDING_CATEGORIES
    .map((key) => {
      const spent = cents(sum(current.filter((r) => r.category === key)));
      return { key: key as string, spent, pct: share(spent, total) ?? 0 };
    })
    .filter((c) => c.spent > 0)
    .sort((a, b) => b.spent - a.spent);

  return {
    total,
    unplanned,
    wants,
    unplannedPct: share(unplanned, total),
    wantPct: share(wants, total),
    // A previous month of exactly zero gives no meaningful percentage change.
    changePct: before > 0 ? ((total - before) / before) * 100 : null,
    byCategory,
  };
}
