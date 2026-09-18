"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import LanguageToggle from "@/components/LanguageToggle";
import { useT } from "@/lib/i18n/context";

/**
 * Confirming an address.
 *
 * Two things this page is careful about, for different reasons.
 *
 * **The link is not redeemed on load.** Mail filters and chat previews fetch
 * every URL in a message before a person ever sees it, and a page that verified
 * on arrival would be spent by a scanner — the recipient would then click a
 * link that reports itself as already used, with no way to tell that from an
 * attack. So arriving shows a button, and pressing it is the request.
 *
 * **The token never reaches the server as part of a URL.** It arrives in the
 * fragment, which browsers do not send, so the request that loads this page
 * carries no credential and no request log can retain one. It is read here,
 * wiped from the address bar with `replaceState` so it does not linger in
 * history, held in component state for as long as this page is open — never a
 * cookie, never localStorage, never sessionStorage, never an analytics call —
 * and sent once, in the body of the POST that redeems it.
 *
 * `queryToken` is the older `?token=` form. It is kept so that a link already
 * sitting in an inbox still works, and it is stripped from the address bar on
 * arrival just the same.
 *
 * Every sentence comes from the dictionary, so the language toggle in the
 * corner changes this page instantly. The server sends a status, not prose.
 */

type Status = "ok" | "already" | "invalid" | "expired" | "full";

/**
 * The token, read from the fragment as this module loads — once per page load,
 * before React renders anything and before any effect can clear it.
 *
 * It lives outside the component for a reason worth keeping. Reading the
 * fragment and then wiping it is an effect that destroys its own input, so
 * anything that runs it twice — React's development double-invoke, a remount,
 * a re-render after a language switch — would find an empty fragment the second
 * time and call a perfectly good link invalid. Read here, every later reader
 * gets the same answer as the first.
 *
 * Module memory, and nothing else: no cookie, no localStorage, no
 * sessionStorage, no analytics, no URL. It lives as long as the tab is on this
 * page.
 */
const HASH_TOKEN = typeof window === "undefined" ? "" : (() => {
  const found = /^#token=(.+)$/.exec(window.location.hash)?.[1];
  return found ? decodeURIComponent(found) : "";
})();

export default function VerifyContent({ queryToken }: { queryToken: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  /*
   * Empty on the first client render, exactly as on the server.
   *
   * The fragment is client-only knowledge, and rendering it during hydration is
   * a mismatch — which React does not repair for an attribute. It warns, keeps
   * the server's markup, and the button stays disabled in the DOM however
   * certain React's own state is that it should be live. So the first render
   * agrees with the server, and the effect below supplies the token, which is
   * an ordinary re-render and updates the DOM properly.
   */
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const found = HASH_TOKEN || queryToken;
    if (found) setToken(found);
    else setStatus("invalid");
    /* Out of the address bar and out of this history entry, so a glance at the
       screen, a shared tab or the back button reveals nothing. The page keeps
       working because the value was read as this module loaded. */
    if (window.location.hash || window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [queryToken]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => null);
      if (data?.status) setStatus(data.status as Status);
      else setError(data?.error ?? t.errors.saveFailed);
    } catch {
      setError(t.errors.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const done = status === "ok" || status === "already";
  const v = t.verify;

  return (
    <main className="mx-auto px-4 py-10" style={{ maxWidth: 460 }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow">{t.appName}</div>
          <h1 className="display mt-1" style={{ fontSize: 27, lineHeight: 1.15 }}>
            {done ? v.doneTitle : status ? v.problemTitle : v.title}
          </h1>
        </div>
        <LanguageToggle />
      </div>

      <section className="card p-5 mt-5">
        {status === null && (
          <>
            <p style={{ fontSize: 14.5, lineHeight: 1.65 }}>{v.intro}</p>
            {/* Nothing to press during the server render, where there is no
                fragment to have read. */}
            <button className="btn btn-primary mt-4" onClick={confirm} disabled={busy || !token}>
              {busy ? v.confirming : v.confirm}
            </button>
          </>
        )}

        {status === "ok" && (
          <>
            <p style={{ fontSize: 14.5, lineHeight: 1.65 }}>{v.ok}</p>
            <Link href="/login" className="btn btn-primary mt-4">{v.signIn}</Link>
          </>
        )}

        {status === "already" && (
          <>
            <p style={{ fontSize: 14.5, lineHeight: 1.65 }}>{v.already}</p>
            <Link href="/login" className="btn btn-primary mt-4">{v.signIn}</Link>
          </>
        )}

        {status === "expired" && (
          <>
            <p style={{ fontSize: 14.5, lineHeight: 1.65 }}>{v.expired}</p>
            <Link href="/login" className="btn mt-4">{v.backToSignIn}</Link>
          </>
        )}

        {status === "invalid" && (
          <>
            <p style={{ fontSize: 14.5, lineHeight: 1.65 }}>{v.invalid}</p>
            <Link href="/login" className="btn mt-4">{v.backToSignIn}</Link>
          </>
        )}

        {/*
          * The one outcome that is nobody's mistake: the link is real, and the
          * last place went to somebody else while it sat in the inbox. Said
          * plainly, and the link is deliberately still valid — pressing confirm
          * again works the moment a place frees up.
          */}
        {status === "full" && (
          <>
            <p style={{ fontSize: 14.5, lineHeight: 1.65 }}>{t.earlyAccess.fullBody}</p>
            <p className="muted mt-3" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
              {v.fullStillValid}
            </p>
            <button className="btn mt-4" onClick={confirm} disabled={busy}>
              {busy ? v.confirming : v.tryAgain}
            </button>
          </>
        )}

        {error && (
          <p className="mt-3" role="alert" style={{ fontSize: 13.5, color: "var(--warn)" }}>
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
