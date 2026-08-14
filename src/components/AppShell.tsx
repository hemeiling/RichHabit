"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { HabitsProvider, useHabits } from "@/components/store";
import LanguageToggle from "@/components/LanguageToggle";
import { LocaleProvider, useAdoptLocale, useLocale, useT } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n";

const TABS = [
  { href: "/today", key: "today", path: "M4 5h16v15H4z M4 10h16 M8 3v4 M16 3v4" },
  { href: "/habits", key: "habits", path: "M5 7h14 M5 12h14 M5 17h9" },
  { href: "/week", key: "week", path: "M4 6h16v13H4z M4 11h16 M9 6v13 M14 6v13" },
  { href: "/insights", key: "insights", path: "M5 19V10 M10 19V5 M15 19v-6 M20 19v-9" },
  { href: "/more", key: "more", path: "M5 12h.01 M12 12h.01 M19 12h.01" },
] as const;

/**
 * Keeps the language in three places agreed: React state (what you see), the
 * cookie (what the server reads on the next request) and the account (what
 * follows you to another device).
 *
 * The cookie is the fast path — the server can read it before any query — so it
 * decides the first paint. The stored preference is the durable one and wins
 * once state has loaded. Renders nothing.
 */
function LocaleSync() {
  const { state, actions, loading } = useHabits();
  const locale = useLocale();
  const adopt = useAdoptLocale();
  const synced = useRef(false);

  useEffect(() => {
    if (loading || synced.current) return;
    synced.current = true;
    adopt(state.prefs.locale);
  }, [loading, state.prefs.locale, adopt]);

  useEffect(() => {
    if (!synced.current || loading) return;
    if (state.prefs.locale !== locale) actions.setPrefs({ locale });
    // `actions` is rebuilt every render; depending on it would write in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, state.prefs.locale, loading]);

  return null;
}

function Chrome({ children }: { children: React.ReactNode }) {
  const { state, actions, loading, saving, error, dismissError } = useHabits();
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const activeTab = TABS.find((x) => pathname === x.href || pathname.startsWith(`${x.href}/`))?.href;
  const isSubPage = pathname.split("/").length > 2;

  return (
    <div data-theme={state.prefs.theme} style={{ minHeight: "100vh" }}>
      <LocaleSync />
      <header style={{
        position: "sticky", top: 0, zIndex: 20, background: "var(--bg)",
        borderBottom: "1px solid var(--line)",
      }}>
        <div className="mx-auto px-4 sm:px-6 flex items-center justify-between"
          style={{ maxWidth: 780, height: 56 }}>
          <div className="flex items-center gap-2.5 min-w-0">
            {isSubPage && (
              <button className="btn btn-quiet" style={{ padding: "5px 10px" }}
                onClick={() => router.back()} aria-label={t.common.back}>‹</button>
            )}
            <span className="display" style={{
              fontSize: 21, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{t.titles[pathname] ?? t.appName}</span>
          </div>
          <div className="flex items-center gap-2" style={{ flex: "none" }}>
            <span className="eyebrow" style={{ opacity: saving ? 1 : 0, transition: "opacity .2s" }}>{t.common.saving}</span>
            <LanguageToggle />
            <button className="btn btn-quiet" style={{ padding: "6px 10px" }} aria-label={t.common.toggleDarkMode}
              onClick={() => actions.setPrefs({ theme: state.prefs.theme === "dark" ? "light" : "dark" })}>
              {state.prefs.theme === "dark" ? "☾" : "☀"}
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-auto px-4 sm:px-6 pt-3" style={{ maxWidth: 780 }}>
          <div className="card p-3 flex items-center justify-between gap-3"
            style={{ borderColor: "var(--warn)", background: "var(--warn-soft)", fontSize: 13.5 }}>
            <span>{error}</span>
            <button className="btn btn-quiet" style={{ padding: "2px 10px" }} onClick={dismissError}>{t.common.dismiss}</button>
          </div>
        </div>
      )}

      <main className="mx-auto px-4 sm:px-6 py-5 fade-in"
        style={{ maxWidth: 780, paddingBottom: 96 }} key={pathname}>
        {loading ? <div className="eyebrow py-10 text-center">{t.common.loading}</div> : children}
      </main>

      <nav style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 30,
        background: "color-mix(in srgb, var(--bg) 88%, transparent)", backdropFilter: "blur(12px)",
        borderTop: "1px solid var(--line)", paddingBottom: "env(safe-area-inset-bottom)",
      }}>
        <div className="mx-auto flex" style={{ maxWidth: 780 }}>
          {TABS.map((tab) => {
            const on = activeTab === tab.href;
            return (
              <button key={tab.href} className="navbtn" data-on={on} onClick={() => router.push(tab.href)}>
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none"
                  stroke={on ? "var(--ink)" : "var(--faint)"} strokeWidth="1.6"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={tab.path} />
                </svg>
                {t.nav[tab.key]}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export default function AppShell({
  userId, locale, children,
}: { userId: string; locale: Locale; children: React.ReactNode }) {
  return (
    <LocaleProvider initial={locale}>
      <HabitsProvider userId={userId}>
        <Chrome>{children}</Chrome>
      </HabitsProvider>
    </LocaleProvider>
  );
}
