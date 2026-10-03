/**
 * Clock times in a named time zone, and nothing else.
 *
 * A timed Important Date is stored the way people say it and the way calendar
 * providers store it: a local date, a local clock time and the IANA zone it was
 * meant in ("2026-10-12 19:00 America/Chicago"). Never as a UTC instant — a
 * weekly 7 PM meeting has to stay 7 PM across a daylight-saving change, and
 * only the wall clock plus the zone can say that.
 *
 * This module turns that triple into an instant and back, so an event can be
 * shown at the right moment to somebody reading it in another zone. It uses
 * only `Intl`, which every supported browser and Node ship with, behind three
 * small functions — so it can be replaced by `Temporal` later without anything
 * else noticing.
 *
 * A null zone means "floating": the same clock time wherever the reader is.
 * The schema allows it and this module honours it; V1 never writes it except
 * when a device cannot report its zone at all.
 */

const MINUTE = 60_000;
const DAY = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True for a zone this runtime can actually convert with. */
export function isTimeZone(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > 64) return false;
  if (!/^[A-Za-z0-9_+\-/]+$/.test(v)) return false;
  try {
    formatterFor(v);
    return true;
  } catch {
    return false;
  }
}

/** The device's IANA zone, or null when it cannot say. */
export function deviceTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isTimeZone(tz) ? tz : null;
  } catch {
    return null;
  }
}

/** The wall clock in `timeZone` at instant `ms`, as UTC-fields milliseconds. */
function wallClockAt(ms: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
}

/** How far `timeZone` is ahead of UTC at instant `ms`, in milliseconds. */
const offsetAt = (ms: number, timeZone: string) =>
  wallClockAt(ms, timeZone) - Math.floor(ms / 1000) * 1000;

const wallMs = (date: string, time: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return Date.UTC(y, m - 1, d, h, mi);
};

/**
 * The instant at which `date time` happens in `timeZone`.
 *
 * Two clock times a year are awkward, and both follow iCalendar (RFC 5545):
 *   - one that does not exist (2:30 on the spring-forward night) moves forward
 *     by the gap, to 3:30;
 *   - one that happens twice (1:30 on the fall-back night) means the first.
 */
export function zonedToInstant(date: string, time: string, timeZone: string): number {
  const local = wallMs(date, time);
  // Transitions are months apart, so a day either side sees both offsets.
  const before = offsetAt(local - DAY, timeZone);
  const after = offsetAt(local + DAY, timeZone);
  const candidates = [local - before, local - after]
    .filter((t) => wallClockAt(t, timeZone) === local)
    .sort((a, b) => a - b);
  // A gap has no valid candidate; the earlier offset carries it past the gap.
  return candidates[0] ?? local - before;
}

/** An instant as a local date and HH:MM in `timeZone`. */
export function instantToZoned(ms: number, timeZone: string): { date: string; time: string } {
  const wall = new Date(wallClockAt(ms, timeZone));
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return {
    date: `${p(wall.getUTCFullYear(), 4)}-${p(wall.getUTCMonth() + 1)}-${p(wall.getUTCDate())}`,
    time: `${p(wall.getUTCHours())}:${p(wall.getUTCMinutes())}`,
  };
}

/**
 * A stored clock time as the reader sees it.
 *
 * Unchanged when the event floats or the reader is in the event's own zone —
 * the normal case — and converted otherwise.
 */
export function inViewerZone(
  date: string, time: string, eventZone: string | null, viewerZone: string | null,
): { date: string; time: string } {
  if (!eventZone || !viewerZone || eventZone === viewerZone) return { date, time };
  return instantToZoned(zonedToInstant(date, time, eventZone), viewerZone);
}

/** "America/Chicago" → "Chicago". The zone's own city, untranslated. */
export const zoneCity = (timeZone: string) =>
  (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");

/** Minutes since midnight for "HH:MM". */
export const minutesOf = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

export const MINUTES_PER_DAY = DAY / MINUTE;
