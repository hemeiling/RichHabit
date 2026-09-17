import { cookies } from "next/headers";
import { LOCALE_COOKIE, dict, resolveLocale, type Locale } from "./index";

/**
 * The request's locale, for server components and route handlers.
 *
 * The reader's own choice, or English. Only the locale cookie is read — the
 * request's Accept-Language is deliberately not consulted, so a first-time
 * visitor gets the same page whatever their device is set to. Reads no
 * database, so it cannot slow down a render.
 */
export function getLocale(): Locale {
  return resolveLocale(cookies().get(LOCALE_COOKIE)?.value);
}

export function getDict() {
  return dict(getLocale());
}
