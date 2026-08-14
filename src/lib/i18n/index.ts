import { en, type Dict } from "./en";
import { zh } from "./zh";

/**
 * Locale resolution, shared by server and client. Deliberately free of React
 * and of `next/headers` so route handlers, server components and the browser
 * can all use it.
 */

export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "rh_locale";

export const dictionaries: Record<Locale, Dict> = { en, zh };

export const isLocale = (v: unknown): v is Locale =>
  typeof v === "string" && (LOCALES as readonly string[]).includes(v);

export const dict = (locale: Locale): Dict => dictionaries[locale] ?? en;

/** BCP-47 tags for Intl, which needs a region to format dates sensibly. */
const INTL_TAG: Record<Locale, string> = { en: "en-US", zh: "zh-CN" };
export const intlTag = (locale: Locale) => INTL_TAG[locale] ?? "en-US";

/**
 * The locale for a request: an explicit cookie wins, otherwise the browser's
 * Accept-Language. A Chinese-speaking relative opening the link for the first
 * time should land in Chinese without being told to change a setting.
 */
export function resolveLocale(cookieValue?: string | null, acceptLanguage?: string | null): Locale {
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
export { en, zh };
