"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LanguageToggle from "@/components/LanguageToggle";
import PasswordField from "@/components/PasswordField";
import { useT } from "@/lib/i18n/context";

type Mode = "signin" | "signup";

/**
 * Signing in with an email *or* a username, and signing up with an email.
 *
 * One field either way. Which kind of account an identifier names is decided
 * server-side from the value, so nothing here has to guess and nothing the
 * browser sends chooses which column is searched. Signing up still asks for an
 * address, because an account created here with only a username would have no
 * way back in if the password were lost — usernames belong to accounts an admin
 * manages, and an admin can reset them.
 *
 * The magic-link option went with Supabase Auth — sending a link needs an email
 * provider, and this app has none configured. Both routes set the session
 * cookie and land on /today.
 *
 * The language switcher is here as well as in More: a relative opening this for
 * the first time has to be able to change it before they have an account.
 */
export default function LoginForm() {
  const t = useT();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !identifier.trim() || !password) return;
    // Creating an account requires accepting the terms. The server requires it
    // too; this only saves a round trip and says so in the reader's language.
    if (mode === "signup" && !accepted) { setError(t.earlyAccess.mustAgree); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/auth/${mode === "signup" ? "signup" : "signin"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Sign-up is an address; sign-in is either, and the server decides which.
        body: JSON.stringify(mode === "signup"
          ? { email: identifier, password, acceptedTerms: accepted }
          : { identifier, password }),
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
          <LanguageToggle />
        </div>
        <h1 className="display mt-1" style={{ fontSize: 30, lineHeight: 1.1 }}>
          {mode === "signup" ? t.login.createAccount : t.login.welcomeBack}
        </h1>
        <p className="muted mt-2" style={{ fontSize: 14, lineHeight: 1.5 }}>{t.tagline}</p>

        <div className="mt-5 flex flex-col gap-3">
          <label className="block">
            <div className="eyebrow mb-1.5">
              {mode === "signup" ? t.login.email : t.login.identifier}
            </div>
            {/*
              * `type="text"` on sign-in: `type="email"` makes the browser
              * refuse a username outright, which is exactly the validation this
              * field must not do. Sign-up still asks for an address, so it
              * keeps the email keyboard and the browser's own check.
              */}
            <input
              className="input"
              name="identifier"
              type={mode === "signup" ? "email" : "text"}
              autoComplete={mode === "signup" ? "email" : "username"}
              autoCapitalize="none" spellCheck={false}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder={mode === "signup"
                ? t.login.emailPlaceholder : t.login.identifierPlaceholder}
            />
          </label>
          <PasswordField
            label={t.login.password}
            value={password}
            onChange={setPassword}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            placeholder={t.login.passwordPlaceholder}
            showLabel={t.login.showPassword} hideLabel={t.login.hidePassword}
          />
        </div>

        {mode === "signup" && (
          <label className="flex items-start gap-2 mt-3" style={{ fontSize: 13, lineHeight: 1.45 }}>
            <input type="checkbox" checked={accepted} style={{ marginTop: 2, flex: "none" }}
              onChange={(e) => { setAccepted(e.target.checked); setError(null); }} />
            <span>{t.earlyAccess.agree}</span>
          </label>
        )}

        {error && (
          <div className="flat p-3 mt-3" style={{ fontSize: 13.5, borderColor: "var(--warn)", background: "var(--warn-soft)" }}>
            {error}
          </div>
        )}

        <button className="btn btn-primary w-full mt-4" disabled={busy || !identifier.trim() || !password || (mode === "signup" && !accepted)} onClick={submit}>
          {busy ? t.login.working : mode === "signup" ? t.login.createButton : t.login.signIn}
        </button>

        {/*
          * Read before anyone is inside, which is the point of putting it here
          * rather than behind a link. Quiet on purpose: it is a notice, not a
          * warning, and the card is still a sign-in form.
          */}
        <div className="flat p-3 mt-4">
          <div className="eyebrow" style={{ fontSize: 10 }}>{t.earlyAccess.title}</div>
          <p className="faint mt-1" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
            {t.earlyAccess.body}{" "}
            <Link href="/terms" style={{ textDecoration: "underline" }}>
              {t.earlyAccess.learnMore}
            </Link>
          </p>
        </div>

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
