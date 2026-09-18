"use client";
import { useState } from "react";
import Link from "next/link";
import LanguageToggle from "@/components/LanguageToggle";
import { useT } from "@/lib/i18n/context";
import { RESET_TTL_MINUTES } from "@/lib/auth/resetTtl";

/**
 * One field, one button, and the same answer every time.
 *
 * The screen never reports whether an account was found, because the server
 * never tells it: the reply is `{ ok: true }` for an unknown identifier, an
 * account with no address, an unverified address, a disabled account and a live
 * one alike. So there is no error state here beyond "the request itself
 * failed" — anything else would leak the very thing the route is careful about.
 */
export default function ForgotForm() {
  const t = useT();
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !identifier.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || t.errors.saveFailed);
      }
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-7 w-full" style={{ maxWidth: 400 }}>
        <div className="flex items-start justify-between gap-3">
          <div className="eyebrow">{t.appName}</div>
          <LanguageToggle />
        </div>

        {sent ? (
          <>
            <h1 className="display mt-1" style={{ fontSize: 24, lineHeight: 1.2 }}>
              {t.forgot.sentTitle}
            </h1>
            <p className="mt-3" style={{ fontSize: 14, lineHeight: 1.6 }}>{t.forgot.sentBody}</p>
            <p className="muted mt-2" style={{ fontSize: 13, lineHeight: 1.55 }}>
              {t.forgot.sentHint(RESET_TTL_MINUTES)}
            </p>
            <Link href="/login" className="btn mt-5">{t.forgot.backToSignIn}</Link>
          </>
        ) : (
          <>
            <h1 className="display mt-1" style={{ fontSize: 27, lineHeight: 1.15 }}>
              {t.forgot.title}
            </h1>
            <p className="muted mt-2" style={{ fontSize: 14, lineHeight: 1.55 }}>{t.forgot.intro}</p>

            <label className="block mt-5">
              <div className="eyebrow mb-1.5">{t.forgot.identifier}</div>
              <input className="input" name="identifier" type="text"
                autoComplete="username" autoCapitalize="none" spellCheck={false}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder={t.login.identifierPlaceholder} />
            </label>

            {error && (
              <p className="mt-3" role="alert" style={{ fontSize: 13.5, color: "var(--warn)" }}>
                {error}
              </p>
            )}

            <button className="btn btn-primary w-full mt-4" disabled={busy || !identifier.trim()}
              onClick={submit}>
              {busy ? t.forgot.sending : t.forgot.send}
            </button>
            <Link href="/login" className="btn btn-quiet mt-3">{t.forgot.backToSignIn}</Link>
          </>
        )}
      </div>
    </main>
  );
}
