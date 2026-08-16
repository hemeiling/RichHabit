"use client";
import { useEffect, useState } from "react";
import { useHabits } from "@/components/store";
import { useT } from "@/lib/i18n/context";
import { MAX_GRATITUDE_ITEMS } from "@/lib/validate";
import type { DayJournal } from "@/lib/types";

/**
 * The day's gratitude journal — open Today, write one to three things, done.
 *
 * Three empty lines to start, because a blank box asks a question a blank page
 * does not. Nothing requires three: empty lines are never stored, and the count
 * of entries is the count of things someone actually wrote.
 *
 * Auto-saved. There is no Save button because forgetting to press one is the
 * most common way a journal entry is lost, and the store already debounces
 * writes for exactly this.
 *
 * Private user content. It is not read by the admin screens, not attached to
 * feedback, and not sent anywhere but this account.
 */

const STARTING_LINES = 3;

/** Local edits, kept per day so switching days does not carry text across. */
function useDraft(date: string, saved: DayJournal | undefined) {
  const [lines, setLines] = useState<string[]>([]);
  const [reflection, setReflection] = useState("");

  useEffect(() => {
    const stored = saved?.gratitude ?? [];
    // Always leave one empty line to write on, without inventing entries.
    setLines(stored.length >= STARTING_LINES ? [...stored, ""] : [
      ...stored, ...Array(STARTING_LINES - stored.length).fill(""),
    ]);
    setReflection(saved?.reflection ?? "");
    // Deliberately keyed on the date alone: re-running when `saved` changes
    // would overwrite what is being typed with what was last written.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  return { lines, setLines, reflection, setReflection };
}

export default function GratitudeJournal({ date }: { date: string }) {
  const { state, actions } = useHabits();
  const t = useT();
  const saved = state.journal[date];
  const { lines, setLines, reflection, setReflection } = useDraft(date, saved);

  const commit = (nextLines: string[], nextReflection: string) =>
    actions.setJournal(date, { gratitude: nextLines, reflection: nextReflection });

  const setLine = (i: number, value: string) => {
    const next = [...lines];
    next[i] = value;
    setLines(next);
    commit(next, reflection);
  };

  const addLine = () => setLines([...lines, ""]);

  const removeLine = (i: number) => {
    const next = lines.filter((_, n) => n !== i);
    const kept = next.length ? next : [""];
    setLines(kept);
    commit(kept, reflection);
  };

  const written = lines.filter((l) => l.trim()).length;

  return (
    <section className="card p-5">
      <div className="eyebrow">{t.journal.title}</div>
      <p className="muted mt-1.5" style={{ fontSize: 14, lineHeight: 1.5 }}>{t.journal.prompt}</p>

      <div className="flex flex-col gap-2 mt-3">
        {lines.map((line, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="faint num" style={{ fontSize: 13, width: 16, flex: "none" }}>
              {i + 1}.
            </span>
            <input
              className="input" value={line}
              placeholder={i === 0 ? t.journal.placeholder : ""}
              aria-label={t.journal.itemLabel(i + 1)}
              onChange={(e) => setLine(i, e.target.value)}
            />
            {/* Only offered once there is more than one line, so the row does
                not carry a control that would empty the whole thing. */}
            {lines.length > 1 && (
              <button className="btn btn-quiet" style={{ padding: "4px 9px", flex: "none" }}
                aria-label={t.journal.removeItem(i + 1)}
                onClick={() => removeLine(i)}>×</button>
            )}
          </div>
        ))}
      </div>

      {lines.length < MAX_GRATITUDE_ITEMS && (
        <button className="btn btn-quiet mt-2" style={{ padding: "5px 11px", fontSize: 13.5 }}
          onClick={addLine}>+ {t.journal.addItem}</button>
      )}

      <div className="mt-4">
        <div className="eyebrow mb-1.5">
          {t.journal.reflectionLabel} <span className="faint">{t.common.optional}</span>
        </div>
        <textarea
          className="textarea" rows={3} value={reflection}
          placeholder={t.journal.reflectionPlaceholder}
          onChange={(e) => { setReflection(e.target.value); commit(lines, e.target.value); }}
        />
      </div>

      <p className="faint mt-2" style={{ fontSize: 12 }}>
        {written > 0 ? t.journal.savedCount(written) : t.journal.autosaves}
      </p>
    </section>
  );
}
