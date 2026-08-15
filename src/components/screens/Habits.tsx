"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useHabits } from "@/components/store";
import HabitEditor from "@/components/HabitEditor";
import { Empty, Segmented } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { CATEGORIES, blankHabit, habitStats } from "@/lib/habits";
import { useT } from "@/lib/i18n/context";
import { goalName, habitName, habitUnit } from "@/lib/templates";
import { isNumericTracking } from "@/lib/types";
import type { Category, Goal, Habit, HabitStatus, TrackingType } from "@/lib/types";

export default function Habits() {
  const { state, actions } = useHabits();
  const t = useT();
  const params = useSearchParams();
  const preselect = params.get("edit");
  const fromActivity = params.get("from");
  const [filter, setFilter] = useState<Category | "all">("all");
  const [editing, setEditing] = useState<Habit | null>(() => {
    const existing = state.habits.find((h) => h.id === preselect);
    if (existing) return existing;
    // Arriving from an awareness entry: start a new habit with the activity filled in.
    if (fromActivity) return { ...blankHabit(), name: fromActivity };
    return null;
  });

  // The backlog lives in "Refine my habits". This screen is the sheet: habits
  // the user has actually chosen, in whatever state they are now.
  const onSheet = state.habits.filter(
    (h) => !["candidate", "recommended", "planned"].includes(h.status));
  const shown = onSheet.filter((h) => filter === "all" || h.category === filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Segmented<Category | "all"> value={filter} onChange={setFilter} small
          options={[{ value: "all", label: t.habits.all }, ...CATEGORIES.map((c) => ({ value: c.id, label: t.categories[c.id].label }))]} />
        <button className="btn btn-primary" style={{ flex: "none" }} onClick={() => setEditing(blankHabit())}>{t.common.new}</button>
      </div>

      {shown.length === 0 ? (
        <Empty
          title={t.habits.noneTitle}
          body={t.habits.noneBody}
          action={<button className="btn btn-primary" onClick={() => setEditing(blankHabit())}>{t.habits.addFirst}</button>}
        />
      ) : (
        CATEGORIES.filter((c) => shown.some((h) => h.category === c.id)).map((c) => (
          <section key={c.id} className="card px-5 py-2">
            <div className="flex items-baseline justify-between pt-3 pb-1">
              <h2 className="display" style={{ fontSize: 20 }}>{t.categories[c.id].label}</h2>
              <span className="eyebrow">{t.categories[c.id].note}</span>
            </div>
            <div className="divide">
              {shown.filter((h) => h.category === c.id).map((h) => {
                const st = habitStats(state, h, 30);
                const goal = state.goals.find((g) => g.id === h.goalId);
                const freq = h.frequency.mode === "daily"
                  ? t.habits.freqDaily
                  : h.frequency.mode === "days"
                    ? h.frequency.days.map((d) => t.days.initial[d]).join(" ")
                    : t.habits.timesAWeek(h.frequency.timesPerWeek);
                return (
                  <button key={h.id} onClick={() => setEditing({ ...h, name: habitName(h, t), unit: habitUnit(h, t) })} className="w-full text-left py-3.5"
                    style={{ background: "none", border: "none", cursor: "pointer", opacity: h.active ? 1 : 0.5 }}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span style={{ fontSize: 15.5, fontWeight: 500 }}>
                        {h.type === "avoid" && <span className="faint" style={{ fontWeight: 400 }}>{t.today.avoid} · </span>}
                        {habitName(h, t)}
                      </span>
                      <span className="num muted" style={{ fontSize: 13, flex: "none" }}>
                        {st.pct == null ? "—" : `${st.pct}%`}
                      </span>
                    </div>
                    {h.description && <div className="muted mt-0.5" style={{ fontSize: 13 }}>{h.description}</div>}
                    <div className="faint flex flex-wrap gap-x-3 mt-1" style={{ fontSize: 12 }}>
                      <span>{freq}</span>
                      {h.target != null && <span className="num">{h.target} {habitUnit(h, t)}</span>}
                      <span>{[t.habits.priorityFull.low, t.habits.priorityFull.medium, t.habits.priorityFull.high][h.weight - 1]}</span>
                      {goal && <span>→ {goalName(goal, t)}</span>}
                      {h.status !== "active" && <span>{t.habits[`status${h.status[0].toUpperCase()}${h.status.slice(1)}` as "statusPaused"]}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="h-2" />
          </section>
        ))
      )}

      {editing && (
        <HabitEditor
          habit={editing} goals={state.goals}
          onSave={(h) => { actions.saveHabit(h); setEditing(null); }}
          onDelete={(id) => { actions.deleteHabit(id); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
