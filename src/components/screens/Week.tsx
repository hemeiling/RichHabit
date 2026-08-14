"use client";
import { useState } from "react";
import { useHabits } from "@/components/store";
import { Check, Segmented } from "@/components/ui";
import { addDays, daysBetween, dow, shortDate, todayISO, weekStart } from "@/lib/dates";
import { CATEGORIES, isDone, isScheduled, weekSummary } from "@/lib/habits";
import { useLocale, useT } from "@/lib/i18n/context";
import { prettyDateFor, shortDateFor } from "@/lib/i18n";
import type { AppState, Category } from "@/lib/types";

function WeekGrid({
  state, category, weekOf, onToggle,
}: {
  state: AppState; category: Category; weekOf: string;
  onToggle: (habitId: string, date: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekOf, i));
  const habits = state.habits.filter((h) => h.category === category && h.active);
  const today = todayISO();

  if (!habits.length) {
    return <p className="muted p-4" style={{ fontSize: 14 }}>{t.week.noHabitsInPhase}</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 340 }}>
        <thead>
          <tr>
            <th className="eyebrow" style={{ textAlign: "left", paddingBottom: 8 }}>{t.week.habitColumn}</th>
            {days.map((d) => (
              <th key={d} className="eyebrow" style={{
                width: 34, paddingBottom: 8, fontWeight: 500,
                color: d === today ? "var(--ink)" : undefined,
              }}>
                {t.days.initial[dow(d)]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {habits.map((h) => (
            <tr key={h.id}>
              <td style={{ padding: "7px 8px 7px 0", fontSize: 14, borderTop: "1px solid var(--line-soft)" }}>
                {h.name}
              </td>
              {days.map((d) => {
                const future = daysBetween(d, today) < 0;
                const scheduled = isScheduled(state, h, d) || isDone(state, d, h.id);
                const done = isDone(state, d, h.id);
                return (
                  <td key={d} style={{ textAlign: "center", borderTop: "1px solid var(--line-soft)", padding: "5px 0" }}>
                    <button
                      onClick={() => onToggle(h.id, d)} disabled={future}
                      aria-label={t.week.cellLabel(h.name, shortDateFor(d, locale))} aria-pressed={done}
                      style={{
                        width: 24, height: 24, borderRadius: 7, cursor: future ? "default" : "pointer",
                        border: `1.5px solid ${done ? "var(--accent)" : "var(--line)"}`,
                        background: done ? "var(--accent)" : "transparent",
                        opacity: future ? 0.35 : scheduled ? 1 : 0.45,
                        display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0,
                      }}
                    >
                      {done && <Check />}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Week() {
  const { state, actions } = useHabits();
  const t = useT();
  const locale = useLocale();
  const [weekOf, setWeekOf] = useState(weekStart(todayISO()));
  const [phase, setPhase] = useState<Category>("morning");
  const summary = weekSummary(state, weekOf, phase);
  const overall = weekSummary(state, weekOf, null);
  const isThisWeek = weekOf === weekStart(todayISO());

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="eyebrow">{t.week.checklist}</div>
            <h1 className="display" style={{ fontSize: 22, marginTop: 2 }}>
              {shortDateFor(weekOf, locale)} – {shortDateFor(addDays(weekOf, 6), locale)}
            </h1>
          </div>
          <div className="flex gap-1">
            <button className="btn btn-quiet" style={{ padding: "8px 12px" }}
              onClick={() => setWeekOf(addDays(weekOf, -7))} aria-label={t.common.previousWeek}>‹</button>
            <button className="btn btn-quiet" style={{ padding: "8px 12px" }} disabled={isThisWeek}
              onClick={() => setWeekOf(addDays(weekOf, 7))} aria-label={t.common.nextWeek}>›</button>
          </div>
        </div>
        <p className="muted mt-2" style={{ fontSize: 14, lineHeight: 1.5 }}>
          {t.week.intro}
        </p>
        <div className="mt-3">
          <Segmented<Category> value={phase} onChange={setPhase} small
            options={CATEGORIES.map((c, i) => ({ value: c.id, label: `${i + 1}. ${t.categories[c.id].label}` }))} />
        </div>
      </section>

      <section className="card p-5">
        <WeekGrid state={state} category={phase} weekOf={weekOf}
          onToggle={(habitId, date) => actions.toggle(date, habitId)} />
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-3">{t.week.phaseResult(phase)}</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flat p-3.5">
            <div className="eyebrow" style={{ fontSize: 10 }}>{t.week.completion}</div>
            <div className="display num mt-1" style={{ fontSize: 30 }}>
              {summary.pct == null ? "—" : `${summary.pct}%`}
            </div>
            <div className="faint num" style={{ fontSize: 12 }}>{t.week.scheduledOf(summary.done, summary.scheduled)}</div>
          </div>
          <div className="flat p-3.5">
            <div className="eyebrow" style={{ fontSize: 10 }}>{t.week.longestStreak}</div>
            <div className="display num mt-1" style={{ fontSize: 30 }}>{summary.longest}</div>
            <div className="faint" style={{ fontSize: 12 }}>{t.week.daysInARow}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2" style={{ fontSize: 14 }}>
          <div className="flex justify-between">
            <span className="muted">{t.week.strongest}</span>
            <span>{summary.best ? `${summary.best.habit.name} · ${summary.best.pct}%` : "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="muted">{t.week.weakest}</span>
            <span>{summary.worst ? `${summary.worst.habit.name} · ${summary.worst.pct}%` : "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="muted">{t.week.allPhases}</span>
            <span className="num">{overall.pct == null ? "—" : `${overall.pct}%`}</span>
          </div>
        </div>
        {summary.worst && (
          <div className="flat p-3.5 mt-3">
            <div className="eyebrow" style={{ fontSize: 10 }}>{t.week.focusNext}</div>
            <p className="mt-1" style={{ fontSize: 14, lineHeight: 1.45 }}>
              {(summary.pct ?? 0) >= 80
                ? t.week.holdingAt(phase, summary.pct ?? 0)
                : t.week.keepSteady(summary.worst.habit.name)}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
