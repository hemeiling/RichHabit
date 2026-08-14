"use client";
import { createContext, useContext } from "react";
import { LOCALE_COOKIE, dict, type Dict, type Locale } from "./index";

/**
 * The locale is decided on the server and passed down, so the first render
 * already has the right language — no flash of English before a client effect
 * corrects it.
 */
const LocaleContext = createContext<{ locale: Locale; t: Dict } | null>(null);

export function LocaleProvider({
  locale, children,
}: { locale: Locale; children: React.ReactNode }) {
  return (
    <LocaleContext.Provider value={{ locale, t: dict(locale) }}>
      {children}
    </LocaleContext.Provider>
  );
}

function useLocaleContext() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useT must be used inside <LocaleProvider>");
  return ctx;
}

/** The dictionary for the current locale. */
export const useT = () => useLocaleContext().t;
export const useLocale = () => useLocaleContext().locale;

/**
 * Switching language writes the cookie and reloads, rather than swapping the
 * dictionary in place: the server components (page titles, the login page) read
 * the cookie, so they need a round trip to catch up.
 */
export function setLocale(locale: Locale) {
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${oneYear}; samesite=lax`;
  window.location.reload();
}
