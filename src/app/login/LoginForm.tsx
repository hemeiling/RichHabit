"use client";
import { useEffect, useState } from "react";
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
 * cookie and land on /habits.
 *
 * The language switcher is here as well as in More: a relative opening this for
 * the first time has to be able to change it before they have an account.
 */
/** Google's "G", per its brand guidelines; decoration beside the words. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" style={{ flex: "none" }}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function LoginForm({ initialMode = "signin", returnTo, withGoogle = false,
  googleStep = null, googleError = null, thenKeyword }: {
  initialMode?: Mode;
  /** An internal path from the page's fixed allow-list; /habits otherwise. */
  returnTo?: string;
  /** Whether this deployment has Google sign-in configured at all. */
  withGoogle?: boolean;
  /** A pending Google handshake to finish: link to an existing account, or register. */
  googleStep?: "linkExisting" | "finish" | null;
  /** `?gerr=` — why the Google attempt came back, as a key, said in the reader's language. */
  googleError?: "cancelled" | "failed" | "disabled" | null;
  /** The allow-list keyword to carry through the Google flow. */
  thenKeyword?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [identifier, setIdentifier] = useState("");
  // Sign-up only. Kept apart from `identifier`, which is the one field a
  // returning user fills in.
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Set when the programme is full: a notice, not a validation failure.
   *
   * A flag rather than the server's sentence. Holding the response text meant
   * the title followed the language toggle and the body did not, because the
   * body had been rendered in whatever language the request was made in.
   */
  const [full, setFull] = useState(false);
  /**
   * An account that exists but has not proved its address yet. Same reasoning
   * as `full`: flags and values, never the server's prose, so every word on
   * screen follows the language toggle.
   *
   * `pending.sent` false means the account was created but the message did not
   * go out — a provider hiccup, not the user's problem, and the screen leads
   * with the resend button instead of "check your inbox".
   */
  const [pending, setPending] = useState<null | { email: string; sent: boolean }>(null);
  /** Offered after a sign-in refused for want of verification. */
  const [needsVerify, setNeedsVerify] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);
  /** The pending Google handshake, read (never spent) from the server. */
  const [gPending, setGPending] = useState<null | { step: "link" | "signup"; email: string }>(null);
  const [gUsername, setGUsername] = useState("");
  const [gAccepted, setGAccepted] = useState(false);
  const [gLinked, setGLinked] = useState(false);
  /** Signed in, but the Google link itself was refused: continue is still right there. */
  const [signedInAnyway, setSignedInAnyway] = useState(false);
  const [gBusy, setGBusy] = useState(false);

  useEffect(() => {
    if (!googleStep) return;
    (async () => {
      try {
        const r = await fetch("/api/auth/google/finish");
        const data = await r.json().catch(() => null);
        if (data?.step) setGPending({ step: data.step, email: String(data.email ?? "") });
        else setError(t.errors.googleExpired);
      } catch { setError(t.errors.googleExpired); }
    })();
    // The handshake is read once, for the screen it arrived on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleStep]);

  const resend = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/verify/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: pending?.email ?? identifier }),
      });
      const data = await res.json().catch(() => null);
      // Deliberately the same note whatever happened — see the route: it does
      // not reveal whether an account exists.
      setResendNote(data?.sent ?? t.verify.resendSent);
      if (pending) setPending({ ...pending, sent: true });
    } catch {
      setResendNote(t.verify.sendFailed);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (busy || !identifier.trim() || !password) return;
    // Creating an account requires accepting the terms. The server requires it
    // too; this only saves a round trip and says so in the reader's language.
    if (mode === "signup" && !accepted) { setError(t.earlyAccess.mustAgree); return; }
    if (mode === "signup" && password !== confirm) {
      setError(t.login.passwordMismatch); return;
    }
    setBusy(true); setError(null); setNeedsVerify(false); setResendNote(null);
    try {
      const res = await fetch(`/api/auth/${mode === "signup" ? "signup" : "signin"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Sign-up is an address; sign-in is either, and the server decides which.
        body: JSON.stringify(mode === "signup"
          ? { email: identifier, username, firstName, lastName, password,
              acceptedTerms: accepted }
          : { identifier, password }),
      });
      const data = await res.json().catch(() => null);
      // The programme being full is not the user's mistake, so it is shown as
      // its own message rather than as a red validation error.
      if (res.status === 409 && data?.full) { setFull(true); return; }
      // Signing in was refused only because the address is unproved. Not a red
      // error: the account is fine, and the one useful action is another link.
      if (res.status === 403 && data?.verifyPending) { setNeedsVerify(true); return; }
      if (!res.ok) throw new Error(data?.error || t.login.genericError);
      /*
       * Registered, but not signed in — there is no session to go to /habits
       * with, because the account holds no place until the link is clicked.
       */
      if (data?.pending) {
        setPending({ email: data.email ?? identifier, sent: data.sent !== false });
        return;
      }
      /*
       * Signed in with a Google link waiting: attach it now, while the password
       * is freshly proved. A refusal (expired, or the wrong account) is said
       * plainly; either way the person is signed in and continues.
       */
      if (gPending?.step === "link") {
        try {
          const linked = await fetch("/api/auth/google/finish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ link: true }),
          });
          if (linked.ok) {
            setGLinked(true);
            setGPending(null);
            return;   // one calm confirmation card, then Continue
          }
          const body = await linked.json().catch(() => null);
          setError(body?.error || t.errors.googleLinkInvalid);
          setGPending(null);
          setSignedInAnyway(true);
          return;
        } catch {
          /* signed in regardless; the link can be made again from Settings */
        }
      }
      router.push(returnTo ?? "/habits");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.login.genericError);
    } finally {
      setBusy(false);
    }
  };

  /*
   * The account exists and is waiting on its inbox. This replaces the form
   * rather than sitting under it: there is nothing left to fill in, and leaving
   * a filled-out sign-up form on screen invites people to press it again.
   */
  if (pending) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="card p-7 w-full" style={{ maxWidth: 400 }}>
          <div className="flex items-start justify-between gap-3">
            <div className="eyebrow">{t.appName}</div>
            <LanguageToggle />
          </div>
          <h1 className="display mt-1" style={{ fontSize: 24, lineHeight: 1.2 }}>
            {t.verify.sentTitle}
          </h1>
          <p className="mt-3" style={{ fontSize: 14, lineHeight: 1.6 }}>
            {pending.sent ? t.verify.sentBody : t.verify.sendFailed}
          </p>
          {pending.sent && (
            <p className="muted mt-2" style={{ fontSize: 13, lineHeight: 1.55 }}>
              {t.verify.sentHint}
            </p>
          )}
          {resendNote && (
            <p className="mt-3" role="status" style={{ fontSize: 13, lineHeight: 1.55 }}>
              {resendNote}
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-5">
            <button className={pending.sent ? "btn" : "btn btn-primary"}
              onClick={resend} disabled={busy}>
              {busy ? t.verify.resending : t.verify.resend}
            </button>
            <button className="btn btn-quiet" onClick={() => {
              setPending(null); setMode("signin"); setPassword(""); setConfirm("");
            }}>
              {t.verify.backToSignIn}
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (full) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="card p-7 w-full" style={{ maxWidth: 400 }}>
          <div className="flex items-start justify-between gap-3">
            <div className="eyebrow">{t.appName}</div>
            <LanguageToggle />
          </div>
          <h1 className="display mt-1" style={{ fontSize: 24, lineHeight: 1.2 }}>
            {t.earlyAccess.fullTitle}
          </h1>
          <p className="muted mt-3" style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-line" }}>
            {t.earlyAccess.fullBody}
          </p>
          <button className="btn mt-5" onClick={() => { setFull(false); setMode("signin"); }}>
            {t.earlyAccess.back}
          </button>
        </div>
      </main>
    );
  }

  // Google linked to the account that just proved itself: one calm confirmation.
  if (gLinked) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="card p-7 w-full" style={{ maxWidth: 400 }}>
          <div className="eyebrow">{t.appName}</div>
          <h1 className="display mt-1" style={{ fontSize: 26, lineHeight: 1.15 }}>{t.login.googleLinked}</h1>
          <button className="btn btn-primary w-full mt-5"
            onClick={() => { router.push(returnTo ?? "/habits"); router.refresh(); }}>
            {t.login.continueAction}
          </button>
        </div>
      </main>
    );
  }

  // Registering through Google: the username and the terms — the two things
  // only the person can decide — then the same account creation as sign-up.
  if (googleStep === "finish" && gPending?.step === "signup") {
    const finish = async () => {
      if (gBusy) return;
      if (!gAccepted) { setError(t.earlyAccess.mustAgree); return; }
      setGBusy(true); setError(null);
      try {
        const res = await fetch("/api/auth/google/finish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: gUsername, acceptedTerms: gAccepted }),
        });
        const data = await res.json().catch(() => null);
        if (res.status === 409 && data?.full) { setFull(true); return; }
        if (!res.ok) throw new Error(data?.error || t.login.genericError);
        if (data?.pending) { setPending({ email: data.email ?? gPending.email, sent: data.sent !== false }); return; }
        router.push(returnTo ?? "/habits");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : t.login.genericError);
      } finally {
        setGBusy(false);
      }
    };
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="card p-7 w-full" style={{ maxWidth: 400 }}>
          <div className="flex items-start justify-between gap-3">
            <div className="eyebrow">{t.appName}</div>
            <LanguageToggle />
          </div>
          <h1 className="display mt-1" style={{ fontSize: 26, lineHeight: 1.15 }}>{t.login.googleFinishTitle}</h1>
          <p className="muted mt-2" style={{ fontSize: 14, lineHeight: 1.55 }}>
            {t.login.googleFinishIntro(gPending.email)}
          </p>
          <div className="mt-5 flex flex-col gap-3">
            <label className="block">
              <div className="eyebrow mb-1.5">{t.login.username}</div>
              <input className="input" value={gUsername} autoComplete="username" autoCapitalize="none"
                spellCheck={false} placeholder="emma" onChange={(e) => setGUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && finish()} />
              <div className="faint mt-1" style={{ fontSize: 11.5 }}>{t.login.usernameHint}</div>
            </label>
            <label className="flex items-start gap-2.5" style={{ fontSize: 13, lineHeight: 1.5 }}>
              <input type="checkbox" checked={gAccepted} onChange={(e) => setGAccepted(e.target.checked)}
                style={{ marginTop: 3 }} />
              <span>{t.earlyAccess.agree}</span>
            </label>
            {full && <p role="alert" style={{ fontSize: 13.5 }}>{t.earlyAccess.fullTitle} {t.earlyAccess.fullBody}</p>}
            {error && <p role="alert" style={{ fontSize: 13.5, color: "var(--warn)" }}>{error}</p>}
            <button className="btn btn-primary w-full" disabled={gBusy || !gUsername.trim() || !gAccepted}
              onClick={finish}>
              {t.login.createAccount}
            </button>
          </div>
        </div>
      </main>
    );
  }

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

        {googleError && (
          <p className="mt-4" role="status" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
            {googleError === "cancelled" ? t.login.googleCancelled
              : googleError === "disabled" ? t.errors.accountDisabled : t.login.googleFailed}
          </p>
        )}
        {googleStep === "linkExisting" && gPending?.step === "link" && (
          <p className="mt-4" role="status" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
            {t.login.googleLinkIntro(gPending.email)}
          </p>
        )}
        {signedInAnyway && (
          <p className="mt-3" style={{ fontSize: 13.5 }}>
            <Link href={returnTo ?? "/habits"} style={{ textDecoration: "underline" }}>
              {t.login.continueAction} →
            </Link>
          </p>
        )}

        {withGoogle && !googleStep && (
          <>
            <a className="btn w-full mt-5 flex items-center justify-center gap-2.5"
              href={`/api/auth/google/start${thenKeyword ? `?then=${encodeURIComponent(thenKeyword)}` : ""}`}
              style={{ minHeight: 44 }}>
              <GoogleMark />
              {t.login.continueWithGoogle}
            </a>
            <div className="flex items-center gap-3 mt-4" aria-hidden="true">
              <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
              <span className="faint" style={{ fontSize: 12 }}>{t.login.orWithEmail}</span>
              <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
            </div>
          </>
        )}

        <div className="mt-5 flex flex-col gap-3">
          {mode === "signup" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <div className="eyebrow mb-1.5">{t.login.firstName}</div>
                  <input className="input" value={firstName} autoComplete="given-name"
                    onChange={(e) => setFirstName(e.target.value)} />
                </label>
                <label className="block">
                  <div className="eyebrow mb-1.5">{t.login.lastName}</div>
                  <input className="input" value={lastName} autoComplete="family-name"
                    onChange={(e) => setLastName(e.target.value)} />
                </label>
              </div>
              <label className="block">
                <div className="eyebrow mb-1.5">{t.login.username}</div>
                <input className="input" value={username} autoComplete="username"
                  autoCapitalize="none" spellCheck={false} placeholder="emma"
                  onChange={(e) => setUsername(e.target.value)} />
                <div className="faint mt-1" style={{ fontSize: 11.5 }}>{t.login.usernameHint}</div>
              </label>
            </>
          )}

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

          {mode === "signup" && (
            <PasswordField
              label={t.login.confirmPassword}
              value={confirm}
              onChange={setConfirm}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              autoComplete="new-password"
              invalid={confirm.length > 0 && confirm !== password}
              showLabel={t.login.showPassword} hideLabel={t.login.hidePassword}
              hint={confirm.length > 0 && confirm !== password
                ? <span style={{ color: "var(--warn)" }}>{t.login.passwordMismatch}</span>
                : undefined}
            />
          )}
        </div>

        {mode === "signup" && (
          <label className="flex items-start gap-2 mt-3" style={{ fontSize: 13, lineHeight: 1.45 }}>
            <input type="checkbox" checked={accepted} style={{ marginTop: 2, flex: "none" }}
              onChange={(e) => { setAccepted(e.target.checked); setError(null); }} />
            <span>{t.earlyAccess.agree}</span>
          </label>
        )}

        {/*
          * Not styled as an error. The password was right; the account simply
          * has one step left, and the button that finishes it is right here.
          */}
        {needsVerify && (
          <div className="flat p-3 mt-3" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
            <div>{t.errors.verifyPending}</div>
            {resendNote
              ? <div className="muted mt-2" role="status">{resendNote}</div>
              : (
                <button className="btn mt-2" style={{ padding: "4px 12px" }}
                  onClick={resend} disabled={busy}>
                  {busy ? t.verify.resending : t.verify.resend}
                </button>
              )}
          </div>
        )}

        {error && (
          <div className="flat p-3 mt-3" style={{ fontSize: 13.5, borderColor: "var(--warn)", background: "var(--warn-soft)" }}>
            {error}
          </div>
        )}

        <button className="btn btn-primary w-full mt-4" disabled={busy || !identifier.trim() || !password
            || (mode === "signup" && (!accepted || !firstName.trim() || !lastName.trim()
              || username.trim().length < 3 || password !== confirm))} onClick={submit}>
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

        {/* Only on sign-in: there is nothing to have forgotten while registering. */}
        {mode === "signin" && (
          <div className="mt-3 text-center">
            <Link href="/forgot" className="faint" style={{ fontSize: 12.5, textDecoration: "underline" }}>
              {t.forgot.link}
            </Link>
          </div>
        )}

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
