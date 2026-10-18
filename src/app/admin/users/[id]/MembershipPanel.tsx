"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Membership } from "@/lib/admin/plans";

/**
 * Membership (UM-3): grant complimentary Advanced, change its expiry and note,
 * or revoke it. Every rule is the server's — admins hold no plan, a
 * grandfathered row needs the username typed back and a reason — and this
 * panel renders whatever refusal comes back rather than pretending to decide.
 * Dates are the last day the plan holds; the server stores the end of it.
 */
const SOURCE: Record<string, string> = {
  grandfathered: "Grandfathered", gifted: "Gifted", purchased: "Paid",
  promotional: "Promotional", trial: "Trial", support: "Support",
};

export default function MembershipPanel({ id, membership }: { id: string; membership: Membership }) {
  const router = useRouter();
  const rec = membership.record;
  const advanced = membership.effective === "pro";
  const grandfathered = membership.protectedPlan;
  const [expiresOn, setExpiresOn] = useState(advanced && rec?.expiresAt ? rec.expiresAt.slice(0, 10) : "");
  const [note, setNote] = useState(rec?.note ?? "");
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  if (membership.role === "admin") {
    return (
      <section className="card p-5" aria-label="Membership">
        <div className="eyebrow">Membership</div>
        <p className="mt-2" style={{ fontSize: 14 }}>Admin — unlimited by role.</p>
        <p className="faint mt-1" style={{ fontSize: 12 }}>Administrators hold no plan; consumer limits never apply to them.</p>
      </section>
    );
  }

  const send = async (op: "grant" | "modify" | "revoke") => {
    setBusy(op);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "plan", op, expiresOn: expiresOn || null, note, confirm, reason }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setConfirm(""); setReason(""); setRevoking(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const guarded = grandfathered && (confirm.trim().toLowerCase() !== membership.identifier.toLowerCase() || !reason.trim());
  const status = advanced
    ? `Advanced · ${SOURCE[rec?.source ?? ""] ?? rec?.source ?? "—"} · ${rec?.expiresAt ? `through ${rec.expiresAt.slice(0, 10)}` : "no expiry"}`
    : rec?.source ? `Free (an Advanced grant from ${SOURCE[rec.source] ?? rec.source} was removed or has expired)` : "Free";

  return (
    <section className="card p-5" aria-label="Membership">
      <div className="eyebrow">Membership</div>
      <p className="mt-2" style={{ fontSize: 14 }} data-testid="membership-status">{status}</p>
      {rec?.note && <p className="faint mt-1" style={{ fontSize: 12 }}>Note: {rec.note}</p>}

      <div className="grid grid-cols-1 min-[560px]:grid-cols-2 gap-3 mt-4">
        <label className="block">
          <span className="eyebrow block mb-1" style={{ fontSize: 10 }}>Last day (optional)</span>
          <input className="input" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)}
            aria-label="Last day of the plan" />
        </label>
        <label className="block">
          <span className="eyebrow block mb-1" style={{ fontSize: 10 }}>Admin note (optional)</span>
          <input className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)}
            aria-label="Admin note" />
        </label>
      </div>

      {grandfathered && (
        <div className="flat p-3 mt-3">
          <p style={{ fontSize: 13, lineHeight: 1.5 }}>
            This is a <b>grandfathered</b> plan — permanent Advanced given to an early account.
            To change or revoke it, type the username <b>{membership.identifier}</b> and give a reason.
          </p>
          <div className="grid grid-cols-1 min-[560px]:grid-cols-2 gap-3 mt-2">
            <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              placeholder={membership.identifier} aria-label="Type the username to confirm" />
            <input className="input" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (required)" aria-label="Reason for the change" />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        {!advanced ? (
          <button className="btn btn-primary" disabled={!!busy || guarded} onClick={() => send("grant")}>
            {busy === "grant" ? "Working…" : "Grant Advanced (complimentary)"}
          </button>
        ) : (
          <>
            <button className="btn" disabled={!!busy || guarded} onClick={() => send("modify")}>
              {busy === "modify" ? "Working…" : "Save expiry and note"}
            </button>
            {!revoking ? (
              <button className="btn" disabled={!!busy || guarded} onClick={() => setRevoking(true)}>
                Revoke Advanced…
              </button>
            ) : (
              <>
                <button className="btn btn-danger" disabled={!!busy || guarded} onClick={() => send("revoke")}>
                  {busy === "revoke" ? "Working…" : "Yes, return this account to Free"}
                </button>
                <button className="btn btn-quiet" disabled={!!busy} onClick={() => setRevoking(false)}>Cancel</button>
              </>
            )}
          </>
        )}
      </div>
      {error && <p role="alert" className="mt-3" style={{ fontSize: 13, color: "var(--warn)" }}>{error}</p>}
      <p className="faint mt-3" style={{ fontSize: 11.5, lineHeight: 1.45 }}>
        Complimentary Advanced is recorded as Gifted. Free limits are unchanged; every change is audited below,
        with the complete plan before and after.
      </p>
    </section>
  );
}
