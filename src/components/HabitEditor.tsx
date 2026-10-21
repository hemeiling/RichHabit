"use client";
import { useState } from "react";
import FrequencyField from "@/components/FrequencyField";
import HabitReminderField from "@/components/HabitReminderField";
import { Field, Segmented, Sheet } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { CATEGORIES, scheduleProblem } from "@/lib/habits";
import { useT } from "@/lib/i18n/context";
import { rotationItemOn, rotationKeys, rotationStartFor } from "@/lib/rotation";
import { goalName, habitDescription, habitName, habitSource, rotationLabel } from "@/lib/templates";
import { isNumericTracking } from "@/lib/types";
import type { Category, Goal, Habit, HabitStatus, TrackingType } from "@/lib/types";

/**
 * The one habit editor. Today opens it to add or edit in place; My habits opens
 * the same component from its list. A second form would be a second set of
 * rules about what a habit may be, and they would drift.
 */
export default function HabitEditor({
  habit, goals, onSave, onDelete, onClose, isNew: isNewProp, submitLabel,
}: {
  habit: Habit; goals: Goal[];
  onSave: (h: Habit) => void; onDelete: (id: string) => void; onClose: () => void;
  /**
   * Whether this is a habit not yet saved. Defaults to "it has no name yet",
   * which holds for a blank form — but a template previewed before adding
   * arrives already named, and must still read as new (no Delete, "Add").
   */
  isNew?: boolean;
  /** The save button's words, when saving here only hands the habit back (the template review). */
  submitLabel?: string;
}) {
  const t = useT();
  const [h, setH] = useState<Habit>(habit);
  const set = <K extends keyof Habit>(k: K, v: Habit[K]) => setH((p) => ({ ...p, [k]: v }));
  const isNew = isNewProp ?? !habit.name;
  const problem = scheduleProblem(h.frequency);
  const valid = h.name.trim().length > 0 && !problem;
  // A template's citation stays visible on the copy, for reference only.
  const source = habitSource(h.templateKey, t);

  return (
    <Sheet
      open onClose={onClose} title={isNew ? t.habits.newHabit : t.habits.editHabit}
      footer={
        <>
          {!isNew && <button className="btn btn-danger mr-auto" onClick={() => onDelete(h.id)}>{t.common.delete}</button>}
          <button className="btn" onClick={onClose}>{t.common.cancel}</button>
          <button className="btn btn-primary" disabled={!valid} onClick={() => onSave({ ...h, name: h.name.trim() })}>
            {submitLabel ?? (isNew ? t.habits.addHabit : t.habits.saveChanges)}
          </button>
        </>
      }
    >
      <Field label={t.habits.fieldHabit}>
        {/* A seeded habit opens showing its translated name. Editing it makes the
            text the user's own: the template key is dropped and it stops
            following the language. */}
        <input className="input" autoFocus value={habitName(h, t)}
          onChange={(e) => setH((p) => ({ ...p, name: e.target.value, templateKey: null }))}
          placeholder={t.habits.habitPlaceholder} />
      </Field>
      <Field label={t.habits.fieldDescription} hint={t.habits.descriptionHint}>
        {/* Same rule as the name: a template's own description reads in the
            reader's language until they change it; then it is theirs. */}
        <input className="input" value={habitDescription(h, t)}
          onChange={(e) => set("description", e.target.value)}
          placeholder={t.habits.descriptionPlaceholder} />
      </Field>
      {source && (
        <p className="faint -mt-1.5 mb-3" style={{ fontSize: 12 }}>{t.customise.sourcePrefix}{source}</p>
      )}
      {/* HT-2c. A rotating habit says which item this week is and how the cycle
          works. The start is chosen once, when it is added, and then fixed so
          every past week keeps its virtue. */}
      {h.rotation && h.rotationStart && (
        <div className="flat p-3 mb-3" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 500 }}>{rotationLabel(h, t, todayISO())}</div>
          <p className="muted mt-1">{t.habits.rotationExplain}</p>
          {isNew && (
            <label className="flex items-center flex-wrap gap-2 mt-2">
              <span className="muted">{t.habits.rotationStartWith}</span>
              <select className="select" style={{ width: "auto" }}
                value={rotationItemOn(h.rotation, h.rotationStart, todayISO()).index}
                onChange={(e) => set("rotationStart", rotationStartFor(todayISO(), Number(e.target.value)))}>
                {rotationKeys(h.rotation).map((k, i) => (
                  <option key={k} value={i}>{t.templates.habits[k] ?? k}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      <Field label={t.habits.fieldTimeOfDay} group>
        <Segmented<Category> value={h.category} onChange={(v) => set("category", v)}
          options={CATEGORIES.map((c) => ({ value: c.id, label: t.categories[c.id].label }))} />
      </Field>
      <Field label={t.habits.fieldKind} group>
        <Segmented value={h.type} onChange={(v) => set("type", v)}
          options={[{ value: "good" as const, label: t.habits.kindBuild }, { value: "avoid" as const, label: t.habits.kindDrop }]} />
      </Field>
      <FrequencyField frequency={h.frequency} onChange={(f) => set("frequency", f)} />
      <HabitReminderField habitId={h.id} category={h.category} isNew={isNew} />
      {/* §12. How it is measured decides what Today shows and what counts. */}
      <Field label={t.habits.fieldTracking} group>
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
          {/* The unit becomes the user's own, but the NAME is untouched, so
              the key — and with it the name's translation — stays. A custom
              unit simply isn't in templates.units and shows as typed. */}
          <input className="input" value={h.unit}
            onChange={(e) => set("unit", e.target.value)}
            placeholder={t.habits.unitPlaceholder} />
        </Field>
      </div>
      <Field label={t.habits.fieldPriority} hint={t.habits.priorityHint} group>
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
        <Field label={t.habits.fieldStatus} hint={t.habits.statusHint} group>
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
