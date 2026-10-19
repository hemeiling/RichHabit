"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { IdentityView } from "@/lib/admin/users";

/**
 * Sign-in identity (UM-5): correct an account's username or email. The server
 * owns every rule and side effect — uniqueness, format, Admin protection,
 * spending old reset/verification/setup links, the two emails, the masked
 * audit. This card's job is to say, BEFORE the click, what an email change
 * will do: a second step spells out that it is a request, which takes effect
 * only when the new address is confirmed — until then the person keeps
 * signing in exactly as before. A waiting request is shown, and can be
 * cancelled.
 */
/** One spelling on the server and in the browser, so hydration never disagrees. */
const utc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

export default function IdentityPanel({ id, identity }: { id: string; identity: IdentityView }) {
  const router = useRouter();
  const [username, setUsername] = useState(identity.username ?? "");
  const [email, setEmail] = useState(identity.email ?? "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const usernameChanged = username.trim().toLowerCase() !== (identity.username ?? "");
  const emailChanged = !identity.adminProtected
    && email.trim().toLowerCase() !== (identity.email ?? "").toLowerCase();
  const current = identity.email ?? (identity.username ? `the username ${identity.username}` : "their current details");

  const send = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const data = await send({
        action: "identity",
        ...(usernameChanged ? { username } : {}),
        ...(emailChanged ? { email } : {}),
      });
      setConfirming(false);
      // The field shows the address in force; the request is shown below it.
      if (data.emailChangeRequested) setEmail(identity.email ?? "");
      setDone(!data.emailChangeRequested
        ? "Saved."
        : data.confirmationSent
          ? "Change requested. It takes effect when they use the link sent to the new address; a notice went to the current one."
          : "Change requested — but the confirmation email could not be sent just now. Save the same address again to send a fresh link.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await send({ action: "cancel_email_change" });
      setDone("Change cancelled. The link no longer works, and nothing about the account changed.");
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
            autoCapitalize="none" spellCheck={false} aria-label="Email" readOnly={identity.adminProtected} />
        </label>
      </div>
      {identity.adminProtected && (
        <p className="faint mt-2" style={{ fontSize: 12 }}>
          An Administrator&apos;s email — or a former Administrator&apos;s — can&apos;t be changed here. This protects
          Admin accounts until a second Admin can approve such a change.
        </p>
      )}
      {identity.hasGoogle && (
        <p className="faint mt-2" style={{ fontSize: 12 }}>
          This account also signs in with Google. That link follows Google&apos;s own id, not the email, so it stays
          with this account.
        </p>
      )}

      {identity.pendingEmail && (
        <div className="flat p-3.5 mt-3" aria-label="Email change waiting for confirmation">
          <p style={{ fontSize: 13.5, lineHeight: 1.55 }}>
            Waiting for confirmation: <b>{identity.pendingEmail.email}</b>. Until the link sent there is used, they keep
            signing in with {current}. The link expires {utc(identity.pendingEmail.expiresAt)}.
          </p>
          <div className="flex gap-2 mt-3">
            <button className="btn" disabled={busy} onClick={cancel}>{busy ? "Working…" : "Cancel change"}</button>
          </div>
        </div>
      )}

      {confirming && emailChanged ? (
        <div className="flat p-3.5 mt-3" role="alert">
          <p style={{ fontSize: 13.5, lineHeight: 1.55 }}>
            Request a change of sign-in email to <b>{email.trim().toLowerCase()}</b>? A confirmation link goes to that
            address, and <b>the change takes effect only when it is used</b> — until then they keep signing in with{" "}
            {current}, and nothing else about the account changes. Password-reset, confirmation and setup links sent
            before now stop working, and the current address gets a notice with no link.
          </p>
          <div className="flex gap-2 mt-3">
            <button className="btn" disabled={busy} onClick={() => setConfirming(false)}>Back</button>
            <button className="btn btn-primary" disabled={busy} onClick={save}>
              {busy ? "Working…" : "Yes, send the confirmation link"}
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
