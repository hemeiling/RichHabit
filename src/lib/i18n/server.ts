import { cookies } from "next/headers";
import { LOCALE_COOKIE, dict, resolveLocale, type Locale } from "./index";

/**
 * The request's locale, for server components and route handlers. Absent a
 * cookie this is the bilingual dictionary — the default is both languages, not
 * a guess from Accept-Language.
 */
export function getLocale(): Locale {
  return resolveLocale(cookies().get(LOCALE_COOKIE)?.value);
}

export function getDict() {
  return dict(getLocale());
}
