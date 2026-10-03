import { addDays, daysBetween } from "@/lib/dates";
import {
  MAX_REPEAT_INTERVAL, isRepeatUnit, sameRule, shortestPeriod,
} from "@/lib/recurrence";
import { minutesOf } from "@/lib/zonedTime";
import type { ImportantDate, RepeatRule } from "@/lib/types";

/**
 * Important Dates — the rules, with no React and no SQL in them.
 *
 * A deliberately small calendar: the dates *this person* considers important,
 * shown beside the day they are working through. It is not a diary and not a
 * meeting system — there are no invitations, no reminders and no per-occurrence
 * editing, because every one of those turns a glanceable panel into an
 * application that has to be maintained.
 *
 * An event is a title, a range of whole days, a colour the user picked, and
 * optionally a note, a kind, a time and a repeat. Which days it occupies is a
 * comparison of two date strings, exactly as with a priority's rollover —
 * nothing is copied into a day, so a range that crosses a month, a quarter or a
 * year boundary needs no special handling anywhere. A repeating event is one
 * row; its occurrences are computed (lib/recurrence), never stored.
 */

/**
 * The fields V2 added, at the values every event had before they existed: all
 * day, once. A row from before the migration, or a request from a client that
 * has never heard of them, reads as exactly this.
 */
export const ONE_OFF_ALL_DAY: Pick<
  ImportantDate, "startTime" | "endTime" | "timeZone" | "repeat" | "excludedOn"
> = { startTime: null, endTime: null, timeZone: null, repeat: null, excludedOn: [] };

export const isAllDay = (e: Pick<ImportantDate, "startTime">) => e.startTime == null;

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
export const EVENT_KINDS = [
  "none", "birthday", "anniversary", "holiday", "travel", "work", "personal", "deadline",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Shown beside the title. Derived from the kind, never written into the title. */
export const KIND_EMOJI: Partial<Record<string, string>> = {
  birthday: "🎂",
  anniversary: "❤️",
  holiday: "🎉",
};

/**
 * Kinds that are, in practice, every year. Choosing one sets the repeat to
 * yearly — but only while the person has not chosen a repeat themselves.
 */
export const YEARLY_KINDS: readonly string[] = ["birthday", "anniversary"];

export const YEARLY: RepeatRule = { unit: "year", interval: 1, until: null };

/**
 * The kind chosen, and the repeat that should follow from it.
 *
 * `repeatChosen` is whether the person has touched the repeat control in this
 * editor. A birthday on an event they already set to "every month" stays
 * monthly; one they never touched becomes yearly. Choosing a different kind
 * afterwards never undoes it — that would be a second surprise.
 */
export function withKind(e: ImportantDate, kind: string, repeatChosen: boolean): ImportantDate {
  const next = { ...e, kind };
  if (!repeatChosen && !e.repeat && YEARLY_KINDS.includes(kind)) next.repeat = YEARLY;
  return next;
}

/* ------------------------------- limits ----------------------------------- */

export const MAX_EVENT_TITLE = 120;
/**
 * Long-form on purpose.
 *
 * A note started life as one line about a trip and is in practice where the
 * trip itself gets written down: the flight times, the hotel address, the
 * agenda, what to bring, the instructions somebody emailed. 500 characters
 * turned every one of those into a decision about what to leave out.
 *
 * 10,000 is the same ceiling the journal reflection, the monthly reflection and
 * every weekly-review field already use, so the app has one answer to "how much
 * text may a person write" rather than five. Line breaks are kept exactly as
 * typed or pasted; nothing is trimmed but the ends.
 */
export const MAX_EVENT_NOTE = 10_000;
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

/**
 * The least anything drawn on the calendar has to be: an identity, a name and
 * the whole days it touches. An `ImportantDate` is one; so is a `CalendarItem`
 * (lib/calendar), which is what the panel actually draws — one per occurrence,
 * from whichever source it came from. The functions below take either.
 */
export interface Span {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
}

/** True when `date` falls inside the event's range, ends included. */
export const covers = (e: Span, date: string) =>
  e.startDate <= date && e.endDate >= date;

/** True when the event touches the window [from, to] at all. */
export const overlaps = (e: Span, from: string, to: string) =>
  e.startDate <= to && e.endDate >= from;

/**
 * The order events are read in, everywhere: earliest first, then longest first
 * where two start together, then by title so the result never depends on the
 * order rows came back in. The lane layout below relies on this being total.
 */
export function compareEvents(a: Span, b: Span): number {
  return a.startDate.localeCompare(b.startDate)
    || b.endDate.localeCompare(a.endDate)
    || a.title.localeCompare(b.title)
    || a.id.localeCompare(b.id);
}

export const eventsOn = <T extends Span>(all: T[], date: string): T[] =>
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
export const upcomingEvents = <T extends Span>(all: T[], today: string, limit = 5): T[] =>
  all.filter((e) => e.endDate >= today).sort(compareEvents).slice(0, limit);

export const pastEvents = <T extends Span>(all: T[], today: string): T[] =>
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
export interface EventBar<T extends Span = ImportantDate> {
  event: T;
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
export function layoutWeek<T extends Span>(all: T[], week: string[]): EventBar<T>[] {
  const from = week[0];
  const to = week[week.length - 1];
  const bars: EventBar<T>[] = [];
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
export function layoutWeekCapped<T extends Span>(
  all: T[], week: string[], maxLanes: number,
): { bars: EventBar<T>[]; hidden: Record<string, number> } {
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
export type EventProblem =
  | "titleRequired" | "endBeforeStart" | "tooLong" | "noteTooLong"
  | "endTimeBeforeStart" | "repeatTooShort" | "untilBeforeStart" | "intervalRange";

/** "HH:MM", 00:00–23:59. Seconds are not a thing a personal calendar has. */
export const isClockTime = (v: unknown): v is string =>
  typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export function eventProblem(e: {
  title: string; startDate: string; endDate: string; note?: string;
  startTime?: string | null; endTime?: string | null; repeat?: RepeatRule | null;
}): EventProblem | null {
  if (!e.title.trim()) return "titleRequired";
  if (e.endDate < e.startDate) return "endBeforeStart";
  if (daysBetween(e.startDate, e.endDate) + 1 > MAX_EVENT_DAYS) return "tooLong";
  /*
   * Same day, end not after start. "10 PM – 1 AM" is a real evening, so the
   * editor moves the end to the next day as it is typed (`withEndTime`); this
   * only catches what is left, such as an end time equal to the start.
   */
  if (e.startTime && e.endTime && e.startDate === e.endDate
    && minutesOf(e.endTime) <= minutesOf(e.startTime)) return "endTimeBeforeStart";
  if (e.repeat) {
    const { interval, until } = e.repeat;
    if (!Number.isInteger(interval) || interval < 1 || interval > MAX_REPEAT_INTERVAL) {
      return "intervalRange";
    }
    if (until && until < e.startDate) return "untilBeforeStart";
    /* An occurrence has to end before the next one starts, or the series
       overlaps itself — a nine-day "weekly" event is not something anyone means. */
    if (daysBetween(e.startDate, e.endDate) + 1 > shortestPeriod(e.repeat)) return "repeatTooShort";
  }
  /*
   * Checked here rather than capped by the textarea's `maxLength`. A cap looks
   * tidier and is worse: pasting a 12,000-character agenda into a capped box
   * silently keeps the first 10,000 and drops the rest, and the person only
   * finds out later that the return flight is missing. Telling them the note is
   * too long leaves every character on screen and the decision about what to
   * cut with the person who knows which part matters.
   */
  if ((e.note ?? "").length > MAX_EVENT_NOTE) return "noteTooLong";
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

/* -------------------------------- time ------------------------------------ */

/**
 * Where "All day" off starts: the next full hour when the event is today, and
 * 9 AM otherwise. Either is a guess, and either is one tap from right.
 */
export function suggestedStartTime(eventDate: string, today: string, now = new Date()): string {
  if (eventDate !== today) return "09:00";
  const hour = Math.min(23, now.getHours() + 1);
  return `${String(hour).padStart(2, "0")}:00`;
}

/**
 * All day on or off.
 *
 * Off fills in a start time and the device's zone; on clears all three. The
 * editor keeps the times it cleared in its own state, so toggling back and
 * forth before saving loses nothing.
 */
export function withAllDay(
  e: ImportantDate, allDay: boolean, startTime: string, endTime: string | null,
  timeZone: string | null,
): ImportantDate {
  if (allDay) return { ...e, startTime: null, endTime: null, timeZone: null };
  return withEndTime({ ...e, startTime, timeZone: e.timeZone ?? timeZone }, endTime);
}

/**
 * An end time that is earlier than the start on the same day means the next
 * day — "10 PM – 1 AM" — so the end date moves with it. That is the only date
 * a time ever changes.
 */
export function withEndTime(e: ImportantDate, endTime: string | null): ImportantDate {
  const next = { ...e, endTime };
  if (endTime && e.startTime && e.startDate === e.endDate
    && minutesOf(endTime) < minutesOf(e.startTime)) {
    next.endDate = addDays(e.startDate, 1);
  }
  return next;
}

/* ------------------------------- repeat ----------------------------------- */

export type RepeatPreset = "none" | "year" | "month" | "week" | "custom";
export const REPEAT_PRESETS: readonly RepeatPreset[] = ["none", "year", "month", "week", "custom"];

/** What the Repeat chips show for a stored rule. */
export function repeatPreset(rule: RepeatRule | null): RepeatPreset {
  if (!rule) return "none";
  return rule.interval === 1 && !rule.until ? rule.unit : "custom";
}

/** The rule a preset chip stands for. Custom keeps whatever is there. */
export function ruleFor(preset: RepeatPreset, current: RepeatRule | null): RepeatRule | null {
  if (preset === "none") return null;
  if (preset === "custom") return current ?? { unit: "week", interval: 1, until: null };
  return { unit: preset, interval: 1, until: null };
}

/**
 * The series as it should be after an edit to the whole of it.
 *
 * Deleted occurrences are remembered by date, so they stay meaningful only
 * while the series lands on the same dates. Moving the first date, or changing
 * the unit or the interval, moves every occurrence — and an old deletion could
 * then hide a date that was never deleted. Those edits start the deletions
 * afresh; a title, a time, a colour or an end date leaves them alone.
 *
 * The database applies exactly the same rule in `saveImportantDate`, so the
 * screen and the stored row cannot disagree about what survived.
 */
export function seriesAfterEdit(before: ImportantDate | undefined, after: ImportantDate): ImportantDate {
  if (!before) return { ...after, excludedOn: [] };
  const moved = before.startDate !== after.startDate || !sameRule(before.repeat, after.repeat);
  return { ...after, excludedOn: moved || !after.repeat ? [] : before.excludedOn };
}

export { isRepeatUnit };
