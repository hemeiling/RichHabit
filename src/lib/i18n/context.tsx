"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { LOCALE_COOKIE, dict, isLocale, type Dict, type Locale } from "./index";

/**
 * Locale as client state, seeded from the server.
 *
 * The server resolves the locale from the cookie so the first paint is already
 * right — no flash of the wrong language. After that it lives in React state,
 * so switching swaps the dictionary in place: instant, no reload, and nothing
 * in the page loses its position or its in-flight input.
 */
interface Ctx {
  locale: Locale;
  t: Dict;
  setLocale: (l: Locale) => void;
}

const LocaleContext = createContext<Ctx | null>(null);

const YEAR = 60 * 60 * 24 * 365;

function writeCookie(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${YEAR}; samesite=lax`;
}

export function LocaleProvider({
  initial, children,
}: { initial: Locale; children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initial);

  // `lang` matters for screen readers and for CJK font selection, and the root
  // element is rendered on the server, so it is updated here rather than there.
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-Hans" : "en";
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    setLocaleState(next);
    writeCookie(next);
  }, []);

  /**
   * Adopts a locale chosen on another device. The cookie is the fast path the
   * server can read before any query; the account preference is the durable
   * one, and it wins once state has loaded.
   */
  const adopt = useCallback((stored: Locale | null | undefined) => {
    if (isLocale(stored) && stored !== locale) {
      setLocaleState(stored);
      writeCookie(stored);
    }
  }, [locale]);

  const value = useMemo(
    () => ({ locale, t: dict(locale), setLocale, adopt }),
    [locale, setLocale, adopt],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

function useLocaleContext() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useT must be used inside <LocaleProvider>");
  return ctx as Ctx & { adopt: (l: Locale | null | undefined) => void };
}

/** The dictionary for the current locale. */
export const useT = () => useLocaleContext().t;
export const useLocale = () => useLocaleContext().locale;
export const useSetLocale = () => useLocaleContext().setLocale;
/** Internal: lets the store hand over the locale stored on the account. */
export const useAdoptLocale = () => useLocaleContext().adopt;
