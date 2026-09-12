import { daysInMonth } from "@/lib/dates";
import { QUADRANTS, doneOn } from "@/lib/priorities";
import { normalizePriorityCategory, type Priority } from "@/lib/types";

/**
 * Accomplishments — completed priorities, looked back on.
 *
 * There is no accomplishment record. A priority is an accomplishment exactly
 * when its `completed_on` is set, and that date is the day it counts on. Every
 * rule in this file reads the priority rows the app already holds, so the
 * number on Insights, the number in My Progress and the number on Community are
 * one definition applied three times, not three stores that could drift apart.
 *
 * The consequences follow from the row rather than from any bookkeeping here:
 *
 *   - completing a priority adds one accomplishment, on the day it was ticked;
 *   - reopening it clears the date, so it stops counting;
 *   - completing it again counts it once, on the new day;
 *   - deleting it removes the row, and the accomplishment with it.
 *
 * Dates are the user's own calendar days as 'YYYY-MM-DD' strings, the same
 * strings `completed_on` stores, so comparing them is ordinary string order.
 * `today` is always passed in: nothing counts past it, which keeps a device with
 * a wrong clock from inventing accomplishments in a month that has not started.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** Completed priorities whose completion date is within [from, to], inclusive. */
export function accomplishedBetween(all: Priority[], from: string, to: string): Priority[] {
  if (from > to) return [];
  return all.filter((p) => p.completedOn !== null && p.completedOn >= from && p.completedOn <= to);
}

/** What was accomplished on one day. */
export const accomplishedOn = (all: Priority[], date: string): Priority[] =>
  accomplishedBetween(all, date, date);

const earlier = (a: string, b: string) => (a < b ? a : b);

/** A calendar month's accomplishments, never counting past `today`. */
export function accomplishedInMonth(all: Priority[], month: string, today: string): Priority[] {
  const last = `${month}-${pad(daysInMonth(month))}`;
  return accomplishedBetween(all, `${month}-01`, earlier(last, today));
}

/** A calendar year's accomplishments, never counting past `today`. */
export function accomplishedInYear(all: Priority[], year: string, today: string): Priority[] {
  return accomplishedBetween(all, `${year}-01-01`, earlier(`${year}-12-31`, today));
}

/** One count per day of the month; days after `today` are always zero. */
export function countsByDay(all: Priority[], month: string, today: string): number[] {
  const counts = new Array<number>(daysInMonth(month)).fill(0);
  for (const p of accomplishedInMonth(all, month, today)) counts[Number(p.completedOn!.slice(8, 10)) - 1] += 1;
  return counts;
}

/** One count per month of the year; months after `today` are always zero. */
export function countsByMonth(all: Priority[], year: string, today: string): number[] {
  const counts = new Array<number>(12).fill(0);
  for (const p of accomplishedInYear(all, year, today)) counts[Number(p.completedOn!.slice(5, 7)) - 1] += 1;
  return counts;
}

export interface AccomplishmentDay {
  date: string;
  items: Priority[];
}

/**
 * Accomplishments grouped by the day they were completed, newest day first.
 *
 * Within a day there is no completion time to sort by, so items follow the
 * compass's own reading order: quadrant, then the user's arrangement. A
 * priority's id breaks any remaining tie so the list never reshuffles.
 */
export function groupByDay(items: Priority[]): AccomplishmentDay[] {
  const quadrant = (p: Priority) => QUADRANTS.indexOf(normalizePriorityCategory(p.category));
  const byDate = new Map<string, Priority[]>();
  for (const p of items) {
    if (p.completedOn === null) continue;
    byDate.set(p.completedOn, [...(byDate.get(p.completedOn) ?? []), p]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, list]) => ({
      date,
      items: [...list].sort((a, b) =>
        quadrant(a) - quadrant(b) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id)),
    }));
}

/**
 * The day a completed priority was first written, when that was before the day
 * it was finished. Shown as "from Sep 5": how long something was carried is part
 * of what finishing it meant.
 */
export const carriedSince = (p: Priority): string | null =>
  p.completedOn !== null && p.createdOn < p.completedOn ? p.createdOn : null;

/**
 * Whether removing a card needs a second step.
 *
 * A completed priority is part of the user's history and their accomplishment
 * totals, and deleting it is permanent, so it asks first. An open priority is
 * still just a line on today's list and keeps its one-click remove.
 */
export const needsDeleteConfirmation = (p: Priority, date: string): boolean => doneOn(p, date);
