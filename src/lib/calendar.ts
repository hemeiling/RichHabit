import { compareEvents, covers, isAllDay, overlaps } from "@/lib/importantDates";
import { dayNumber, nextOccurrence, occurrencesBetween, shiftDays } from "@/lib/recurrence";
import { inViewerZone, minutesOf } from "@/lib/zonedTime";
import type { ImportantDate, RepeatRule } from "@/lib/types";

/**
 * The calendar as it is drawn — independent of where any of it came from.
 *
 * Everything the month grid, the Day Agenda and the Upcoming list show is a
 * `CalendarItem`: one occurrence of one thing, already placed in the reader's
 * own days and clock. The panel never reads an `ImportantDate` directly.
 *
 * That boundary is the point. Today there is one source, the person's own
 * Important Dates, and one adapter below. A later Life Calendar can add more —
 * a read-only Google or Outlook calendar, habits, priorities — as further
 * adapters producing the same shape, each from its own tables. An external
 * event stays owned by its provider: it is never copied into `important_dates`,
 * and it is never editable here (`editable: false`).
 *
 * Nothing in this module sends anything anywhere. Whether a source may be
 * *shown* and whether it may be given to an AI are separate decisions that
 * belong to that source; Important Dates are shown and are never given to one.
 */

/** Where an item came from. Only "richhabit" exists today. */
export type CalendarSource = "richhabit";

export interface CalendarItem {
  /** Unique across sources and occurrences: what React keys and lanes use. */
  id: string;
  source: CalendarSource;
  /** The record's id in its own source — for an Important Date, the row id. */
  sourceId: string;
  /**
   * Which occurrence this is: its start date in the series' own calendar.
   * Stable when the reader travels, so it is what a deletion is keyed by.
   */
  occurrenceDate: string;
  /** The person's own words, exactly as written. */
  title: string;
  /** The reader's whole days this occurrence touches, inclusive. */
  startDate: string;
  endDate: string;
  allDay: boolean;
  /** The reader's clock, on `startDate`. Null when all day. */
  startTime: string | null;
  /** The reader's clock, on `endDate`. Null when all day or open-ended. */
  endTime: string | null;
  /**
   * The time as it was written, when that differs from the reader's clock —
   * "7:00 PM Chicago" beside "8:00 PM" for somebody reading it in New York.
   */
  original: { startTime: string; timeZone: string } | null;
  color: string;
  kind: string;
  repeat: RepeatRule | null;
  hasNote: boolean;
  editable: boolean;
}

/* --------------------------- Important Dates ------------------------------ */

/** One occurrence of an Important Date, in the reader's zone. */
function itemFor(
  e: ImportantDate, occ: { startDate: string; endDate: string }, viewerZone: string | null,
): CalendarItem {
  const base = {
    id: `richhabit:${e.id}@${occ.startDate}`,
    source: "richhabit" as const,
    sourceId: e.id,
    occurrenceDate: occ.startDate,
    title: e.title,
    color: e.color,
    kind: e.kind,
    repeat: e.repeat,
    hasNote: e.note.trim().length > 0,
    editable: true,
  };
  if (isAllDay(e)) {
    // A date is a date: a birthday is on the 12th wherever it is read.
    return { ...base, startDate: occ.startDate, endDate: occ.endDate,
      allDay: true, startTime: null, endTime: null, original: null };
  }

  const start = inViewerZone(occ.startDate, e.startTime!, e.timeZone, viewerZone);
  const converted = start.date !== occ.startDate || start.time !== e.startTime;
  let endDate: string;
  let endTime: string | null = null;
  if (e.endTime) {
    const end = inViewerZone(occ.endDate, e.endTime, e.timeZone, viewerZone);
    endDate = end.date;
    endTime = end.time;
  } else {
    // Open-ended: it lasts as many days as it was written to, moved with its start.
    endDate = shiftDays(start.date, daysFrom(occ.startDate, occ.endDate));
  }
  return {
    ...base,
    startDate: start.date,
    endDate: endDate < start.date ? start.date : endDate,
    allDay: false,
    startTime: start.time,
    endTime,
    original: converted && e.timeZone ? { startTime: e.startTime!, timeZone: e.timeZone } : null,
  };
}

const daysFrom = (a: string, b: string) => dayNumber(b) - dayNumber(a);

/**
 * Every occurrence that touches the reader's days [from, to].
 *
 * The window is widened by a day each side before expanding, because a timed
 * occurrence read in another zone can land on the day before or after the one
 * it was written for; the result is then cut back to the window in the
 * reader's own days.
 */
export function importantDateItems(
  events: ImportantDate[], from: string, to: string, viewerZone: string | null,
): CalendarItem[] {
  const out: CalendarItem[] = [];
  for (const e of events) {
    const pad = isAllDay(e) ? 0 : 1;
    for (const occ of occurrencesBetween(e, shiftDays(from, -pad), shiftDays(to, pad))) {
      const item = itemFor(e, occ, viewerZone);
      if (overlaps(item, from, to)) out.push(item);
    }
  }
  return out.sort(compareEvents);
}

/**
 * The next occurrence of each event that has not finished by `today` — one row
 * per series, so a weekly event is one line in Upcoming, not fifty-two.
 */
export function upcomingItems(
  events: ImportantDate[], today: string, viewerZone: string | null,
): CalendarItem[] {
  const out: CalendarItem[] = [];
  for (const e of events) {
    // A day early for timed events, for the same reason as above.
    let from = isAllDay(e) ? today : shiftDays(today, -1);
    for (let tries = 0; tries < 3; tries++) {
      const occ = nextOccurrence(e, from);
      if (!occ) break;
      const item = itemFor(e, occ, viewerZone);
      if (item.endDate >= today) { out.push(item); break; }
      from = shiftDays(occ.startDate, 1);
    }
  }
  return out.sort(compareItems);
}

/* ------------------------------- ordering --------------------------------- */

/**
 * Calendar order, with time of day inside a date: all-day first (they frame
 * the day), then by start time. Total, like `compareEvents`.
 */
export function compareItems(a: CalendarItem, b: CalendarItem): number {
  return a.startDate.localeCompare(b.startDate)
    || Number(!a.allDay) - Number(!b.allDay)
    || (a.startTime ?? "").localeCompare(b.startTime ?? "")
    || compareEvents(a, b);
}

/* ------------------------------ Day Agenda -------------------------------- */

/**
 * How one item appears on one day of the agenda.
 *
 *   single  — a timed item that starts and ends today (or has no end)
 *   start   — a timed item that starts today and carries on past midnight
 *   end     — a timed item that started earlier and finishes today
 *   allDay  — an all-day item, or any day strictly inside a timed item
 */
export type AgendaPart = "single" | "start" | "end" | "allDay";

export interface AgendaRow {
  item: CalendarItem;
  part: AgendaPart;
  /** 1-based day within the item, and how many days it has — "Day 2 of 4". */
  day: number;
  days: number;
  /** For a timed row: the clock time it is sorted and labelled by. */
  time: string | null;
}

export interface DayAgenda {
  /** Birthdays, trips, holidays — the context for the day. Shown first. */
  allDay: AgendaRow[];
  /** Everything with a time today, in time order. */
  timed: AgendaRow[];
}

/**
 * Everything on `date`, the way the Day Agenda reads it.
 *
 * Timed rows sort by the time they are shown at, then by end, then title, so
 * the order never depends on the order they were created in — the person never
 * has to arrange a day by hand. A timed item's last day sorts at midnight
 * ("Until 6:00 AM"), which is where it is true.
 *
 * Overlapping items are simply consecutive rows, each with its own range: a
 * list does not need columns to show that two things happen at once.
 */
export function dayAgenda(items: CalendarItem[], date: string): DayAgenda {
  const allDay: AgendaRow[] = [];
  const timed: AgendaRow[] = [];
  for (const item of items) {
    if (!covers(item, date)) continue;
    const days = daysFrom(item.startDate, item.endDate) + 1;
    const day = daysFrom(item.startDate, date) + 1;
    if (item.allDay) {
      allDay.push({ item, part: "allDay", day, days, time: null });
    } else if (item.startDate === date) {
      timed.push({ item, part: days === 1 ? "single" : "start", day, days, time: item.startTime });
    } else if (item.endDate === date && item.endTime) {
      timed.push({ item, part: "end", day, days, time: "00:00" });
    } else {
      allDay.push({ item, part: "allDay", day, days, time: null });
    }
  }
  allDay.sort((a, b) => compareItems(a.item, b.item));
  timed.sort((a, b) => minutesOf(a.time!) - minutesOf(b.time!)
    || Number(a.part !== "end") - Number(b.part !== "end")
    || (a.item.endTime ?? "").localeCompare(b.item.endTime ?? "")
    || a.item.title.localeCompare(b.item.title)
    || a.item.id.localeCompare(b.item.id));
  return { allDay, timed };
}
