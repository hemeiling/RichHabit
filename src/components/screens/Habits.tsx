"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useHabits } from "@/components/store";
import { Empty, Field, Segmented, Sheet } from "@/components/ui";
import { DAY_INITIAL, DAY_LABEL, todayISO } from "@/lib/dates";
import { CATEGORIES, blankHabit, habitStats } from "@/lib/habits";
import type { Category, Goal, Habit } from "@/lib/types";

function HabitEditor({
  habit, goals, onSave, onDelete, onClose,
}: {
  habit: Habit; goals: Goal[];
  onSave: (h: Habit) => void; onDelete: (id: string) => void; onClose: () => void;
}) {
  const [h, setH] = useState<Habit>(habit);
  const set = <K extends keyof Habit>(k: K, v: Habit[K]) => setH((p) => ({ ...p, [k]: v }));
  const setFreq = <K extends keyof Habit["frequency"]>(k: K, v: Habit["frequency"][K]) =>
    setH((p) => ({ ...p, frequency: { ...p.frequency, [k]: v } }));
  const isNew = !habit.name;
  const valid = h.name.trim().length > 0;

  return (
    <Sheet
      open onClose={onClose} title={isNew ? "New habit" : "Edit habit"}
      footer={
        <>
          {!isNew && <button className="btn btn-danger mr-auto" onClick={() => onDelete(h.id)}>Delete</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!valid} onClick={() => onSave({ ...h, name: h.name.trim() })}>
            {isNew ? "Add habit" : "Save changes"}
          </button>
        </>
      }
    >
      <Field label="Habit">
        <input className="input" autoFocus value={h.name}
          onChange={(e) => set("name", e.target.value)} placeholder="Read for learning" />
      </Field>
      <Field label="Description" hint="Optional — what counts as done?">
        <input className="input" value={h.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Non-fiction, anything that teaches me something" />
      </Field>
      <Field label="Time of day">
        <Segmented<Category> value={h.category} onChange={(v) => set("category", v)}
          options={CATEGORIES.map((c) => ({ value: c.id, label: c.label }))} />
      </Field>
      <Field label="Kind">
        <Segmented value={h.type} onChange={(v) => set("type", v)}
          options={[{ value: "good" as const, label: "Habit to build" }, { value: "avoid" as const, label: "Habit to drop" }]} />
      </Field>
      <Field label="Frequency">
        <Segmented value={h.frequency.mode} onChange={(v) => setFreq("mode", v)}
          options={[
            { value: "daily" as const, label: "Every day" },
            { value: "days" as const, label: "Certain days" },
            { value: "times" as const, label: "X times a week" },
          ]} />
        {h.frequency.mode === "days" && (
          <div className="flex gap-1.5 mt-2.5">
            {DAY_INITIAL.map((d, i) => (
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
            <span className="num" style={{ fontSize: 14 }}>{h.frequency.timesPerWeek} / week</span>
          </div>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Target" hint="Optional">
          <input className="input num" type="number" min={0} value={h.target ?? ""}
            onChange={(e) => set("target", e.target.value === "" ? null : Number(e.target.value))} placeholder="30" />
        </Field>
        <Field label="Unit">
          <input className="input" value={h.unit} onChange={(e) => set("unit", e.target.value)} placeholder="min" />
        </Field>
      </div>
      <Field label="Priority" hint="Higher priority habits count for more in your score.">
        <Segmented<1 | 2 | 3> value={h.weight} onChange={(v) => set("weight", v)}
          options={[{ value: 1, label: "Low" }, { value: 2, label: "Medium" }, { value: 3, label: "High" }]} />
      </Field>
      <Field label="Goal it supports">
        <select className="select" value={h.goalId ?? ""}
          onChange={(e) => set("goalId", e.target.value || null)}>
          <option value="">Not linked to a goal</option>
          {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date">
          <input className="input num" type="date" value={h.startDate} max={todayISO()}
            onChange={(e) => e.target.value && set("startDate", e.target.value)} />
        </Field>
        <Field label="Status">
          <Segmented<boolean> value={h.active} onChange={(v) => set("active", v)}
            options={[{ value: true, label: "Active" }, { value: false, label: "Paused" }]} />
        </Field>
      </div>
    </Sheet>
  );
}

export default function Habits() {
  const { state, actions } = useHabits();
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

  const shown = state.habits.filter((h) => filter === "all" || h.category === filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Segmented<Category | "all"> value={filter} onChange={setFilter} small
          options={[{ value: "all", label: "All" }, ...CATEGORIES.map((c) => ({ value: c.id, label: c.label }))]} />
        <button className="btn btn-primary" style={{ flex: "none" }} onClick={() => setEditing(blankHabit())}>New</button>
      </div>

      {shown.length === 0 ? (
        <Empty
          title="No habits here yet"
          body="Start with one or two. Changing everything at once is why most attempts don't hold."
          action={<button className="btn btn-primary" onClick={() => setEditing(blankHabit())}>Add your first habit</button>}
        />
      ) : (
        CATEGORIES.filter((c) => shown.some((h) => h.category === c.id)).map((c) => (
          <section key={c.id} className="card px-5 py-2">
            <div className="flex items-baseline justify-between pt-3 pb-1">
              <h2 className="display" style={{ fontSize: 20 }}>{c.label}</h2>
              <span className="eyebrow">{c.note}</span>
            </div>
            <div className="divide">
              {shown.filter((h) => h.category === c.id).map((h) => {
                const st = habitStats(state, h, 30);
                const goal = state.goals.find((g) => g.id === h.goalId);
                const freq = h.frequency.mode === "daily"
                  ? "Every day"
                  : h.frequency.mode === "days"
                    ? h.frequency.days.map((d) => DAY_LABEL[d].slice(0, 2)).join(" ")
                    : `${h.frequency.timesPerWeek}× a week`;
                return (
                  <button key={h.id} onClick={() => setEditing(h)} className="w-full text-left py-3.5"
                    style={{ background: "none", border: "none", cursor: "pointer", opacity: h.active ? 1 : 0.5 }}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span style={{ fontSize: 15.5, fontWeight: 500 }}>
                        {h.type === "avoid" && <span className="faint" style={{ fontWeight: 400 }}>Avoid · </span>}
                        {h.name}
                      </span>
                      <span className="num muted" style={{ fontSize: 13, flex: "none" }}>
                        {st.pct == null ? "—" : `${st.pct}%`}
                      </span>
                    </div>
                    {h.description && <div className="muted mt-0.5" style={{ fontSize: 13 }}>{h.description}</div>}
                    <div className="faint flex flex-wrap gap-x-3 mt-1" style={{ fontSize: 12 }}>
                      <span>{freq}</span>
                      {h.target != null && <span className="num">{h.target} {h.unit}</span>}
                      <span>{["Low", "Medium", "High"][h.weight - 1]} priority</span>
                      {goal && <span>→ {goal.name}</span>}
                      {!h.active && <span>Paused</span>}
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
