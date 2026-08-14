"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useHabits } from "@/components/store";
import { Empty, Field, ScoreDial, Sheet } from "@/components/ui";
import { addDays, dow, prettyDate, todayISO } from "@/lib/dates";
import {
  CATEGORIES, dayScore, dayStreak, encouragement, habitStreak, isDone, scheduledOn,
} from "@/lib/habits";
import { useLocale, useT } from "@/lib/i18n/context";
import { prettyDateFor, shortDateFor } from "@/lib/i18n";
import type { AppState, Habit } from "@/lib/types";

/**
 * Logging how much, and how it went. The "Note" marker on a row used to have no
 * way of ever being set — this is what sets it. A completion row exists only
 * when the habit was done, so saving an entry marks it done.
 */
function LogSheet({
  habit, date, entry, onSave, onClose,
}: {
  habit: Habit; date: string;
  entry: { value?: number | null; note?: string } | undefined;
  onSave: (value: number | null, note: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState(entry?.value == null ? "" : String(entry.value));
  const [note, setNote] = useState(entry?.note ?? "");

  return (
    <Sheet
      open onClose={onClose} title={t.today.logTitle}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t.common.cancel}</button>
          <button className="btn btn-primary"
            onClick={() => { onSave(value === "" ? null : Number(value), note.trim()); onClose(); }}>
            {t.today.logSave}
          </button>
        </>
      }
    >
      <p className="muted mb-3" style={{ fontSize: 14 }}>{habit.name}</p>
      {habit.target != null && (
        <Field label={`${t.today.logValue}${habit.unit ? ` (${habit.unit})` : ""}`}>
          <input className="input num" type="number" inputMode="decimal" autoFocus
            placeholder={String(habit.target)} value={value}
            onChange={(e) => setValue(e.target.value)} />
        </Field>
      )}
      <Field label={t.today.logNote} hint={t.today.logNoteHint}>
        <textarea className="textarea" rows={3} value={note}
          autoFocus={habit.target == null}
          onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Sheet>
  );
}

function HabitRow({
  state, habit, date, onToggle, onOpen, onLog,
}: {
  state: AppState; habit: Habit; date: string;
  onToggle: (id: string) => void; onOpen: (h: Habit) => void; onLog: (h: Habit) => void;
}) {
  const t = useT();
  const done = isDone(state, date, habit.id);
  const streak = habitStreak(state, habit);
  const entry = state.completions[date]?.[habit.id];
  return (
    <div className="flex items-center gap-3 py-3">
      <button
        className="tick" data-on={done} onClick={() => onToggle(habit.id)} aria-pressed={done}
        aria-label={done ? t.today.uncheck(habit.name) : t.today.check(habit.name)}
      >
        {done && (
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M4.5 10.5l3.6 3.6L15.5 6.8" stroke="var(--accent-ink)" strokeWidth="2.4"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <button
        className="flex-1 text-left"
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
        onClick={() => onOpen(habit)}
      >
        <div style={{ fontSize: 15.5, fontWeight: 500, opacity: done ? 0.55 : 1, letterSpacing: "-0.01em" }}>
          {habit.type === "avoid" && <span className="faint" style={{ fontWeight: 400 }}>{t.today.avoid} · </span>}
          {habit.name}
        </div>
        <div className="faint flex items-center gap-2 mt-0.5" style={{ fontSize: 12 }}>
          {habit.target != null && <span className="num">{habit.target} {habit.unit}</span>}
          {streak > 0 && <span className="num">{t.today.daysRunning(streak)}</span>}
          {habit.weight === 3 && <span>{t.today.highPriority}</span>}
          {entry?.value != null && <span className="num">{entry.value}{habit.unit ? ` ${habit.unit}` : ""}</span>}
          {entry?.note && <span>{t.today.note}</span>}
        </div>
      </button>
      <button
        className="btn btn-quiet" style={{ padding: "4px 9px", flex: "none", fontSize: 15 }}
        onClick={() => onLog(habit)} aria-label={t.today.logOpen} title={t.today.logOpen}
      >
        ⋯
      </button>
    </div>
  );
}

export default function Today() {
  const { state, actions } = useHabits();
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [date, setDate] = useState(todayISO());
  const [logging, setLogging] = useState<Habit | null>(null);
  const isToday = date === todayISO();

  const score = dayScore(state, date);
  const list = scheduledOn(state, date);
  const segments = list.map((h) => ({
    weight: state.prefs.weighted ? h.weight || 1 : 1,
    done: isDone(state, date, h.id),
  }));

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="eyebrow">{isToday ? t.today.todayLabel : t.days.short[dow(date)]}</div>
            <h1 className="display" style={{ fontSize: 27, lineHeight: 1.15, marginTop: 2 }}>{prettyDateFor(date, locale)}</h1>
          </div>
          <div className="flex gap-1">
            <button className="btn btn-quiet" style={{ padding: "8px 12px" }}
              onClick={() => setDate(addDays(date, -1))} aria-label={t.common.previousDay}>‹</button>
            <button className="btn btn-quiet" style={{ padding: "8px 12px" }} disabled={isToday}
              onClick={() => setDate(addDays(date, 1))} aria-label={t.common.nextDay}>›</button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-5 mt-4">
          <ScoreDial score={score.pct} segments={segments.length ? segments : [{ weight: 1, done: false }]} />
          <div className="flex-1 w-full">
            <div className="grid grid-cols-3 gap-2">
              {CATEGORIES.map((c) => {
                const hs = list.filter((h) => h.category === c.id);
                const done = hs.filter((h) => isDone(state, date, h.id)).length;
                return (
                  <div key={c.id} className="flat p-3">
                    <div className="eyebrow" style={{ fontSize: 10 }}>{t.categories[c.id].label}</div>
                    <div className="num display mt-1" style={{ fontSize: 20 }}>
                      {done}<span className="faint">/{hs.length}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-3" style={{ fontSize: 13 }}>
              <span className="muted">{t.today.currentStreak} <b className="num" style={{ color: "var(--ink)" }}>{t.today.streakDays(dayStreak(state))}</b></span>
              <span className="muted">{t.today.done} <b className="num" style={{ color: "var(--ink)" }}>{score.done}/{score.total}</b></span>
            </div>
            <p className="mt-2.5 muted" style={{ fontSize: 14, lineHeight: 1.45 }}>
              {t.encouragement[encouragement(state, date, score)]}
            </p>
          </div>
        </div>
      </section>

      {list.length === 0 ? (
        <Empty title={t.today.nothingScheduled} body={t.today.nothingScheduledBody} />
      ) : (
        CATEGORIES.map((c) => {
          const hs = list.filter((h) => h.category === c.id);
          if (!hs.length) return null;
          return (
            <section key={c.id} className="card px-5 py-2">
              <div className="flex items-baseline justify-between pt-3 pb-1">
                <h2 className="display" style={{ fontSize: 20 }}>{t.categories[c.id].label}</h2>
                <span className="eyebrow">
                  {t.common.of(hs.filter((h) => isDone(state, date, h.id)).length, hs.length)}
                </span>
              </div>
              <div className="divide">
                {hs.map((h) => (
                  <HabitRow key={h.id} state={state} habit={h} date={date}
                    onToggle={(id) => actions.toggle(date, id)}
                    onOpen={(habit) => router.push(`/habits?edit=${habit.id}`)}
                    onLog={setLogging} />
                ))}
              </div>
              <div className="h-2" />
            </section>
          );
        })
      )}

      {logging && (
        <LogSheet
          habit={logging} date={date} entry={state.completions[date]?.[logging.id]}
          onSave={(value, note) => actions.logCompletion(date, logging.id, value, note)}
          onClose={() => setLogging(null)}
        />
      )}

      <section className="card p-5">
        <div className="eyebrow mb-2">{t.today.notesTitle}</div>
        <textarea
          className="textarea" rows={3}
          placeholder={t.today.notesPlaceholder}
          value={state.dayNotes[date] ?? ""}
          onChange={(e) => actions.setDayNote(date, e.target.value)}
        />
      </section>
    </div>
  );
}
