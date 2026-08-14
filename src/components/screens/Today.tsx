"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useHabits } from "@/components/store";
import { Empty, ScoreDial } from "@/components/ui";
import { DAY_LABEL, addDays, dow, prettyDate, todayISO } from "@/lib/dates";
import {
  CATEGORIES, dayScore, dayStreak, encouragement, habitStreak, isDone, scheduledOn,
} from "@/lib/habits";
import type { AppState, Habit } from "@/lib/types";

function HabitRow({
  state, habit, date, onToggle, onOpen,
}: {
  state: AppState; habit: Habit; date: string;
  onToggle: (id: string) => void; onOpen: (h: Habit) => void;
}) {
  const done = isDone(state, date, habit.id);
  const streak = habitStreak(state, habit);
  const entry = state.completions[date]?.[habit.id];
  return (
    <div className="flex items-center gap-3 py-3">
      <button
        className="tick" data-on={done} onClick={() => onToggle(habit.id)} aria-pressed={done}
        aria-label={`${done ? "Uncheck" : "Check"} ${habit.name}`}
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
          {habit.type === "avoid" && <span className="faint" style={{ fontWeight: 400 }}>Avoid · </span>}
          {habit.name}
        </div>
        <div className="faint flex items-center gap-2 mt-0.5" style={{ fontSize: 12 }}>
          {habit.target != null && <span className="num">{habit.target} {habit.unit}</span>}
          {streak > 0 && <span className="num">{streak} day{streak === 1 ? "" : "s"} running</span>}
          {habit.weight === 3 && <span>High priority</span>}
          {entry?.note && <span>Note</span>}
        </div>
      </button>
    </div>
  );
}

export default function Today() {
  const { state, actions } = useHabits();
  const router = useRouter();
  const [date, setDate] = useState(todayISO());
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
            <div className="eyebrow">{isToday ? "Today" : DAY_LABEL[dow(date)]}</div>
            <h1 className="display" style={{ fontSize: 27, lineHeight: 1.15, marginTop: 2 }}>{prettyDate(date)}</h1>
          </div>
          <div className="flex gap-1">
            <button className="btn btn-quiet" style={{ padding: "8px 12px" }}
              onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</button>
            <button className="btn btn-quiet" style={{ padding: "8px 12px" }} disabled={isToday}
              onClick={() => setDate(addDays(date, 1))} aria-label="Next day">›</button>
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
                    <div className="eyebrow" style={{ fontSize: 10 }}>{c.label}</div>
                    <div className="num display mt-1" style={{ fontSize: 20 }}>
                      {done}<span className="faint">/{hs.length}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-3" style={{ fontSize: 13 }}>
              <span className="muted">Current streak <b className="num" style={{ color: "var(--ink)" }}>{dayStreak(state)}d</b></span>
              <span className="muted">Done <b className="num" style={{ color: "var(--ink)" }}>{score.done}/{score.total}</b></span>
            </div>
            <p className="mt-2.5 muted" style={{ fontSize: 14, lineHeight: 1.45 }}>
              {encouragement(state, date, score)}
            </p>
          </div>
        </div>
      </section>

      {list.length === 0 ? (
        <Empty title="Nothing scheduled" body="Add a habit or change a schedule to see it here." />
      ) : (
        CATEGORIES.map((c) => {
          const hs = list.filter((h) => h.category === c.id);
          if (!hs.length) return null;
          return (
            <section key={c.id} className="card px-5 py-2">
              <div className="flex items-baseline justify-between pt-3 pb-1">
                <h2 className="display" style={{ fontSize: 20 }}>{c.label}</h2>
                <span className="eyebrow">
                  {hs.filter((h) => isDone(state, date, h.id)).length} of {hs.length}
                </span>
              </div>
              <div className="divide">
                {hs.map((h) => (
                  <HabitRow key={h.id} state={state} habit={h} date={date}
                    onToggle={(id) => actions.toggle(date, id)}
                    onOpen={(habit) => router.push(`/habits?edit=${habit.id}`)} />
                ))}
              </div>
              <div className="h-2" />
            </section>
          );
        })
      )}

      <section className="card p-5">
        <div className="eyebrow mb-2">Notes for this day</div>
        <textarea
          className="textarea" rows={3}
          placeholder="What shaped the day? Anything worth remembering."
          value={state.dayNotes[date] ?? ""}
          onChange={(e) => actions.setDayNote(date, e.target.value)}
        />
      </section>
    </div>
  );
}
