import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, dict, resolveLocale, type Locale } from "./index";

/**
 * The request's locale, for server components and route handlers. Reads the
 * cookie first and falls back to Accept-Language, so a first-time visitor from
 * a Chinese browser lands in Chinese.
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
