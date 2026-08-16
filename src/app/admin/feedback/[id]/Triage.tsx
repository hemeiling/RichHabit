"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AREA_LABELS, FEEDBACK_AREAS, FEEDBACK_STATUSES, STATUS_LABELS,
} from "@/lib/feedback";
import type { FeedbackArea, FeedbackStatus } from "@/lib/feedback";

/**
 * Triage: where it goes, what state it is in, and a note only the admin sees.
 *
 * The note is safe because there is no user-facing read endpoint for feedback
 * at all — users submit and nothing more. It is not hidden from a response;
 * there is no response it could appear in.
 */
export default function Triage({ id, status, area, adminNote }: {
  id: string; status: FeedbackStatus; area: FeedbackArea | null; adminNote: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(adminNote);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true); setError(null); setSaved(false);
    try {
      const res = await fetch(`/api/admin/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5">
      <div className="eyebrow mb-3">Triage</div>

      <div style={{ fontSize: 13 }}>Status</div>
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {FEEDBACK_STATUSES.map((s) => (
          <button key={s} className="chip" data-on={s === status} disabled={busy}
            onClick={() => patch({ status: s })}>{STATUS_LABELS[s]}</button>
        ))}
      </div>

      <div className="mt-4" style={{ fontSize: 13 }}>
        Area <span className="faint">— which part of RichHabit this is about</span>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {FEEDBACK_AREAS.map((a) => (
          <button key={a} className="chip" data-on={a === area} disabled={busy}
            onClick={() => patch({ area: a === area ? null : a })}>{AREA_LABELS[a]}</button>
        ))}
      </div>

      <label className="block mt-4" style={{ fontSize: 13 }}>
        Internal note <span className="faint">— private; never shown to the user</span>
        <textarea className="textarea mt-1" rows={3} value={note}
          onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="flex items-center gap-2 mt-2">
        <button className="btn" disabled={busy} onClick={() => patch({ adminNote: note })}>
          {busy ? "Saving…" : "Save note"}
        </button>
        {saved && <span className="faint" style={{ fontSize: 12.5 }}>Saved.</span>}
        {error && <span role="alert" style={{ fontSize: 12.5, color: "var(--warn)" }}>{error}</span>}
      </div>
    </section>
  );
}
