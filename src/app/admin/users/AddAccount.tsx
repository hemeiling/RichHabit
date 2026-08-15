"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PasswordField from "@/components/PasswordField";
import { MIN_LENGTH, passwordProblems, passwordStrength } from "@/lib/password";

/**
 * Creating an account from Admin → Users.
 *
 * Nothing here decides anything. The role, the status and the credential are
 * sent as a request; whether the caller may do any of it is decided in
 * `lib/admin/users.ts` behind `withAdmin`, which re-reads the caller's role
 * from the database. This form is a way of asking.
 *
 * The credential is a setup link by default. This deployment has no mail
 * transport, so nothing is emailed — the link is shown once for the admin to
 * pass on. Saying "an invite has been sent" would be a lie that strands every
 * account created this way.
 */

const LOCALES: [string, string][] = [["en", "English"], ["zh", "中文"], ["both", "Bilingual"]];

export default function AddAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string; password?: string; link?: string } | null>(null);

  const [loginType, setLoginType] = useState<"email" | "username">("email");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [disabled, setDisabled] = useState(false);
  const [credential, setCredential] = useState<"invite" | "set">("invite");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [requireChange, setRequireChange] = useState(false);
  const [locale, setLocale] = useState("en");
  const [seedHabits, setSeedHabits] = useState(true);

  const reset = () => {
    setLoginType("email"); setEmail(""); setUsername(""); setDisplayName(""); setRole("user"); setDisabled(false);
    setCredential("invite"); setPassword(""); setConfirm(""); setRequireChange(false);
    setLocale("en"); setSeedHabits(true);
    setError(null); setDone(null);
  };

  /*
   * A username account has no address a setup link could be sent to, so
   * setting a password is the normal way in. Only the default changes — an
   * admin can still choose a link and hand it over some other way.
   */
  useEffect(() => {
    setCredential(loginType === "username" ? "set" : "invite");
  }, [loginType]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only the chosen identifier is sent, so a half-typed one left in the
        // other box cannot end up on the account.
        body: JSON.stringify({
          email: loginType === "email" ? email : "",
          username: loginType === "username" ? username : "",
          displayName, role, disabled, credential, locale, seedHabits,
          // Sent once, over the same origin, straight into the create service.
          // Nothing else here writes it anywhere.
          password: credential === "set" ? password : undefined,
          requireChange: credential === "set" ? requireChange : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      // Dropped the moment the request succeeds; it is never shown back.
      setPassword("");
      setConfirm("");
      setDone({
        email: data.email,
        password: data.temporaryPassword,
        link: data.setupToken
          ? `${window.location.origin}/setup/${data.setupToken}`
          : undefined,
      });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const problems = passwordProblems(password);
  const problemText = problems.includes("too_short")
    ? `At least ${MIN_LENGTH} characters.`
    : problems.includes("too_long") ? "That password is too long."
      : problems.includes("too_simple") ? "That password is too easy to guess."
        : "";
  const strength = passwordStrength(password);
  const matches = password === confirm;
  const passwordReady = credential !== "set"
    || (problems.length === 0 && matches && confirm.length > 0);

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => { reset(); setOpen(true); }}>
        + Add Account
      </button>
    );
  }

  return (
    <div className="card p-5 mt-3">
      {done ? (
        <>
          <div className="eyebrow">Account created</div>
          <p className="mt-2" style={{ fontSize: 15 }}>{done.email}</p>
          {/* Shown once, here, and never written to the audit log. */}
          {done.password && (
            <div className="flat p-3.5 mt-3">
              <div className="eyebrow" style={{ fontSize: 10 }}>Temporary password</div>
              <div className="num mt-1" style={{ fontSize: 17, wordBreak: "break-all" }}>
                {done.password}
              </div>
              <p className="faint mt-2" style={{ fontSize: 12.5 }}>
                Shown once. They will be asked to choose their own on first sign-in.
              </p>
            </div>
          )}
          {!done.password && !done.link && (
            <p className="muted mt-3" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
              They can sign in now with the password you set. It is not shown here,
              and it cannot be looked up later — issue a new one from the account
              page if it is lost.
            </p>
          )}
          {done.link && (
            <div className="flat p-3.5 mt-3">
              <div className="eyebrow" style={{ fontSize: 10 }}>Setup link</div>
              <div className="mt-1" style={{ fontSize: 13, wordBreak: "break-all" }}>{done.link}</div>
              <p className="faint mt-2" style={{ fontSize: 12.5 }}>
                Single use, expires in 7 days. Nothing was emailed — send it yourself.
              </p>
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <button className="btn" onClick={reset}>Add another</button>
            <button className="btn" onClick={() => setOpen(false)}>Done</button>
          </div>
        </>
      ) : (
        <>
          <div className="eyebrow">New account</div>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className="eyebrow" style={{ minWidth: 86 }}>Login type</span>
            {([["email", "Email"], ["username", "Username"]] as const).map(([v, label]) => (
              <button key={v} type="button" className="chip" data-on={loginType === v}
                onClick={() => setLoginType(v)}>{label}</button>
            ))}
          </div>

          <div className="grid grid-cols-1 min-[560px]:grid-cols-2 gap-3 mt-3">
            {loginType === "email" ? (
              <label style={{ fontSize: 13 }}>
                Email
                <input className="input mt-1" type="email" autoFocus value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="person@example.com" />
              </label>
            ) : (
              /* A managed account for someone with no address. Requiring one
                 would mean inventing a fake, which then looks real in the list. */
              <label style={{ fontSize: 13 }}>
                Username
                <input className="input mt-1" autoFocus value={username} autoCapitalize="none"
                  spellCheck={false} placeholder="emma"
                  onChange={(e) => setUsername(e.target.value)} />
                <span className="faint block mt-1" style={{ fontSize: 12 }}>
                  3–30 characters: letters, digits, and dots, hyphens or underscores between them.
                </span>
              </label>
            )}
            <label style={{ fontSize: 13 }}>
              Display name <span className="faint">optional</span>
              <input className="input mt-1" value={displayName}
                onChange={(e) => setDisplayName(e.target.value)} />
            </label>
          </div>

          <div className="grid grid-cols-1 min-[560px]:grid-cols-2 gap-3 mt-3">
            <label style={{ fontSize: 13 }}>
              Account type
              <select className="select mt-1" value={role}
                onChange={(e) => setRole(e.target.value as "user" | "admin")}>
                <option value="user">Regular user</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              Account status
              <select className="select mt-1" value={disabled ? "disabled" : "active"}
                onChange={(e) => setDisabled(e.target.value === "disabled")}>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              Credential
              <select className="select mt-1" value={credential}
                onChange={(e) => setCredential(e.target.value as "invite" | "set")}>
                <option value="invite">Setup link</option>
                <option value="set">Set password</option>
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              Preferred language <span className="faint">optional</span>
              <select className="select mt-1" value={locale}
                onChange={(e) => setLocale(e.target.value)}>
                {LOCALES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>

          {credential === "set" && (
            <div className="mt-3 flex flex-col gap-3">
              <PasswordField
                label="Password" value={password} onChange={setPassword}
                autoComplete="new-password"
                showLabel="Show password" hideLabel="Hide password"
                invalid={password.length > 0 && problems.length > 0}
                hint={
                  <>
                    At least {MIN_LENGTH} characters. Longer beats complicated —
                    a few ordinary words is stronger than eight of punctuation.
                  </>
                }
              />
              {password.length > 0 && (
                <div>
                  <div style={{ display: "flex", gap: 4 }} aria-hidden="true">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} style={{
                        flex: 1, height: 4, borderRadius: 2,
                        background: i < strength.score
                          ? (strength.score <= 1 ? "var(--warn)" : "var(--accent)")
                          : "var(--line-soft)",
                      }} />
                    ))}
                  </div>
                  <p className="faint mt-1" style={{ fontSize: 12.5 }} role="status">
                    {problems.length > 0 ? problemText : `Strength: ${strength.label}`}
                  </p>
                </div>
              )}
              <PasswordField
                label="Confirm password" value={confirm} onChange={setConfirm}
                autoComplete="new-password"
                showLabel="Show password" hideLabel="Hide password"
                invalid={confirm.length > 0 && !matches}
                hint={confirm.length > 0 && !matches
                  ? <span style={{ color: "var(--warn)" }}>The passwords do not match.</span>
                  : undefined}
              />
              <label className="flex items-center gap-2" style={{ fontSize: 13.5 }}>
                <input type="checkbox" checked={requireChange}
                  onChange={(e) => setRequireChange(e.target.checked)} />
                Require a password change on first login
              </label>
            </div>
          )}

          {/* Said plainly, at the moment of choosing. The server records this as
              its own audit action, admin_account_created. */}
          {role === "admin" && (
            <p className="flat p-3 mt-3" role="status" style={{
              fontSize: 13, lineHeight: 1.55, borderColor: "var(--warn)",
              background: "var(--warn-soft)",
            }}>
              This account will have <b>admin access</b>: it can see every user&apos;s activity,
              create and delete accounts, and grant admin to others.
            </p>
          )}

          <label className="flex items-center gap-2 mt-3" style={{ fontSize: 13.5 }}>
            <input type="checkbox" checked={seedHabits}
              onChange={(e) => setSeedHabits(e.target.checked)} />
            Start them with the standard starter habits
          </label>

          {error && (
            <p className="mt-3" role="alert" style={{ fontSize: 13.5, color: "var(--warn)" }}>
              {error}
            </p>
          )}

          <div className="flex gap-2 mt-4">
            <button className="btn" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary"
              disabled={busy || !passwordReady || (loginType === "email"
                ? !email.includes("@") : username.trim().length < 3)}
              onClick={submit}>
              {busy ? "Creating…" : "Create account"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
