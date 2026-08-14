"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useHabits } from "@/components/store";
import { Empty, Field, Segmented, Sheet } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { CATEGORIES, blankHabit, habitStats } from "@/lib/habits";
import { useT } from "@/lib/i18n/context";
import { goalName, habitName, habitUnit } from "@/lib/templates";
import type { Category, Goal, Habit, HabitStatus } from "@/lib/types";

function HabitEditor({
  habit, goals, onSave, onDelete, onClose,
}: {
  habit: Habit; goals: Goal[];
  onSave: (h: Habit) => void; onDelete: (id: string) => void; onClose: () => void;
}) {
  const t = useT();
  const [h, setH] = useState<Habit>(habit);
  const set = <K extends keyof Habit>(k: K, v: Habit[K]) => setH((p) => ({ ...p, [k]: v }));
  const setFreq = <K extends keyof Habit["frequency"]>(k: K, v: Habit["frequency"][K]) =>
    setH((p) => ({ ...p, frequency: { ...p.frequency, [k]: v } }));
  const isNew = !habit.name;
  const valid = h.name.trim().length > 0;

  return (
    <Sheet
      open onClose={onClose} title={isNew ? t.habits.newHabit : t.habits.editHabit}
      footer={
        <>
          {!isNew && <button className="btn btn-danger mr-auto" onClick={() => onDelete(h.id)}>{t.common.delete}</button>}
          <button className="btn" onClick={onClose}>{t.common.cancel}</button>
          <button className="btn btn-primary" disabled={!valid} onClick={() => onSave({ ...h, name: h.name.trim() })}>
            {isNew ? t.habits.addHabit : t.habits.saveChanges}
          </button>
        </>
      }
    >
      <Field label={t.habits.fieldHabit}>
        {/* A seeded habit opens showing its translated name. Editing it makes the
            text the user's own: the template key is dropped and it stops
            following the language. */}
        <input className="input" autoFocus value={h.name}
          onChange={(e) => setH((p) => ({ ...p, name: e.target.value, templateKey: null }))}
          placeholder={t.habits.habitPlaceholder} />
      </Field>
      <Field label={t.habits.fieldDescription} hint={t.habits.descriptionHint}>
        <input className="input" value={h.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder={t.habits.descriptionPlaceholder} />
      </Field>
      <Field label={t.habits.fieldTimeOfDay}>
        <Segmented<Category> value={h.category} onChange={(v) => set("category", v)}
          options={CATEGORIES.map((c) => ({ value: c.id, label: t.categories[c.id].label }))} />
      </Field>
      <Field label={t.habits.fieldKind}>
        <Segmented value={h.type} onChange={(v) => set("type", v)}
          options={[{ value: "good" as const, label: t.habits.kindBuild }, { value: "avoid" as const, label: t.habits.kindDrop }]} />
      </Field>
      <Field label={t.habits.fieldFrequency}>
        <Segmented value={h.frequency.mode} onChange={(v) => setFreq("mode", v)}
          options={[
            { value: "daily" as const, label: t.habits.freqDaily },
            { value: "days" as const, label: t.habits.freqDays },
            { value: "times" as const, label: t.habits.freqTimes },
          ]} />
        {h.frequency.mode === "days" && (
          <div className="flex gap-1.5 mt-2.5">
            {t.days.initial.map((d, i) => (
              <button key={i} type="button" className="chip" data-on={h.frequency.days.includes(i)}
                style={{ width: 38, padding: "7px 0", textAlign: "center" }}
                onClick={() => setFreq("days", h.frequency.days.includes(i)
                  ? h.frequency.days.filter((x) => x !== i)
                  : [...h.frequency.days, i])}>
                {d}
              </button>
            ))}
          </div>
        )}
        {h.frequency.mode === "times" && (
          <div className="flex items-center gap-3 mt-2.5">
            <input type="range" min={1} max={7} value={h.frequency.timesPerWeek}
              onChange={(e) => setFreq("timesPerWeek", Number(e.target.value))} style={{ flex: 1 }} />
            <span className="num" style={{ fontSize: 14 }}>{t.habits.perWeek(h.frequency.timesPerWeek)}</span>
          </div>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.habits.fieldTarget} hint={t.common.optional}>
          <input className="input num" type="number" min={0} value={h.target ?? ""}
            onChange={(e) => set("target", e.target.value === "" ? null : Number(e.target.value))} placeholder="30" />
        </Field>
        <Field label={t.habits.fieldUnit}>
          <input className="input" value={h.unit}
            onChange={(e) => setH((p) => ({ ...p, unit: e.target.value, templateKey: null }))}
            placeholder={t.habits.unitPlaceholder} />
        </Field>
      </div>
      <Field label={t.habits.fieldPriority} hint={t.habits.priorityHint}>
        <Segmented<1 | 2 | 3> value={h.weight} onChange={(v) => set("weight", v)}
          options={[{ value: 1, label: t.priority.low }, { value: 2, label: t.priority.medium }, { value: 3, label: t.priority.high }]} />
      </Field>
      <Field label={t.habits.fieldGoal}>
        <select className="select" value={h.goalId ?? ""}
          onChange={(e) => set("goalId", e.target.value || null)}>
          <option value="">{t.habits.noGoal}</option>
          {goals.map((g) => <option key={g.id} value={g.id}>{goalName(g, t)}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.habits.fieldStartDate}>
          <input className="input num" type="date" value={h.startDate} max={todayISO()}
            onChange={(e) => e.target.value && set("startDate", e.target.value)} />
        </Field>
        <Field label={t.habits.fieldStatus} hint={t.habits.statusHint}>
          {/* §14. Only "active" reaches Today and the score; the rest keep the
              habit and its history without it being on the sheet. */}
          <Segmented<HabitStatus> value={h.status}
            onChange={(v) => setH((p) => ({ ...p, status: v, active: v === "active" }))}
            options={[
              { value: "active", label: t.habits.statusActive },
              { value: "paused", label: t.habits.statusPaused },
              { value: "established", label: t.habits.statusEstablished },
              { value: "retired", label: t.habits.statusRetired },
            ]} />
        </Field>
      </div>
    </Sheet>
  );
}

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
