import { prettyDate, shortDate } from "@/lib/dates";
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
export const LOCALE_COOKIE = "rh_locale";

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
