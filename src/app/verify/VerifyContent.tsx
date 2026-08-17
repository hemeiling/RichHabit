"use client";
import { useState } from "react";
import Link from "next/link";
import LanguageToggle from "@/components/LanguageToggle";
import { useT } from "@/lib/i18n/context";

/**
 * Confirming an address.
 *
 * The link is not redeemed on load. Mail filters and chat previews fetch every
 * URL in a message before a person ever sees it, and a page that verified on
 * arrival would be spent by a scanner — the recipient would then click a link
 * that reports itself as already used, with no way to tell that from an attack.
 * So arriving shows a button, and pressing it is the request.
 *
 * Every sentence comes from the dictionary, so the language toggle in the
 * corner changes this page instantly. The server sends a status, not prose.
 */

type Status = "ok" | "already" | "invalid" | "expired" | "full";

export default function VerifyContent({ token }: { token: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(token ? null : "invalid");
  const [error, setError] = useState<string | null>(null);

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
            <button className="btn btn-primary mt-4" onClick={confirm} disabled={busy}>
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
