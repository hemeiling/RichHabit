"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { HabitsProvider, useHabits } from "@/components/store";
import LanguageToggle from "@/components/LanguageToggle";
import Sidebar, { SidebarToggle, type NavItem } from "@/components/Sidebar";
import { useSignOut } from "@/components/useSignOut";
import FeedbackSheet from "@/components/FeedbackSheet";
import { LocaleProvider, useAdoptLocale, useLocale, useT } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n";

/**
 * The app's navigation. It used to be a bar fixed to the bottom of the screen;
 * it is a sidebar now, persistent from 900px and a drawer below that, sharing
 * one component with admin.
 */
const TABS = [
  { href: "/today", key: "today", path: "M4 5h16v15H4z M4 10h16 M8 3v4 M16 3v4" },
  { href: "/habits", key: "habits", path: "M5 7h14 M5 12h14 M5 17h9" },
  { href: "/week", key: "week", path: "M4 6h16v13H4z M4 11h16 M9 6v13 M14 6v13" },
  { href: "/insights", key: "insights", path: "M5 19V10 M10 19V5 M15 19v-6 M20 19v-9" },
  /*
   * Two figures, the nearer one whole and the further one partial. Drawn in the
   * same open-stroke language as its neighbours rather than a filled glyph, and
   * placed after the four personal views because it is the only outward-looking
   * screen — the order reads from "my day" to "everyone".
   *
   * It is `/community`, not `/more/community`: the sidebar marks an item active
   * when the path starts with its href, so living under /more would light up
   * More at the same time and the highlight would lie about where you are.
   */
  { href: "/community", key: "community",
    path: "M9 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4 M3 20v-1.2A4.8 4.8 0 0 1 7.8 14h2.4a4.8 4.8 0 0 1 4.8 4.8V20 M16.2 5.1a3.2 3.2 0 0 1 0 5.8 M17.6 14.3A4.8 4.8 0 0 1 21 18.8V20" },
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

/**
 * The account block at the foot of the sidebar: who you are, a way into the
 * account screen, and sign out — anchored to the bottom by `.sidebar-foot`.
 */
function SidebarAccount({ email, onNavigate }: { email: string; onNavigate: () => void }) {
  const t = useT();
  const { signOut, busy, failed } = useSignOut();
  const [feedback, setFeedback] = useState(false);

  return (
    <div style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 8 }}>
      <div className="px-5 pt-2 pb-1 faint"
        style={{ fontSize: 12, overflowWrap: "anywhere", lineHeight: 1.35 }}>
        {email}
      </div>
      <Link href="/more" className="navlink" onClick={onNavigate}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{ flex: "none" }}>
          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
        </svg>
        {t.nav.account}
      </Link>
      {/* Feedback about the app, not about the user's habits — which is why it
          sits with the account rather than anywhere in the tracking screens. */}
      <button className="navlink" onClick={() => { setFeedback(true); onNavigate(); }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{ flex: "none" }}>
          <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
        </svg>
        {t.feedback.open}
      </button>
      {feedback && <FeedbackSheet onClose={() => setFeedback(false)} />}
      <button className="navlink" onClick={signOut} disabled={busy}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{ flex: "none" }}>
          <path d="M15 17l5-5-5-5 M20 12H9 M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6" />
        </svg>
        {busy ? t.more.signingOut : t.more.signOut}
      </button>
      {failed && (
        <p className="px-5 pt-1" role="alert" style={{ fontSize: 12, color: "var(--warn)" }}>
          {t.more.signOutFailed}
        </p>
      )}
    </div>
  );
}

function Chrome({ email, children }: { email: string; children: React.ReactNode }) {
  const { state, actions, loading, saving, error, dismissError } = useHabits();
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const isSubPage = pathname.split("/").length > 2;
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const items: NavItem[] = TABS.map((tab) => ({
    href: tab.href, label: t.nav[tab.key], icon: tab.path,
  }));

  return (
    <div data-theme={state.prefs.theme} style={{ minHeight: "100vh" }}>
      <LocaleSync />

      <Sidebar
        brand={<span className="display" style={{ fontSize: 19 }}>{t.appName}</span>}
        items={items}
        footer={<SidebarAccount email={email} onNavigate={closeMenu} />}
        open={menuOpen} onClose={closeMenu}
        closeLabel={t.common.close} navLabel={t.nav.mainNavigation}
      />

      {/* Everything that is not the sidebar sits in this column, inset from the
          left at the width where the sidebar is always on screen. */}
      <div className="with-sidebar">
      <header style={{
        position: "sticky", top: 0, zIndex: 20, background: "var(--bg)",
        borderBottom: "1px solid var(--line)",
      }}>
        <div className="mx-auto px-4 sm:px-6 flex items-center justify-between"
          style={{ maxWidth: 780, height: 56 }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <SidebarToggle onClick={() => setMenuOpen(true)} label={t.nav.openMenu} />
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
        style={{ maxWidth: 780, paddingBottom: 40 }} key={pathname}>
        {loading ? <div className="eyebrow py-10 text-center">{t.common.loading}</div> : children}
      </main>
      </div>
    </div>
  );
}

export default function AppShell({
  userId, email, locale, children,
}: { userId: string; email: string; locale: Locale; children: React.ReactNode }) {
  return (
    <LocaleProvider initial={locale}>
      <HabitsProvider userId={userId}>
        <Chrome email={email}>{children}</Chrome>
      </HabitsProvider>
    </LocaleProvider>
  );
}
