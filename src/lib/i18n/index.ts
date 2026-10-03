import { instantDate, monthFirst, parseISO, prettyDate, shortDate } from "@/lib/dates";
import { both, joinPair } from "./both";
import { en, type Dict } from "./en";
import { zh } from "./zh";

/**
 * Locale resolution, shared by server and client. Deliberately free of React
 * and of `next/headers` so route handlers, server components and the browser
 * can all use it.
 */

export const LOCALES = ["both", "en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * `both` renders every label in both languages at once. It is not the default —
 * a new visitor gets their browser's language — but it stays available for a
 * shared screen where two people read different ones.
 */
export const DEFAULT_LOCALE: Locale = "en";
// Re-exported from the shared cookie module so there is one definition.
export { LOCALE_COOKIE } from "@/lib/cookies";

export const dictionaries: Record<Locale, Dict> = { both, en, zh };

export const isLocale = (v: unknown): v is Locale =>
  typeof v === "string" && (LOCALES as readonly string[]).includes(v);

export const dict = (locale: Locale): Dict => dictionaries[locale] ?? both;

/** BCP-47 tags for Intl, which needs a region to format dates sensibly. */
const INTL_TAG: Record<Locale, string> = { both: "en-US", en: "en-US", zh: "zh-CN" };
export const intlTag = (locale: Locale) => INTL_TAG[locale] ?? "en-US";

/**
 * Dates carry both calendars in bilingual mode — "Thursday, August 13" means
 * nothing to a Chinese reader and 8月13日星期四 means nothing to an English one.
 */
export function prettyDateFor(iso: string, locale: Locale): string {
  return locale === "both"
    ? joinPair(prettyDate(iso, "en-US"), prettyDate(iso, "zh-CN"))
    : prettyDate(iso, intlTag(locale));
}

export function shortDateFor(iso: string, locale: Locale): string {
  return locale === "both"
    ? joinPair(shortDate(iso, "en-US"), shortDate(iso, "zh-CN"))
    : shortDate(iso, intlTag(locale));
}

/**
 * A wall-clock "HH:MM" for reading: "7:00 PM" in English, "19:00" in Chinese.
 *
 * One format in bilingual mode, not two: the time column of the Day Agenda is
 * a fixed narrow width, digits read the same in both languages, and "7:00 PM ·
 * 19:00" would say the same thing twice.
 */
export function clockTimeFor(time: string, locale: Locale): string {
  const [h, m] = time.split(":").map(Number);
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(
    locale === "zh" ? "zh-CN" : "en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

/**
 * A time zone as a reader names it: "Central Time", "北美中部时间", "China
 * Standard Time" — never the IANA id it is stored as.
 *
 * The id names a city ("America/Chicago"), and somebody in Houston who never
 * typed "Chicago" should not be shown it. The generic long name is the one that
 * means the region, and it does not flip between daylight and standard time
 * across the year. Bilingual mode uses the English name, as it does for the
 * clock. Engines without the generic style fall back to the dated long name,
 * then to the id's city.
 */
export function zoneLabelFor(timeZone: string, locale: Locale, at: number = Date.now()): string {
  const tag = locale === "zh" ? "zh-CN" : "en-US";
  for (const style of ["longGeneric", "long"] as const) {
    try {
      const name = new Intl.DateTimeFormat(tag, { timeZone, timeZoneName: style })
        .formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")?.value;
      if (name) return name;
    } catch {
      // This engine does not know the style; try the next one.
    }
  }
  return (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");
}

/**
 * A calendar month as a heading: "Aug 2026", "2026年8月".
 *
 * The year is always shown. A two-month window that rolls forward crosses New
 * Year twice a year, and a heading that silently omitted the year would be
 * wrong exactly then — for a calendar people navigate months into the future,
 * that is the moment it most needs to be unambiguous.
 */
export function monthTitleFor(month: string, locale: Locale): string {
  const one = (tag: string) =>
    parseISO(monthFirst(month)).toLocaleDateString(tag, { year: "numeric", month: "short" });
  return locale === "both" ? joinPair(one("en-US"), one("zh-CN")) : one(intlTag(locale));
}

/**
 * A span of whole days: "Aug 28", "Sep 9–11", "Aug 28 – Sep 2".
 *
 * Compacted within a month because that is how a date range is read aloud in
 * both languages — "9月9日–11日" is as natural as "Sep 9–11" — and because the
 * upcoming list has one narrow line per event. Built per language rather than
 * assembled from already-bilingual parts, which would render each half twice.
 */
export function dateRangeFor(startISO: string, endISO: string, locale: Locale): string {
  const one = (tag: string) => {
    if (startISO === endISO) return shortDate(startISO, tag);
    if (startISO.slice(0, 7) === endISO.slice(0, 7)) {
      const day = parseISO(endISO).toLocaleDateString(tag, { day: "numeric" });
      return `${shortDate(startISO, tag)}–${day}`;
    }
    return `${shortDate(startISO, tag)} – ${shortDate(endISO, tag)}`;
  };
  return locale === "both" ? joinPair(one("en-US"), one("zh-CN")) : one(intlTag(locale));
}

export function instantDateFor(iso: string, locale: Locale): string {
  return locale === "both"
    ? joinPair(instantDate(iso, "en-US"), instantDate(iso, "zh-CN"))
    : instantDate(iso, intlTag(locale));
}

/**
 * The locale for a request: an explicit choice first, then the browser's
 * language, then English.
 */
export function resolveLocale(cookieValue?: string | null): Locale {
  /*
   * A choice, or English.
   *
   * This used to read the browser's Accept-Language when there was no choice
   * yet, so a visitor on a Chinese device met a Chinese page before they had
   * asked for one. Nothing is inferred now — not the browser, not the operating
   * system, not the region — because a guessed language is indistinguishable
   * from a preference the reader never set and cannot account for.
   *
   * The only input is this account's or this browser's own explicit choice,
   * which the language switch writes. Everything else is English.
   */
  return isLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE;
}

export type { Dict };
export { en, zh, both };
