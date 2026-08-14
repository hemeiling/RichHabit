"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import LanguageToggle from "@/components/LanguageToggle";
import { useT } from "@/lib/i18n/context";

type Mode = "signin" | "signup";

/**
 * Email and password against /api/auth/*. The magic-link option went with
 * Supabase Auth — sending a link needs an email provider, and this app has none
 * configured. Both routes set the session cookie and land on /today.
 *
 * The language switcher is here as well as in More: a relative opening this for
 * the first time has to be able to change it before they have an account.
 */
export default function LoginForm() {
  const t = useT();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !email || !password) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/auth/${mode === "signup" ? "signup" : "signin"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || t.login.genericError);
      router.push("/today");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.login.genericError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-7 w-full" style={{ maxWidth: 400 }}>
        <div className="flex items-start justify-between gap-3">
          <div className="eyebrow">{t.appName}</div>
          <LanguageToggle small />
        </div>
        <h1 className="display mt-1" style={{ fontSize: 30, lineHeight: 1.1 }}>
          {mode === "signup" ? t.login.createAccount : t.login.welcomeBack}
        </h1>
        <p className="muted mt-2" style={{ fontSize: 14, lineHeight: 1.5 }}>{t.login.tagline}</p>

        <div className="mt-5 flex flex-col gap-3">
          <label className="block">
            <div className="eyebrow mb-1.5">{t.login.email}</div>
            <input
              className="input" type="email" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder={t.login.emailPlaceholder}
            />
          </label>
          <label className="block">
            <div className="eyebrow mb-1.5">{t.login.password}</div>
            <input
              className="input" type="password" value={password}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder={t.login.passwordPlaceholder}
            />
          </label>
        </div>

        {error && (
          <div className="flat p-3 mt-3" style={{ fontSize: 13.5, borderColor: "var(--warn)", background: "var(--warn-soft)" }}>
            {error}
          </div>
        )}

        <button className="btn btn-primary w-full mt-4" disabled={busy || !email || !password} onClick={submit}>
          {busy ? t.login.working : mode === "signup" ? t.login.createButton : t.login.signIn}
        </button>

        <div className="flex flex-wrap gap-2 mt-4">
          {mode !== "signin" && (
            <button className="btn btn-quiet" onClick={() => { setMode("signin"); setError(null); }}>
              {t.login.signInInstead}
            </button>
          )}
          {mode !== "signup" && (
            <button className="btn btn-quiet" onClick={() => { setMode("signup"); setError(null); }}>
              {t.login.createInstead}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
