"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { coach } from "@/lib/coach";
import { useT } from "@/lib/i18n/context";

/**
 * The asking half of Insights. Everything else on the screen is computed from
 * the data; this is the one place that reaches for a model, and it sits below
 * the numbers rather than in front of them. One question, one answer — asking
 * again replaces the last answer, because this is a lens on the dashboard, not
 * a conversation to scroll back through.
 */

/**
 * The model writes markdown — **bold** around habit and goal names, and the odd
 * bulleted list. Only those two, so they're handled here rather than pulling in
 * a parser: anything else it emits is shown as typed.
 */
function inline(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 ? <strong key={i}>{part}</strong> : part,
  );
}

function Answer({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="mt-1.5 flex flex-col gap-2" style={{ fontSize: 14, lineHeight: 1.55 }}>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const bullets = lines.every((l) => /^\s*[-*]\s+/.test(l));
        if (bullets) {
          return (
            <ul key={i} className="flex flex-col gap-1.5 pl-4" style={{ listStyle: "disc" }}>
              {lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ""))}</li>)}
            </ul>
          );
        }
        return <p key={i}>{inline(block)}</p>;
      })}
    </div>
  );
}

export default function AskCoach() {
  const t = useT();
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const ask = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || busy) return;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setBusy(true);
    setError(null);
    setAnswer("");
    setAsked(trimmed);
    try {
      const reply = await coach.ask(trimmed, controller.signal);
      if (!controller.signal.aborted) setAnswer(reply);
    } catch (e) {
      if (controller.signal.aborted) return; // unmounted or superseded
      setError(e instanceof Error ? e.message : t.coach.wentWrong);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [busy, t]);

  return (
    <section className="card p-5">
      <div className="eyebrow">{t.coach.title}</div>
      <p className="muted mt-1" style={{ fontSize: 13, lineHeight: 1.45 }}>
        {t.coach.subtitle}
      </p>

      <textarea
        className="textarea w-full mt-3"
        rows={2}
        value={question}
        disabled={busy}
        placeholder={t.coach.placeholder}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          // Enter asks; Shift+Enter is a newline, since this is a textarea.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void ask(question);
          }
        }}
      />

      <div className="flex flex-wrap gap-2 mt-3">
        {t.coach.suggestions.map((s) => (
          <button
            key={s}
            type="button"
            className="chip"
            disabled={busy}
            onClick={() => { setQuestion(s); void ask(s); }}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex justify-end mt-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !question.trim()}
          onClick={() => void ask(question)}
        >
          {busy ? t.coach.thinking : t.coach.ask}
        </button>
      </div>

      {(busy || answer || error) && (
        <div className="flat p-3.5 mt-3 fade-in">
          {asked && (
            <div className="faint" style={{ fontSize: 12, lineHeight: 1.4 }}>{asked}</div>
          )}
          {busy ? (
            <p className="muted mt-1.5" style={{ fontSize: 14 }}>{t.coach.reading}</p>
          ) : error ? (
            <>
              <p className="mt-1.5" style={{ fontSize: 14, lineHeight: 1.5, color: "var(--warn)" }}>
                {error}
              </p>
              <button
                type="button"
                className="btn btn-quiet mt-2"
                onClick={() => void ask(asked)}
              >
                {t.coach.tryAgain}
              </button>
            </>
          ) : (
            <Answer text={answer} />
          )}
        </div>
      )}
    </section>
  );
}
