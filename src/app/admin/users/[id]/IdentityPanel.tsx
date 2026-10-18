"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { IdentityView } from "@/lib/admin/users";

/**
 * Sign-in identity (UM-5): correct an account's username or email. The server
 * owns every rule and side effect — uniqueness, format, clearing verification,
 * spending old reset/verification links, the two emails, the masked audit.
 * This card's job is to say, BEFORE the click, what an email change will do
 * to the person: a second step spells it out, including when password
 * sign-in will pause until they confirm the new address.
 */
export default function IdentityPanel({ id, identity }: { id: string; identity: IdentityView }) {
  const router = useRouter();
  const [username, setUsername] = useState(identity.username ?? "");
  const [email, setEmail] = useState(identity.email ?? "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const usernameChanged = username.trim().toLowerCase() !== (identity.username ?? "");
  const emailChanged = email.trim().toLowerCase() !== (identity.email ?? "");
  const pauses = emailChanged && identity.verificationRequired && identity.hasPassword;

  const save = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "identity",
          ...(usernameChanged ? { username } : {}),
          ...(emailChanged ? { email } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setConfirming(false);
      setDone(data.emailChanged
        ? "Saved. A confirmation link went to the new address and a notice to the old one."
        : "Saved.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5" aria-label="Sign-in identity">
      <div className="eyebrow">Sign-in identity</div>
      <div className="grid grid-cols-1 min-[560px]:grid-cols-2 gap-3 mt-3">
        <label className="block">
          <span className="eyebrow block mb-1" style={{ fontSize: 10 }}>Username</span>
          <input className="input" value={username} onChange={(e) => { setUsername(e.target.value); setConfirming(false); }}
            autoCapitalize="none" spellCheck={false} aria-label="Username" />
        </label>
        <label className="block">
          <span className="eyebrow block mb-1" style={{ fontSize: 10 }}>Email</span>
          <input className="input" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setConfirming(false); }}
            autoCapitalize="none" spellCheck={false} aria-label="Email" />
        </label>
      </div>
      {identity.hasGoogle && (
        <p className="faint mt-2" style={{ fontSize: 12 }}>
          This account signs in with Google too. That link follows Google&apos;s own id, not the email, so it keeps working.
        </p>
      )}

      {confirming && emailChanged ? (
        <div className="flat p-3.5 mt-3" role="alert">
          <p style={{ fontSize: 13.5, lineHeight: 1.55 }}>
            Change the email to <b>{email.trim().toLowerCase()}</b>? The new address is unconfirmed until they use the
            link sent to it; old password-reset and confirmation links stop working; the old address gets a notice.
            {pauses && <> <b>They will not be able to sign in with their password until they confirm the new address.</b></>}
          </p>
          <div className="flex gap-2 mt-3">
            <button className="btn" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy} onClick={save}>
              {busy ? "Working…" : "Yes, change the email"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 mt-3">
          <button className="btn" disabled={busy || (!usernameChanged && !emailChanged)}
            onClick={() => (emailChanged ? setConfirming(true) : save())}>
            {busy ? "Working…" : "Save"}
          </button>
        </div>
      )}
      {done && <p className="mt-3" style={{ fontSize: 13 }}>{done}</p>}
      {error && <p role="alert" className="mt-3" style={{ fontSize: 13, color: "var(--warn)" }}>{error}</p>}
    </section>
  );
}
