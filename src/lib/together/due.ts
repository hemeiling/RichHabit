import { addDays, daysBetween, parseISO } from "@/lib/dates";

/**
 * How a task's due date reads. A due date is a pure calendar date — no time and
 * no time zone — so "today" is today in the reader's own calendar, worked out
 * where they are (the browser), and two members a time zone apart may see a
 * task become "today" on their own mornings. That is the honest reading of a
 * date without a time.
 *
 * The treatment is deliberately calm. Nothing is red: today and overdue share
 * the warm accent, which asks for attention without alarm, and a finished task
 * has no due treatment at all.
 *
 *   later    — more than a week away: quiet, a plain date
 *   soon     — within the week: the weekday, in normal ink
 *   tomorrow — "Tomorrow"
 *   today    — "Today", warm
 *   overdue  — "Was due Oct 2", warm
 */
export type DueState = "later" | "soon" | "tomorrow" | "today" | "overdue";

export function dueState(dueOn: string, today: string): DueState {
  const days = daysBetween(today, dueOn);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 6) return "soon";
  return "later";
}

/** Whether a state asks for the warm accent. */
export const isWarm = (state: DueState) => state === "today" || state === "overdue";

/** The quick picks in the task sheet, relative to the reader's today. */
export function quickDue(today: string): { today: string; tomorrow: string; nextWeek: string } {
  // "Next week" is the coming Monday — the start of next week in both calendars
  // people here use — rather than "seven days from now", which lands on today's weekday.
  const dow = parseISO(today).getDay();
  const toMonday = ((8 - dow) % 7) || 7;
  return { today, tomorrow: addDays(today, 1), nextWeek: addDays(today, toMonday) };
}

/** A real calendar date in the range the database accepts. */
export function isDueDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    && y >= 2000 && y <= 2100;
}
