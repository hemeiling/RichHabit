import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, dict, resolveLocale, type Locale } from "./index";

/**
 * The request's locale, for server components and route handlers.
 *
 * Cookie first, then the browser's Accept-Language, so a visitor on a Chinese
 * device lands in Chinese before they have an account or a preference. Reads no
 * database, so it cannot slow down a render.
 */
export function getLocale(): Locale {
  return resolveLocale(
    cookies().get(LOCALE_COOKIE)?.value,
    headers().get("accept-language"),
  );
}

export function getDict() {
  return dict(getLocale());
}
