"use client";
import { useState } from "react";
import Link from "next/link";
import PasswordField from "@/components/PasswordField";
import { useT } from "@/lib/i18n/context";

export default function ChangePasswordForm(
  { email, forced }: { email: string; forced: boolean },
) {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Only once the field has been typed in: telling someone the passwords do
     not match while they are still on the first character of the second one
     is noise, not help. */
  const mismatch = confirm.length > 0 && confirm !== next;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) { setError(t.setup.mismatch); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        // The confirmation stays in the browser; the server's contract is
        // unchanged, so the forced-change flow keeps working exactly as before.
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not change the password");
      /* Forced changes land on Today, as they always have — that redirect is
         what releases someone from the forced-change gate. A user who came
         here from Settings goes back to Settings, where they were. */
      window.location.replace(forced ? "/today" : "/more?changed=1");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto px-4 py-10" style={{ maxWidth: 420 }}>
      <h1 className="display" style={{ fontSize: 26 }}>{t.setup.changeTitle}</h1>
      <p className="muted mt-2" style={{ fontSize: 14, lineHeight: 1.5 }}>
        {forced ? t.setup.changeForced : t.setup.changeBody} {email}
      </p>
      <form onSubmit={submit} className="card p-5 mt-4">
        <PasswordField label={t.setup.currentPassword} value={current}
          onChange={setCurrent} autoFocus autoComplete="current-password"
          showLabel={t.login.showPassword} hideLabel={t.login.hidePassword} />
        <div className="mt-3">
          <PasswordField label={t.setup.newPassword} value={next}
            onChange={setNext} autoComplete="new-password"
            showLabel={t.login.showPassword} hideLabel={t.login.hidePassword} />
        </div>
        <div className="mt-3">
          <PasswordField label={t.setup.confirmPassword} value={confirm}
            onChange={setConfirm} autoComplete="new-password"
            showLabel={t.login.showPassword} hideLabel={t.login.hidePassword} />
        </div>
        {mismatch && !error && (
          <p className="mt-3" role="alert" style={{ fontSize: 13.5, color: "var(--warn)" }}>
            {t.setup.mismatch}
          </p>
        )}
        {error && (
          <p className="mt-3" role="alert" style={{ fontSize: 13.5, color: "var(--warn)" }}>{error}</p>
        )}
        <button className="btn btn-primary mt-4 w-full"
          disabled={busy || next.length < 8 || next !== confirm}>
          {busy ? t.common.savingEllipsis : t.setup.finish}
        </button>
      </form>
      {/* No way out of a forced change except completing it — that gate is the
          point. Someone who chose to come here keeps a way back. */}
      {!forced && (
        <p className="mt-4 text-center">
          <Link href="/more" className="faint" style={{ fontSize: 13.5 }}>
            ‹ {t.setup.backToSettings}
          </Link>
        </p>
      )}
    </main>
  );
}
