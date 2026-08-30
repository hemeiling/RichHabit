"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useHabits } from "@/components/store";
import LanguageToggle from "@/components/LanguageToggle";
import { Segmented, Sheet } from "@/components/ui";
import { useSignOut } from "@/components/useSignOut";
import { useLocale, useT } from "@/lib/i18n/context";
import { instantDateFor } from "@/lib/i18n";
import { todayISO } from "@/lib/dates";
import type { AccountSummary } from "@/lib/db/queries";

const LINKS = [
  { href: "/more/refine", key: "refine" },
  { href: "/more/awareness", key: "awareness" },
  { href: "/more/goals", key: "goals" },
  { href: "/more/metrics", key: "metrics" },
  { href: "/more/spending", key: "spending" },
  { href: "/more/stacks", key: "stacks" },
  { href: "/more/review", key: "review" },
] as const;

export default function More({ account }: { account: AccountSummary }) {
  const { state, actions, saving } = useHabits();
  const t = useT();
  const locale = useLocale();
  const { signOut, busy, failed } = useSignOut();
  const [confirming, setConfirming] = useState(false);

  /* The username field is seeded from the server and edited locally. Only the
     one column is written; the account id everything else hangs off is never
     touched, so a rename cannot cost anyone their history or their place. */
  const [username, setUsername] = useState(account.username ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const saveUsername = async () => {
    setSavingName(true);
    setNameMsg(null);
    try {
      const res = await fetch("/api/account/username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || t.errors.saveFailed);
      // Echo what the server stored: it normalises, so what was typed and
      // what is now the name are not always the same string.
      setUsername(data.username);
      setNameMsg({ ok: true, text: t.more.usernameSaved });
    } catch (e) {
      setNameMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSavingName(false);
    }
  };

  /* Confirmation of a password change, which happens on another page. The
     marker is stripped from the URL once read, so a refresh or a shared link
     does not keep announcing something that already happened. */
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("changed")) return;
    setChanged(true);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rich-habits-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      {changed && (
        <p className="card p-3.5" role="status"
          style={{ fontSize: 14, color: "var(--ok, var(--fg))" }}>
          {t.setup.changed}
        </p>
      )}
      {/* Account, at the top: who you are signed in as should not need scrolling for. */}
      <section className="card p-5">
        <div className="eyebrow mb-3">{t.more.account}</div>
        <div className="flex items-center gap-3">
          <div aria-hidden="true" className="flex items-center justify-center" style={{
            width: 44, height: 44, flex: "none", borderRadius: "50%",
            background: "var(--accent-soft)", color: "var(--accent)",
            fontSize: 18, fontWeight: 600, textTransform: "uppercase",
          }}>{account.email.slice(0, 1)}</div>
          <div style={{ minWidth: 0 }}>
            {/* Long addresses wrap rather than widening the card off-screen. */}
            <div style={{ fontSize: 15, overflowWrap: "anywhere" }}>{account.email}</div>
            {/* Rendered in the reader's timezone, which the server cannot know —
                so the first paint may name a different day than the browser does. */}
            <div className="faint mt-0.5" style={{ fontSize: 12.5 }} suppressHydrationWarning>
              {t.more.memberSince} {instantDateFor(account.createdAt, locale)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="flat p-3.5">
            <div className="eyebrow" style={{ fontSize: 10, letterSpacing: "0.06em" }}>
              {t.more.activeHabits}
            </div>
            <div className="display num mt-1" style={{ fontSize: 22 }}>{account.activeHabits}</div>
          </div>
          <div className="flat p-3.5">
            <div className="eyebrow" style={{ fontSize: 10, letterSpacing: "0.06em" }}>
              {t.more.daysRecorded}
            </div>
            <div className="display num mt-1" style={{ fontSize: 22 }}>{account.daysRecorded}</div>
          </div>
        </div>

        <div className="mt-4">
          <label className="faint block" style={{ fontSize: 12.5 }} htmlFor="username">
            {t.more.username}
          </label>
          <div className="flex gap-2 mt-1">
            <input id="username" className="input flex-1" value={username}
              onChange={(e) => { setUsername(e.target.value); setNameMsg(null); }}
              autoComplete="username" spellCheck={false} />
            <button className="btn" type="button"
              disabled={savingName || !username.trim() || username.trim() === (account.username ?? "")}
              onClick={saveUsername}>
              {savingName ? t.common.savingEllipsis : t.more.usernameSave}
            </button>
          </div>
          <p className="faint mt-1.5" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
            {t.more.usernameHint}
          </p>
          {nameMsg && (
            <p className="mt-1.5" role="status"
              style={{ fontSize: 12.5, color: nameMsg.ok ? "var(--ok, var(--fg))" : "var(--warn)" }}>
              {nameMsg.text}
            </p>
          )}
        </div>

        {/* The same page the forced-change flow uses, reached deliberately
            rather than by redirect. One password form, one API route. */}
        <Link href="/change-password" className="flat p-3.5 flex items-center justify-between gap-3 mt-3">
          <span>
            <span className="block" style={{ fontSize: 14.5 }}>{t.more.changePassword}</span>
            <span className="faint block mt-0.5" style={{ fontSize: 12.5 }}>{t.more.changePasswordNote}</span>
          </span>
          <span className="faint" style={{ fontSize: 18 }}>›</span>
        </Link>

        {/* Rendered from the role in the database, never from anything the
            client claims — and /admin re-checks it and 404s regardless. */}
        {account.isAdmin && (
          <Link href="/admin" className="flat p-3.5 flex items-center justify-between gap-3 mt-3">
            <span>
              <span className="block" style={{ fontSize: 14.5 }}>{t.more.adminLink}</span>
              <span className="faint block mt-0.5" style={{ fontSize: 12.5 }}>{t.more.adminNote}</span>
            </span>
            <span className="faint" style={{ fontSize: 18 }}>›</span>
          </Link>
        )}
      </section>

      {/* Community Progress used to be listed here. It is a top-level item in
          the sidebar now, and a second route to the same screen would only
          make the navigation harder to hold in your head. */}
      <section className="card px-5 py-2">
        <div className="divide">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}
              className="w-full text-left py-4 flex items-center justify-between gap-3">
              <span>
                <span className="block" style={{ fontSize: 15.5, fontWeight: 500 }}>{t.more.links[l.key].label}</span>
                <span className="faint block mt-0.5" style={{ fontSize: 13 }}>{t.more.links[l.key].note}</span>
              </span>
              <span className="faint" style={{ fontSize: 18 }}>›</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-3">{t.more.preferences}</div>
        {/* The same control as the header toggle, sharing one piece of state —
            a second place to find it, not a second setting. */}
        <div className="flex items-center justify-between py-2 gap-3">
          <div>
            <div style={{ fontSize: 15 }}>{t.more.language}</div>
            <div className="faint" style={{ fontSize: 12.5 }}>{t.more.languageHint}</div>
          </div>
          <LanguageToggle />
        </div>
        <div className="flex items-center justify-between py-2 gap-3">
          <div>
            <div style={{ fontSize: 15 }}>{t.more.appearance}</div>
            <div className="faint" style={{ fontSize: 12.5 }}>{t.more.appearanceHint}</div>
          </div>
          <Segmented value={state.prefs.theme} onChange={(v) => actions.setPrefs({ theme: v })} small
            options={[{ value: "light" as const, label: t.more.light }, { value: "dark" as const, label: t.more.dark }]} />
        </div>
        <div className="flex items-center justify-between py-2 gap-3">
          <div>
            <div style={{ fontSize: 15 }}>{t.more.weightedScore}</div>
            <div className="faint" style={{ fontSize: 12.5 }}>{t.more.weightedHint}</div>
          </div>
          <Segmented<boolean> value={state.prefs.weighted} onChange={(v) => actions.setPrefs({ weighted: v })} small
            options={[{ value: true, label: t.more.on }, { value: false, label: t.more.off }]} />
        </div>
        {/* The same setting as the one on Today's Progress card — one
            preference, reachable both where its effect is visible and where
            people look for privacy controls. */}
        <div className="flex items-center justify-between py-2 gap-3">
          <div>
            <div style={{ fontSize: 15 }}>{t.progress.showMe}</div>
            <div className="faint" style={{ fontSize: 12.5 }}>{t.progress.showMeHint}</div>
          </div>
          <Segmented<boolean> value={state.prefs.communityVisible}
            onChange={(v) => actions.setPrefs({ communityVisible: v })} small
            options={[{ value: true, label: t.more.on }, { value: false, label: t.more.off }]} />
        </div>
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-2">{t.more.yourData}</div>
        <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
          {t.more.yourDataHint} {saving ? t.common.savingEllipsis : t.common.allSaved}
        </p>
        <div className="mt-3">
          <button className="btn" onClick={exportData}>{t.more.exportJson}</button>
        </div>
      </section>

      {/**
        * Sign out sits on its own, after everything else, in a card of its own
        * so it is never mistaken for one more setting. It is a full-width row
        * rather than a small button — easy to hit on a phone — but it keeps the
        * quiet border and body weight of the rest of the app. Nothing here is
        * destructive, so nothing here is red.
        */}
      <section className="card px-5 py-1">
        <button
          className="w-full text-left py-4 flex items-center justify-between gap-3"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          <span>
            <span className="block" style={{ fontSize: 15.5, fontWeight: 500, color: "var(--ink)" }}>
              {busy ? t.more.signingOut : t.more.signOut}
            </span>
            <span className="faint block mt-0.5" style={{ fontSize: 13 }}>{t.more.signOutHint}</span>
          </span>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--faint)"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            style={{ flex: "none" }}>
            <path d="M15 17l5-5-5-5 M20 12H9 M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6" />
          </svg>
        </button>
      </section>

      {failed && (
        <p className="text-center" style={{ fontSize: 13, color: "var(--warn)" }} role="alert">
          {t.more.signOutFailed}
        </p>
      )}

      {confirming && (
        <Sheet
          open onClose={() => !busy && setConfirming(false)} title={t.more.signOutTitle}
          footer={
            <>
              <button className="btn" disabled={busy} onClick={() => setConfirming(false)}>
                {t.common.cancel}
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={signOut}>
                {busy ? t.more.signingOut : t.more.signOutConfirm}
              </button>
            </>
          }
        >
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.55 }}>{t.more.signOutBody}</p>
          <p className="faint mt-2" style={{ fontSize: 13 }}>{account.email}</p>
        </Sheet>
      )}

      <p className="faint text-center" style={{ fontSize: 12, lineHeight: 1.5 }}>
        <span style={{ display: "block", marginBottom: 6 }}>
          {t.appName} — {t.tagline}
        </span>
        {t.more.footer}<br />{t.more.footerTwo}
      </p>
    </div>
  );
}
