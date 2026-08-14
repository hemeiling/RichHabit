/**
 * Cookie names, in one dependency-free place.
 *
 * `middleware.ts` runs on the edge runtime and cannot import anything that
 * reaches `pg`, so it used to carry its own copy of the session cookie name —
 * two literals that had to agree, with nothing to catch it if they drifted.
 * Neither name is configurable: changing one silently signs every user out, so
 * it is a constant rather than an environment variable.
 */
export const SESSION_COOKIE = "rh_session";
export const LOCALE_COOKIE = "rh_locale";
