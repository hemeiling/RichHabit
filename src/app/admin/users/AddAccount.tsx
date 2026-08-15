"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

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

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [disabled, setDisabled] = useState(false);
  const [credential, setCredential] = useState<"invite" | "temporary">("invite");
  const [locale, setLocale] = useState("en");
  const [seedHabits, setSeedHabits] = useState(true);

  const reset = () => {
    setEmail(""); setDisplayName(""); setRole("user"); setDisabled(false);
    setCredential("invite"); setLocale("en"); setSeedHabits(true);
    setError(null); setDone(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, displayName, role, disabled, credential, locale, seedHabits }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
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
          <div className="grid grid-cols-1 min-[560px]:grid-cols-2 gap-3 mt-3">
            <label style={{ fontSize: 13 }}>
              Email
              <input className="input mt-1" type="email" autoFocus value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="person@example.com" />
            </label>
            <label style={{ fontSize: 13 }}>
              Display name <span className="faint">optional</span>
              <input className="input mt-1" value={displayName}
                onChange={(e) => setDisplayName(e.target.value)} />
            </label>
          </div>

          <div className="grid grid-cols-1 min-[560px]:grid-cols-2 gap-3 mt-3">
            <label style={{ fontSize: 13 }}>
              Role
              <select className="select mt-1" value={role}
                onChange={(e) => setRole(e.target.value as "user" | "admin")}>
                <option value="user">User</option>
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
                onChange={(e) => setCredential(e.target.value as "invite" | "temporary")}>
                <option value="invite">Setup link</option>
                <option value="temporary">Temporary password</option>
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
            <button className="btn btn-primary" disabled={busy || !email.includes("@")}
              onClick={submit}>
              {busy ? "Creating…" : "Create account"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
