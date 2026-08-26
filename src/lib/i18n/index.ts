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
export function resolveLocale(
  cookieValue?: string | null,
  acceptLanguage?: string | null,
): Locale {
  // An explicit choice always wins over what the device happens to be set to.
  if (isLocale(cookieValue)) return cookieValue;

  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase();
    if (!tag) continue;
    if (tag === "zh" || tag.startsWith("zh-")) return "zh";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return DEFAULT_LOCALE;
}

export type { Dict };
export { en, zh, both };
