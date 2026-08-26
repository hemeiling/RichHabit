import { addDays, daysBetween } from "@/lib/dates";
import type { ImportantDate } from "@/lib/types";

/**
 * Important Dates — the rules, with no React and no SQL in them.
 *
 * A deliberately small calendar: the dates *this person* considers important,
 * shown beside the day they are working through. It is not a diary and not a
 * meeting system — there are no times, no invitations, no recurrence and no
 * reminders, because every one of those turns a glanceable panel into an
 * application that has to be maintained.
 *
 * An event is a title, a range of whole days, a colour the user picked, and
 * optionally a note and a kind. Which days it occupies is a comparison of two
 * date strings, exactly as with a priority's rollover — nothing is copied into
 * a day, so a range that crosses a month, a quarter or a year boundary needs no
 * special handling anywhere.
 */

/* ------------------------------- colour ---------------------------------- */

/**
 * The palette offered in the editor.
 *
 * Mid-tone hexes rather than theme variables: the colour belongs to the event
 * and has to mean the same thing in the calendar, in the upcoming list and in
 * the editor, in either theme. Each was chosen to hold its identity against
 * both #FFFFFF and #17191C, and the soft fills used behind them are mixed from
 * the same value at render time.
 */
export const EVENT_COLORS = [
  { key: "teal", hex: "#2F8F7A" },
  { key: "blue", hex: "#3E76C4" },
  { key: "violet", hex: "#7A62C9" },
  { key: "rose", hex: "#C4577F" },
  { key: "amber", hex: "#C08A2E" },
  { key: "clay", hex: "#C05A45" },
  { key: "green", hex: "#5A9142" },
  { key: "slate", hex: "#66707E" },
] as const;

export type EventColorKey = (typeof EVENT_COLORS)[number]["key"];

export const DEFAULT_EVENT_COLOR: EventColorKey = "blue";

const HEX = /^#[0-9a-fA-F]{6}$/;
const BY_KEY = new Map<string, string>(EVENT_COLORS.map((c) => [c.key, c.hex]));

/** True for a palette key or a plain `#rrggbb`. Nothing else is stored. */
export const isEventColor = (v: unknown): v is string =>
  typeof v === "string" && (BY_KEY.has(v) || HEX.test(v));

/**
 * The colour to actually paint with.
 *
 * Palette entries are stored as keys rather than hexes so the palette can be
 * retuned later without rewriting anyone's rows; a custom colour is stored as
 * the hex the user chose, because there is nothing else it could mean.
 */
export const colorHex = (color: string): string =>
  BY_KEY.get(color) ?? (HEX.test(color) ? color : BY_KEY.get(DEFAULT_EVENT_COLOR)!);

/* -------------------------------- kind ------------------------------------ */

/**
 * An optional label, stored as an English key and translated on render — the
 * same treatment goal areas and spending categories get, so an existing row
 * keeps its meaning after a language change.
 */
export const EVENT_KINDS = ["none", "travel", "work", "personal", "deadline"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/* ------------------------------- limits ----------------------------------- */

export const MAX_EVENT_TITLE = 120;
export const MAX_EVENT_NOTE = 500;
/**
 * A little over a year. Not an opinion about how long something may last: a
 * range paints every day it covers, and a ten-year "event" would flood every
 * month anyone ever navigates to. Past this it is a season of life, not a date.
 */
export const MAX_EVENT_DAYS = 370;

/** How many days a range covers, counting both ends. */
export const eventLength = (e: Pick<ImportantDate, "startDate" | "endDate">) =>
  daysBetween(e.startDate, e.endDate) + 1;

/* ------------------------------ selection --------------------------------- */

/** True when `date` falls inside the event's range, ends included. */
export const covers = (e: ImportantDate, date: string) =>
  e.startDate <= date && e.endDate >= date;

/** True when the event touches the window [from, to] at all. */
export const overlaps = (e: ImportantDate, from: string, to: string) =>
  e.startDate <= to && e.endDate >= from;

/**
 * The order events are read in, everywhere: earliest first, then longest first
 * where two start together, then by title so the result never depends on the
 * order rows came back in. The lane layout below relies on this being total.
 */
export function compareEvents(a: ImportantDate, b: ImportantDate): number {
  return a.startDate.localeCompare(b.startDate)
    || b.endDate.localeCompare(a.endDate)
    || a.title.localeCompare(b.title)
    || a.id.localeCompare(b.id);
}

export const eventsOn = (all: ImportantDate[], date: string): ImportantDate[] =>
  all.filter((e) => covers(e, date)).sort(compareEvents);

/**
 * What to show in the upcoming list: anything not yet finished, soonest first.
 *
 * An event that started yesterday and runs until Friday is upcoming — it is
 * happening. Only what is entirely in the past drops out, and it drops out of
 * the *list* alone: the row is untouched and the month it belongs to still
 * shows it, which is what "past events stay available but stop cluttering"
 * has to mean if history is to be worth keeping.
 */
export const upcomingEvents = (all: ImportantDate[], today: string, limit = 5) =>
  all.filter((e) => e.endDate >= today).sort(compareEvents).slice(0, limit);

export const pastEvents = (all: ImportantDate[], today: string) =>
  all.filter((e) => e.endDate < today);

/* ------------------------------- layout ----------------------------------- */

/**
 * One event's bar within one week row.
 *
 * `startIndex`/`endIndex` are columns 0-6, so a range that begins before the
 * row or ends after it is clipped to the row and says so. `lane` is the line it
 * sits on, and it is the reason this is computed for a whole row at once rather
 * than per day: an event has to stay on the same line across all seven columns,
 * or a five-day bar reads as five unrelated marks.
 */
export interface EventBar {
  event: ImportantDate;
  lane: number;
  startIndex: number;
  endIndex: number;
  /** The range carries on past this row's edge — draw the end square, not round. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/**
 * Places one week's events into lanes.
 *
 * Greedy, on events already in `compareEvents` order: each takes the lowest
 * lane free for every column it covers. That is the standard calendar layout
 * and it has the property that matters here — it is a pure function of the
 * events, so the same event lands on the same lane on every render, in both
 * months when its range spans two, and after any unrelated event is added.
 */
export function layoutWeek(all: ImportantDate[], week: string[]): EventBar[] {
  const from = week[0];
  const to = week[week.length - 1];
  const bars: EventBar[] = [];
  /** lanes[lane][column] — taken or not. */
  const lanes: boolean[][] = [];

  for (const event of all.filter((e) => overlaps(e, from, to)).sort(compareEvents)) {
    const startIndex = Math.max(0, week.indexOf(maxDate(event.startDate, from)));
    const endIndex = Math.min(week.length - 1, week.indexOf(minDate(event.endDate, to)));
    if (startIndex < 0 || endIndex < startIndex) continue;

    let lane = 0;
    for (; ; lane++) {
      lanes[lane] ??= new Array(week.length).fill(false);
      if (lanes[lane].slice(startIndex, endIndex + 1).every((taken) => !taken)) break;
    }
    for (let i = startIndex; i <= endIndex; i++) lanes[lane][i] = true;

    bars.push({
      event,
      lane,
      startIndex,
      endIndex,
      continuesBefore: event.startDate < from,
      continuesAfter: event.endDate > to,
    });
  }
  return bars;
}

const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string) => (a < b ? a : b);

/**
 * The same layout, capped at the lanes a 300px panel can actually show, plus
 * how many events each day had to leave out.
 *
 * The overflow count is per *day* rather than per row, because that is the
 * question the person asking has: "is there anything else on the 9th?" — and
 * the day cell is where they can go and see.
 */
export function layoutWeekCapped(
  all: ImportantDate[], week: string[], maxLanes: number,
): { bars: EventBar[]; hidden: Record<string, number> } {
  const laid = layoutWeek(all, week);
  const hidden: Record<string, number> = {};
  for (const bar of laid.filter((b) => b.lane >= maxLanes)) {
    for (let i = bar.startIndex; i <= bar.endIndex; i++) {
      hidden[week[i]] = (hidden[week[i]] ?? 0) + 1;
    }
  }
  return { bars: laid.filter((b) => b.lane < maxLanes), hidden };
}

/* ------------------------------ validation -------------------------------- */

/**
 * The one definition of "is this a usable event", shared by the editor and by
 * the request parser so the form can never offer something the server refuses.
 * Returns a key the dictionaries translate, or null when the event is fine.
 */
export type EventProblem = "titleRequired" | "endBeforeStart" | "tooLong";

export function eventProblem(e: {
  title: string; startDate: string; endDate: string;
}): EventProblem | null {
  if (!e.title.trim()) return "titleRequired";
  if (e.endDate < e.startDate) return "endBeforeStart";
  if (daysBetween(e.startDate, e.endDate) + 1 > MAX_EVENT_DAYS) return "tooLong";
  return null;
}

/**
 * Moving the start of an event drags its end with it, keeping the length.
 *
 * Changing "Sep 9–11" to start on the 10th means the 10th to the 12th, not an
 * error and not a silently one-day event. Moving the *end* earlier than the
 * start is the only case where a value is overwritten, and it collapses to a
 * single day — the shortest thing the user can have meant.
 */
export function withStart(e: ImportantDate, startDate: string): ImportantDate {
  const span = daysBetween(e.startDate, e.endDate);
  return { ...e, startDate, endDate: addDays(startDate, Math.max(0, span)) };
}

export function withEnd(e: ImportantDate, endDate: string): ImportantDate {
  return endDate < e.startDate ? { ...e, startDate: endDate, endDate } : { ...e, endDate };
}
