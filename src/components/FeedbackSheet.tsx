"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Field, Segmented, Sheet } from "@/components/ui";
import { useLocale, useT } from "@/lib/i18n/context";
import { FEEDBACK_TYPES, MAX_BODY, type FeedbackType } from "@/lib/feedback";

/**
 * Feedback about Rich Habits, from someone using it.
 *
 * Not habit tracking, not coaching, not reflection — it never appears anywhere
 * in the user's own record, and it is write-only: there is no screen, here or
 * anywhere, where a user reads feedback back. That is what keeps the admin's
 * private note private, structurally rather than by filtering.
 *
 * What travels with it is listed on the form itself, in the user's language,
 * because "what are you sending about me" should not require trusting a
 * privacy policy. Nothing of their habits, goals, notes, metrics or spending is
 * read by this component.
 */

/**
 * Downscaled in the browser before it is sent. A phone screenshot is several
 * megabytes; the column caps at one, and a free Postgres is not object storage.
 * The server checks the size again — this is a courtesy, not the rule.
 */
const MAX_EDGE = 1400;
const JPEG_QUALITY = 0.72;

async function downscale(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

export default function FeedbackSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const pathname = usePathname();

  const [type, setType] = useState<FeedbackType>("general");
  const [body, setBody] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attach = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setScreenshot(await downscale(file));
    } catch {
      setError(t.feedback.failed);
    }
  };

  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type, body, rating, screenshot,
          // The path only, and only these three things besides.
          page: pathname, locale,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSent(true);
    } catch {
      setError(t.feedback.failed);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Sheet
        open onClose={onClose} title={t.feedback.title}
        footer={
          <>
            <button className="btn" onClick={() => {
              setSent(false); setBody(""); setRating(null); setScreenshot(null);
              setType("general");
            }}>{t.feedback.another}</button>
            <button className="btn btn-primary" onClick={onClose}>{t.common.close}</button>
          </>
        }
      >
        <p style={{ fontSize: 15, lineHeight: 1.55 }}>{t.feedback.thanks}</p>
      </Sheet>
    );
  }

  return (
    <Sheet
      open onClose={onClose} title={t.feedback.title}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={onClose}>{t.common.cancel}</button>
          <button className="btn btn-primary" disabled={busy || !body.trim()} onClick={submit}>
            {busy ? t.feedback.sending : t.feedback.send}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.55 }}>{t.feedback.intro}</p>

      <Field label={t.feedback.typeLabel}>
        <Segmented<FeedbackType> value={type} onChange={setType} small
          options={FEEDBACK_TYPES.map((v) => ({ value: v, label: t.feedback.types[v] }))} />
      </Field>

      <Field label={t.feedback.bodyLabel}>
        <textarea className="textarea" rows={5} value={body} autoFocus
          maxLength={MAX_BODY} placeholder={t.feedback.bodyPlaceholder}
          onChange={(e) => setBody(e.target.value)} />
      </Field>

      <Field label={t.feedback.ratingLabel} hint={t.feedback.ratingHint}>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" className="chip" data-on={rating === n}
              aria-pressed={rating === n} aria-label={`${n}`}
              style={{ width: 42, textAlign: "center" }}
              onClick={() => setRating(rating === n ? null : n)}>{n}</button>
          ))}
        </div>
      </Field>

      <Field label={t.feedback.screenshotLabel} hint={t.feedback.screenshotHint}>
        {screenshot ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={screenshot} alt="" style={{
              width: 96, height: 64, objectFit: "cover", borderRadius: 8,
              border: "1px solid var(--line)",
            }} />
            <button className="btn" onClick={() => setScreenshot(null)}>
              {t.feedback.screenshotRemove}
            </button>
          </div>
        ) : (
          <input type="file" accept="image/*" style={{ fontSize: 13 }}
            onChange={(e) => attach(e.target.files?.[0])} />
        )}
      </Field>

      {/* Said plainly, on the form, in their language. */}
      <div className="flat p-3 mt-2">
        <div className="eyebrow" style={{ fontSize: 10 }}>{t.feedback.contextTitle}</div>
        <p className="faint mt-1" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          {t.feedback.contextBody(pathname, "app version", locale)}
        </p>
      </div>

      {error && (
        <p className="mt-3" role="alert" style={{ fontSize: 13.5, color: "var(--warn)" }}>
          {error}
        </p>
      )}
    </Sheet>
  );
}
