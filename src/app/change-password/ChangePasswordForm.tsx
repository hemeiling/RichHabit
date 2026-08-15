"use client";
import { useState } from "react";
import PasswordField from "@/components/PasswordField";
import { useT } from "@/lib/i18n/context";

export default function ChangePasswordForm(
  { email, forced }: { email: string; forced: boolean },
) {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not change the password");
      window.location.replace("/today");
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
        {error && (
          <p className="mt-3" role="alert" style={{ fontSize: 13.5, color: "var(--warn)" }}>{error}</p>
        )}
        <button className="btn btn-primary mt-4 w-full" disabled={busy || next.length < 8}>
          {busy ? t.common.savingEllipsis : t.setup.finish}
        </button>
      </form>
    </main>
  );
}
