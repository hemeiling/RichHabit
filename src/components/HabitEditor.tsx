"use client";
import { useState } from "react";
import { Field, Segmented, Sheet } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { CATEGORIES, frequencyDefaults, scheduleProblem } from "@/lib/habits";
import { useT } from "@/lib/i18n/context";
import { rotationItemOn, rotationKeys, rotationStartFor } from "@/lib/rotation";
import { goalName, habitDescription, habitName, rotationLabel } from "@/lib/templates";
import { MAX_INTERVAL_DAYS, MAX_TIMES_PER_MONTH, isNumericTracking } from "@/lib/types";
import type { Category, FreqMode, Goal, Habit, HabitStatus, TrackingType } from "@/lib/types";

/**
 * The one habit editor. Today opens it to add or edit in place; My habits opens
 * the same component from its list. A second form would be a second set of
 * rules about what a habit may be, and they would drift.
 */
export default function HabitEditor({
  habit, goals, onSave, onDelete, onClose, isNew: isNewProp,
}: {
  habit: Habit; goals: Goal[];
  onSave: (h: Habit) => void; onDelete: (id: string) => void; onClose: () => void;
  /**
   * Whether this is a habit not yet saved. Defaults to "it has no name yet",
   * which holds for a blank form — but a template previewed before adding
   * arrives already named, and must still read as new (no Delete, "Add").
   */
  isNew?: boolean;
}) {
  const t = useT();
  const [h, setH] = useState<Habit>(habit);
  const set = <K extends keyof Habit>(k: K, v: Habit[K]) => setH((p) => ({ ...p, [k]: v }));
  const setFreq = <K extends keyof Habit["frequency"]>(k: K, v: Habit["frequency"][K]) =>
    setH((p) => ({ ...p, frequency: { ...p.frequency, [k]: v } }));
  // Each mode arrives with sensible settings; what was chosen before is kept.
  const chooseMode = (mode: FreqMode) =>
    setH((p) => ({ ...p, frequency: frequencyDefaults(p.frequency, mode, todayISO()) }));
  const isNew = isNewProp ?? !habit.name;
  const problem = scheduleProblem(h.frequency);
  const valid = h.name.trim().length > 0 && !problem;

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
      <Field label={t.habits.fieldFrequency} group>
        <Segmented<FreqMode> value={h.frequency.mode} onChange={chooseMode}
          options={[
            { value: "daily", label: t.habits.freqDaily },
            { value: "days", label: t.habits.freqDays },
            { value: "times", label: t.habits.freqTimes },
            { value: "every_n_days", label: t.habits.freqEvery },
            { value: "month_times", label: t.habits.freqMonthTimes },
            { value: "month_days", label: t.habits.freqMonthDays },
          ]} />
        {h.frequency.mode === "days" && (
          <div className="flex gap-1.5 mt-2.5">
            {t.days.initial.map((d, i) => (
              <button key={i} type="button" className="chip" data-on={h.frequency.days.includes(i)}
                aria-pressed={h.frequency.days.includes(i)} aria-label={t.days.short[i]}
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
            <input type="range" min={1} max={7} value={h.frequency.timesPerWeek} aria-label={t.habits.freqTimes}
              onChange={(e) => setFreq("timesPerWeek", Number(e.target.value))} style={{ flex: 1 }} />
            <span className="num" style={{ fontSize: 14 }}>{t.habits.perWeek(h.frequency.timesPerWeek)}</span>
          </div>
        )}
        {h.frequency.mode === "every_n_days" && (
          <div className="mt-2.5">
            <div className="flex items-center flex-wrap" style={{ gap: "8px 16px", fontSize: 14 }}>
              <label className="flex items-center gap-2">
                <span className="muted">{t.habits.intervalLabel}</span>
                <input className="input num" type="number" inputMode="numeric" min={2} max={MAX_INTERVAL_DAYS}
                  aria-label={t.habits.intervalAria}
                  value={h.frequency.intervalDays ?? ""} style={{ width: 80 }}
                  onChange={(e) => setFreq("intervalDays", e.target.value === "" ? undefined : Number(e.target.value))} />
                <span className="muted">{t.habits.intervalUnit}</span>
              </label>
              <label className="flex items-center gap-2">
                <span className="muted">{t.habits.anchorLabel}</span>
                <input className="input num" type="date" value={h.frequency.anchorDate ?? ""} style={{ width: "auto" }}
                  onChange={(e) => e.target.value && setFreq("anchorDate", e.target.value)} />
              </label>
            </div>
            <div className="faint mt-1.5" style={{ fontSize: 12 }}>{t.habits.everyHint}</div>
          </div>
        )}
        {h.frequency.mode === "month_times" && (
          <div className="mt-2.5">
            <div className="flex items-center gap-3">
              <input type="range" min={1} max={MAX_TIMES_PER_MONTH} value={h.frequency.timesPerMonth ?? 4}
                aria-label={t.habits.freqMonthTimes}
                onChange={(e) => setFreq("timesPerMonth", Number(e.target.value))} style={{ flex: 1 }} />
              <span className="num" style={{ fontSize: 14 }}>{t.habits.perMonth(h.frequency.timesPerMonth ?? 4)}</span>
            </div>
            <div className="faint mt-1.5" style={{ fontSize: 12 }}>{t.habits.monthTimesHint}</div>
          </div>
        )}
        {h.frequency.mode === "month_days" && (
          <div className="mt-2.5">
            <div className="grid grid-cols-7 gap-1.5" style={{ maxWidth: 320 }}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => {
                const on = (h.frequency.daysOfMonth ?? []).includes(d);
                return (
                  <button key={d} type="button" className="chip num" data-on={on} aria-pressed={on}
                    style={{ padding: "6px 0", textAlign: "center" }}
                    onClick={() => setFreq("daysOfMonth", on
                      ? (h.frequency.daysOfMonth ?? []).filter((x) => x !== d)
                      : [...(h.frequency.daysOfMonth ?? []), d].sort((a, b) => a - b))}>
                    {d}
                  </button>
                );
              })}
            </div>
            <div className="faint mt-1.5" style={{ fontSize: 12 }}>{t.habits.monthDaysHint}</div>
          </div>
        )}
        {problem && (
          <p role="alert" className="mt-1.5" style={{ color: "var(--warn)", fontSize: 12.5 }}>
            {t.habits.scheduleProblem[problem]}
          </p>
        )}
      </Field>
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
