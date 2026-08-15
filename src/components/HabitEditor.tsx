"use client";
import { useState } from "react";
import { Field, Segmented, Sheet } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { CATEGORIES } from "@/lib/habits";
import { useT } from "@/lib/i18n/context";
import { goalName } from "@/lib/templates";
import { isNumericTracking } from "@/lib/types";
import type { Category, Goal, Habit, HabitStatus, TrackingType } from "@/lib/types";

/**
 * The one habit editor. Today opens it to add or edit in place; My habits opens
 * the same component from its list. A second form would be a second set of
 * rules about what a habit may be, and they would drift.
 */
export default function HabitEditor({
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
      {/* §12. How it is measured decides what Today shows and what counts. */}
      <Field label={t.habits.fieldTracking}>
        <Segmented<TrackingType> value={h.tracking} onChange={(v) => set("tracking", v)} small
          options={[
            { value: "boolean", label: t.habits.trackingBoolean },
            { value: "count", label: t.habits.trackingCount },
            { value: "duration", label: t.habits.trackingDuration },
            { value: "quantity", label: t.habits.trackingQuantity },
            { value: "interval", label: t.habits.trackingInterval },
            { value: "maximum", label: t.habits.trackingMaximum },
            { value: "avoidance", label: t.habits.trackingAvoidance },
          ]} />
      </Field>

      {/* §20. Only meaningful once a number is involved. */}
      {isNumericTracking(h.tracking) && (
        <Field label={t.habits.fieldMinimum} hint={t.habits.minimumHint}>
          <input className="input num" type="number" min={0} value={h.minimum ?? ""}
            onChange={(e) => set("minimum", e.target.value === "" ? null : Number(e.target.value))}
            placeholder="—" />
        </Field>
      )}

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
      {/* §11/§22. The arrangements that make a habit actually happen. */}
      <div className="eyebrow mt-4 mb-2">{t.habits.designTitle}</div>
      <Field label={t.habits.fieldAnchor} hint={t.habits.anchorHint}>
        <input className="input" value={h.anchor}
          onChange={(e) => set("anchor", e.target.value)}
          placeholder={t.habits.anchorPlaceholder} />
      </Field>
      <Field label={t.habits.fieldEnvironment}>
        <input className="input" value={h.environment}
          onChange={(e) => set("environment", e.target.value)}
          placeholder={t.habits.environmentPlaceholder} />
      </Field>
      <Field label={t.habits.fieldFriction}>
        <input className="input" value={h.friction}
          onChange={(e) => set("friction", e.target.value)}
          placeholder={t.habits.frictionPlaceholder} />
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
