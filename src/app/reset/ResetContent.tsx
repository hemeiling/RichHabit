"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import LanguageToggle from "@/components/LanguageToggle";
import PasswordField from "@/components/PasswordField";
import { useT } from "@/lib/i18n/context";

/**
 * Choosing the new password.
 *
 * The token arrives in the fragment, which is never sent to a server, so the
 * request that loads this page carries no credential and no request log can
 * retain one. It is read as this module loads — once per page load, before
 * React renders and before any effect can clear it — wiped from the address bar
 * so it does not linger in history, held in memory for as long as this page is
 * open (never a cookie, never localStorage, never sessionStorage, never an
 * analytics call), and sent once in the body of the POST that spends it.
 *
 * Reading it at module scope rather than inside the effect is deliberate:
 * reading the fragment and then clearing it is an effect that destroys its own
 * input, and anything that runs it twice — React's development double-invoke, a
 * remount, a re-render after a language switch — would find nothing the second
 * time and call a good link invalid.
 *
 * The token is applied by the effect rather than during the first render,
 * because rendering client-only knowledge while hydrating is a mismatch, and
 * React does not repair a mismatched attribute: the button would stay disabled
 * in the DOM however certain React's own state was that it should be live.
 */

const HASH_TOKEN = typeof window === "undefined" ? "" : (() => {
  const found = /^#token=(.+)$/.exec(window.location.hash)?.[1];
  return found ? decodeURIComponent(found) : "";
})();

type Status = "form" | "done" | "invalid" | "expired";

export default function ResetContent({ queryToken }: { queryToken: string }) {
  const t = useT();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>("form");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const found = HASH_TOKEN || queryToken;
    if (found) setToken(found);
    else setStatus("invalid");
    if (window.location.hash || window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [queryToken]);

  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = Boolean(token) && password.length > 0 && !mismatch && confirm.length > 0;

  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => null);
      if (data?.status === "ok") { setStatus("done"); return; }
      if (data?.status === "expired") { setStatus("expired"); return; }
      if (data?.status === "invalid") { setStatus("invalid"); return; }
      setError(data?.error ?? t.errors.saveFailed);
    } catch {
      setError(t.errors.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const heading = status === "done" ? t.forgot.doneTitle : t.forgot.chooseTitle;

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-7 w-full" style={{ maxWidth: 400 }}>
        <div className="flex items-start justify-between gap-3">
          <div className="eyebrow">{t.appName}</div>
          <LanguageToggle />
        </div>
        <h1 className="display mt-1" style={{ fontSize: 24, lineHeight: 1.25 }}>{heading}</h1>

        {status === "form" && (
          <>
            <div className="mt-5 flex flex-col gap-3">
              <PasswordField
                label={t.forgot.newPassword}
                value={password}
                onChange={setPassword}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                autoComplete="new-password"
                placeholder={t.login.passwordPlaceholder}
                showLabel={t.login.showPassword} hideLabel={t.login.hidePassword}
              />
              <PasswordField
                label={t.forgot.confirmPassword}
                value={confirm}
                onChange={setConfirm}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                autoComplete="new-password"
                invalid={mismatch}
                showLabel={t.login.showPassword} hideLabel={t.login.hidePassword}
                hint={mismatch
                  ? <span style={{ color: "var(--warn)" }}>{t.login.passwordMismatch}</span>
                  : undefined}
              />
            </div>

            {error && (
              <p className="mt-3" role="alert" style={{ fontSize: 13.5, color: "var(--warn)" }}>
                {error}
              </p>
            )}

            <button className="btn btn-primary w-full mt-4" disabled={busy || !ready} onClick={submit}>
              {busy ? t.forgot.saving : t.forgot.save}
            </button>
          </>
        )}

        {status === "done" && (
          <>
            <p className="mt-3" style={{ fontSize: 14.5, lineHeight: 1.65 }}>{t.forgot.doneBody}</p>
            <Link href="/login" className="btn btn-primary mt-5">{t.forgot.signIn}</Link>
          </>
        )}

        {(status === "invalid" || status === "expired") && (
          <>
            <p className="mt-3" style={{ fontSize: 14.5, lineHeight: 1.65 }}>
              {status === "expired" ? t.forgot.linkExpired : t.forgot.linkInvalid}
            </p>
            <div className="flex flex-wrap gap-2 mt-5">
              <Link href="/forgot" className="btn btn-primary">{t.forgot.requestAnother}</Link>
              <Link href="/login" className="btn btn-quiet">{t.forgot.backToSignIn}</Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
