"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Account actions, and the danger zone beneath them.
 *
 * Every button here is a request. The server decides whether it happens: it
 * re-reads the caller's role, refuses to let an admin delete or disable the
 * account they are signed in with, and refuses to remove the last active admin.
 * Hiding a button is a courtesy to the person clicking; it is not the rule, and
 * this component is written on that assumption — the failures it renders are
 * the ones the server sent back.
 */
export default function AccountActions({
  id, email, role, disabled, isSelf, setupPending = false,
}: {
  id: string; email: string; role: "user" | "admin"; disabled: boolean; isSelf: boolean;
  /** Created with a setup link that was never used (UM-4): offer a replacement. */
  setupPending?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  /** A reissued setup link, shown once and never again (UM-4). */
  const [setupLink, setSetupLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmingRole, setConfirmingRole] = useState(false);
  const [typed, setTyped] = useState("");

  const call = async (action: string, body: Record<string, unknown> = {}) => {
    setBusy(action);
    setError(null);
    setPassword(null);
    setSetupLink(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      if (data?.temporaryPassword) setPassword(data.temporaryPassword);
      if (data?.setupToken) {
        setSetupLink({
          // Fragment, never path: no request carries it, so no log can keep it.
          url: `${window.location.origin}/setup#token=${encodeURIComponent(data.setupToken)}`,
          expiresAt: data.expiresAt,
        });
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      // Nothing left to show a profile for.
      window.location.replace("/admin/users");
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <>
      <section className="card p-5">
        <div className="eyebrow mb-3">Account actions</div>
        <div className="flex flex-wrap gap-2">
          {disabled ? (
            <button className="btn" disabled={!!busy} onClick={() => call("enable")}>
              {busy === "enable" ? "Working…" : "Re-enable account"}
            </button>
          ) : (
            <button className="btn" disabled={!!busy || isSelf} onClick={() => call("disable")}
              title={isSelf ? "You cannot disable the account you are signed in with" : undefined}>
              {busy === "disable" ? "Working…" : "Disable account"}
            </button>
          )}
          <button className="btn" disabled={!!busy} onClick={() => call("reset_password")}>
            {busy === "reset_password" ? "Working…" : "Reset password"}
          </button>
          {setupPending && (
            <button className="btn" disabled={!!busy || disabled}
              title={disabled ? "Re-enable the account before sending a setup link" : undefined}
              onClick={() => call("reissue_setup")}>
              {busy === "reissue_setup" ? "Working…" : "Reissue setup link"}
            </button>
          )}
          {/* Confirmed rather than immediate. Every other control here is
              either reversible in a click or already asks; a privilege change
              was the one action that granted or removed access to every
              account in the system on a single tap. */}
          <button className="btn" disabled={!!busy || isSelf || confirmingRole}
            title={isSelf ? "You cannot change your own role" : undefined}
            onClick={() => { setConfirmingRole(true); setError(null); }}>
            {role === "admin" ? "Demote to user" : "Make admin"}
          </button>
        </div>

        {confirmingRole && (
          <div className="flat p-3.5 mt-3">
            <p style={{ fontSize: 13.5, lineHeight: 1.55 }}>
              {role === "admin" ? (
                <>
                  Remove admin from <b>{email}</b>? They keep every habit, completion,
                  goal, journal entry and spending record, and carry on appearing in
                  Community Progress. They lose these admin screens, and begin counting
                  towards the account cap, if one is set.
                </>
              ) : (
                <>
                  Make <b>{email}</b> an admin? They gain access to every account in
                  this system, including disabling and deleting them. Their own habits
                  and history are untouched, and they stop counting towards the
                  account cap.
                </>
              )}
            </p>
            <div className="flex gap-2 mt-3">
              <button className="btn" disabled={!!busy}
                onClick={() => setConfirmingRole(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!!busy}
                onClick={async () => {
                  await call("role", { role: role === "admin" ? "user" : "admin" });
                  setConfirmingRole(false);
                }}>
                {busy === "role" ? "Working…"
                  : role === "admin" ? "Yes, remove admin" : "Yes, make admin"}
              </button>
            </div>
          </div>
        )}

        {setupLink && (
          <div className="flat p-3.5 mt-3">
            <div className="eyebrow" style={{ fontSize: 10 }}>New setup link</div>
            <div className="num mt-1" style={{ fontSize: 13.5, wordBreak: "break-all" }}>{setupLink.url}</div>
            <div className="flex items-center gap-2 mt-2">
              <button className="btn" style={{ fontSize: 12.5, padding: "4px 10px" }}
                onClick={async () => {
                  try { await navigator.clipboard.writeText(setupLink.url); setCopied(true); } catch { /* copy by hand */ }
                }}>
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <p className="faint mt-2" style={{ fontSize: 12.5 }}>
              Shown once. Works one time, until {setupLink.expiresAt.slice(0, 10)}. Every earlier
              setup link for this account has stopped working.
            </p>
          </div>
        )}

        {password && (
          <div className="flat p-3.5 mt-3">
            <div className="eyebrow" style={{ fontSize: 10 }}>New temporary password</div>
            <div className="num mt-1" style={{ fontSize: 17, wordBreak: "break-all" }}>{password}</div>
            <p className="faint mt-2" style={{ fontSize: 12.5 }}>
              Shown once. Their existing sessions have been signed out, and they will be
              asked to choose their own password on the next sign-in.
            </p>
          </div>
        )}

        {error && (
          <p className="mt-3" role="alert" style={{ fontSize: 13.5, color: "var(--warn)" }}>{error}</p>
        )}
      </section>

      {/* Deliberately its own card, at the end, with its own heading. */}
      <section className="card p-5" style={{ borderColor: "#B3453B" }}>
        <div className="eyebrow mb-2" style={{ color: "#B3453B" }}>Danger zone</div>
        {!confirming ? (
          <>
            <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
              Deleting removes the account and everything it owns — habits, schedules,
              completions, goals, awareness entries, reviews, metrics, spending records,
              preferences and sessions. Analytics rows are kept but detached from the
              person. This cannot be undone.
            </p>
            <button className="btn btn-danger mt-3" disabled={isSelf}
              title={isSelf ? "You cannot delete the account you are signed in with" : undefined}
              onClick={() => { setConfirming(true); setTyped(""); }}>
              Delete account
            </button>
            {isSelf && (
              <p className="faint mt-2" style={{ fontSize: 12.5 }}>
                This is the account you are signed in with.
              </p>
            )}
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, lineHeight: 1.55 }}>
              This permanently deletes <b>{email}</b> and every record belonging to it.
              There is no undo and no export afterwards.
            </p>
            <label className="block mt-3" style={{ fontSize: 13 }}>
              Type <b>{email}</b> to confirm
              <input className="input mt-1" value={typed} autoFocus
                onChange={(e) => setTyped(e.target.value)} placeholder={email} />
            </label>
            {error && (
              <p className="mt-3" role="alert" style={{ fontSize: 13.5, color: "var(--warn)" }}>
                {error}
              </p>
            )}
            <div className="flex gap-2 mt-3">
              <button className="btn" disabled={!!busy}
                onClick={() => { setConfirming(false); setError(null); }}>Cancel</button>
              <button className="btn btn-danger"
                disabled={!!busy || typed.trim().toLowerCase() !== email.toLowerCase()}
                onClick={remove}>
                {busy === "delete" ? "Deleting…" : "Delete account"}
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
