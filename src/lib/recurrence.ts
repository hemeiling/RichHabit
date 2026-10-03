import type { ImportantDate, RepeatRule, RepeatUnit } from "@/lib/types";

/**
 * Repeating Important Dates — which days a series lands on.
 *
 * A series is stored once: the row's own dates are its first occurrence, and a
 * small rule says how far apart the rest are. Nothing is ever generated into
 * the database; the occurrences of a window are computed when the window is
 * drawn. So "Mom's birthday, every year" is one row whether it is looked at in
 * 2026 or in 2060.
 *
 * Every occurrence is computed from the anchor, never from the occurrence
 * before it. That is what keeps a series from drifting: Jan 31 monthly is
 * Feb 28, then Mar 31 — not Mar 28 because February happened to be short.
 *
 * Short months clamp to their last day, so a birthday on Feb 29 is on Feb 28
 * in an ordinary year and back on the 29th in the next leap year, and the 31st
 * of every month is the last day of every month.
 *
 * All arithmetic is on whole calendar days, with integers, in UTC. A date here
 * is a calendar day and never an instant, so a daylight-saving change cannot
 * move one.
 */

/** The most occurrences one call will return — a guard, not a product limit. */
export const MAX_OCCURRENCES = 400;
export const MAX_REPEAT_INTERVAL = 99;
/** How many single occurrences one series may have deleted. Mirrors the CHECK. */
export const MAX_EXCLUSIONS = 500;
export const REPEAT_UNITS = ["week", "month", "year"] as const;

const DAY = 86_400_000;

/** Days since 1970-01-01 for a YYYY-MM-DD string. */
export const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
};

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export const fromDayNumber = (n: number): string => {
  const d = new Date(n * DAY);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

export const shiftDays = (iso: string, n: number) => fromDayNumber(dayNumber(iso) + n);

const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** `iso` moved by whole months, with the day clamped to the target month. */
export function addMonthsClamped(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return `${pad(ny, 4)}-${pad(nm)}-${pad(Math.min(d, lastDayOf(ny, nm)))}`;
}

const monthIndex = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return y * 12 + (m - 1);
};

/** The start date of occurrence `k` (0 = the anchor itself). */
export function nthStart(anchor: string, rule: RepeatRule, k: number): string {
  switch (rule.unit) {
    case "week": return shiftDays(anchor, 7 * rule.interval * k);
    case "month": return addMonthsClamped(anchor, rule.interval * k);
    case "year": return addMonthsClamped(anchor, 12 * rule.interval * k);
  }
}

/**
 * The shortest stretch one period can be, in days. An occurrence must fit
 * inside it, or a series would overlap itself: a nine-day "weekly" event is
 * not a thing anybody means.
 */
export function shortestPeriod(rule: Pick<RepeatRule, "unit" | "interval">): number {
  switch (rule.unit) {
    case "week": return 7 * rule.interval;
    case "month": return 28 * rule.interval;
    case "year": return 365 * rule.interval;
  }
}

/** Inclusive length in days minus one — 0 for a single day. */
const spanOf = (e: Pick<ImportantDate, "startDate" | "endDate">) =>
  dayNumber(e.endDate) - dayNumber(e.startDate);

/**
 * The first k whose start is not before `lower`.
 *
 * Jumps straight there rather than walking from the anchor, so a birthday
 * entered with its real 1958 date costs the same as one entered this year.
 * The estimate is deliberately low and then walked forward, because clamping
 * makes month arithmetic not quite invertible.
 */
function firstIndexFrom(anchor: string, rule: RepeatRule, lower: string): number {
  if (lower <= anchor) return 0;
  let k: number;
  if (rule.unit === "week") {
    k = Math.floor((dayNumber(lower) - dayNumber(anchor)) / (7 * rule.interval));
  } else {
    const step = rule.unit === "month" ? rule.interval : 12 * rule.interval;
    k = Math.floor((monthIndex(lower) - monthIndex(anchor)) / step) - 1;
  }
  k = Math.max(0, k);
  while (nthStart(anchor, rule, k) < lower) k++;
  return k;
}

export interface OccurrenceDates {
  /** The occurrence's first day, in the series' own calendar. Its identity. */
  startDate: string;
  endDate: string;
}

/**
 * Every occurrence of `event` that touches [from, to], in order.
 *
 * A non-repeating event is simply itself, when it touches the window. That is
 * the whole of the backward-compatibility story for display: an existing event
 * goes through here unchanged.
 *
 * `includeExcluded` is for checking whether a date *is* an occurrence (so one
 * can be deleted) rather than for drawing.
 */
export function occurrencesBetween(
  event: Pick<ImportantDate, "startDate" | "endDate" | "repeat" | "excludedOn">,
  from: string, to: string,
  { includeExcluded = false }: { includeExcluded?: boolean } = {},
): OccurrenceDates[] {
  const span = spanOf(event);
  const rule = event.repeat;
  if (!rule) {
    return event.startDate <= to && event.endDate >= from
      ? [{ startDate: event.startDate, endDate: event.endDate }] : [];
  }

  const excluded = includeExcluded ? null : new Set(event.excludedOn);
  const out: OccurrenceDates[] = [];
  // An occurrence that started up to `span` days before the window still runs into it.
  let k = firstIndexFrom(event.startDate, rule, shiftDays(from, -span));
  for (let guard = 0; guard < MAX_OCCURRENCES + (excluded?.size ?? 0); guard++, k++) {
    const startDate = nthStart(event.startDate, rule, k);
    if (startDate > to) break;
    if (rule.until && startDate > rule.until) break;
    if (excluded?.has(startDate)) continue;
    out.push({ startDate, endDate: shiftDays(startDate, span) });
    if (out.length >= MAX_OCCURRENCES) break;
  }
  return out;
}

/**
 * The first occurrence that has not finished by `date` — what "Upcoming" shows
 * for a series. Null when the series has ended or every remaining occurrence
 * was deleted.
 */
export function nextOccurrence(
  event: Pick<ImportantDate, "startDate" | "endDate" | "repeat" | "excludedOn">,
  date: string,
): OccurrenceDates | null {
  const rule = event.repeat;
  if (!rule) {
    return event.endDate >= date ? { startDate: event.startDate, endDate: event.endDate } : null;
  }
  const span = spanOf(event);
  const excluded = new Set(event.excludedOn);
  let k = firstIndexFrom(event.startDate, rule, shiftDays(date, -span));
  for (let guard = 0; guard < MAX_OCCURRENCES + excluded.size; guard++, k++) {
    const startDate = nthStart(event.startDate, rule, k);
    if (rule.until && startDate > rule.until) return null;
    if (excluded.has(startDate)) continue;
    return { startDate, endDate: shiftDays(startDate, span) };
  }
  return null;
}

/** Whether `date` is the start of one of the series' occurrences, deleted or not. */
export function isOccurrenceStart(
  event: Pick<ImportantDate, "startDate" | "endDate" | "repeat" | "excludedOn">,
  date: string,
): boolean {
  if (!event.repeat) return date === event.startDate;
  return occurrencesBetween({ ...event, endDate: event.startDate }, date, date,
    { includeExcluded: true }).some((o) => o.startDate === date);
}

/** True when two rules would put occurrences on different days. */
export const sameRule = (a: RepeatRule | null, b: RepeatRule | null) =>
  (a?.unit ?? null) === (b?.unit ?? null) && (a?.interval ?? 1) === (b?.interval ?? 1);

export const isRepeatUnit = (v: unknown): v is RepeatUnit =>
  typeof v === "string" && (REPEAT_UNITS as readonly string[]).includes(v);
