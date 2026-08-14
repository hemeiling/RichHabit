"use client";
import { useState } from "react";
import { useHabits } from "@/components/store";
import { Empty, Field, Segmented } from "@/components/ui";
import { useT } from "@/lib/i18n/context";
import { blankHabit } from "@/lib/habits";
import { habitName } from "@/lib/templates";
import type { Category, Habit, HabitKind } from "@/lib/types";

/**
 * Behaviours the user wants to change (reference §5), and the backlog they wait
 * in (§14).
 *
 * Three rules from CLAUDE.md §8 shape this screen:
 *
 *   - **Their wording is preserved.** What they type is stored verbatim, with no
 *     template key, so it is never translated or rephrased.
 *   - **Nothing becomes active without approval.** Everything captured here is a
 *     `candidate`: it is not on Today, not in the score, and not in My Habits
 *     until the user puts it on the sheet.
 *   - **A behaviour is not yet a habit.** "I sit for hours" is an observation.
 *     Turning it into something trackable is a separate, deliberate step.
 */

const BACKLOG_STATUSES = ["candidate", "recommended", "planned"] as const;

export default function Refine() {
  const { state, actions } = useHabits();
  const t = useT();

  const [text, setText] = useState("");
  const [kind, setKind] = useState<HabitKind>("avoid");
  const [weight, setWeight] = useState<1 | 2 | 3>(2);
  const [category, setCategory] = useState<Category>("daytime");

  const backlog = state.habits.filter((h) =>
    (BACKLOG_STATUSES as readonly string[]).includes(h.status));
  const onSheet = state.habits.filter((h) => h.status === "active");

  const add = () => {
    const name = text.trim();
    if (!name) return;
    // A candidate, not a habit: no schedule is implied and nothing is tracked.
    const habit: Habit = {
      ...blankHabit(),
      name,
      templateKey: null,   // their words, never translated
      type: kind,
      category,
      weight,
      status: "candidate",
      active: false,
    };
    actions.saveHabit(habit);
    setText("");
  };

  const activate = (h: Habit) =>
    actions.saveHabit({ ...h, status: "active", active: true });

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <div className="eyebrow">{t.refine.stepBehaviours}</div>
        <p className="muted mt-2" style={{ fontSize: 14, lineHeight: 1.5 }}>{t.refine.intro}</p>

        <div className="mt-4">
          <textarea
            className="textarea" rows={2} value={text}
            placeholder={t.refine.placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(); }
            }}
          />
          <div className="faint mt-1" style={{ fontSize: 12 }}>{t.refine.capturedAs}</div>
        </div>

        <div className="mt-3">
          <Field label={t.refine.kindLabel}>
            <Segmented<HabitKind> value={kind} onChange={setKind} small
              options={[
                { value: "avoid", label: t.refine.kindAvoid },
                { value: "good", label: t.refine.kindGood },
              ]} />
          </Field>
          <Field label={t.habits.fieldTimeOfDay}>
            <Segmented<Category> value={category} onChange={setCategory} small
              options={(["morning", "daytime", "nighttime"] as Category[])
                .map((c) => ({ value: c, label: t.categories[c].label }))} />
          </Field>
          <Field label={t.refine.importance}>
            <Segmented<1 | 2 | 3> value={weight} onChange={setWeight} small
              options={[
                { value: 1, label: t.priority.low },
                { value: 2, label: t.priority.medium },
                { value: 3, label: t.priority.high },
              ]} />
          </Field>
        </div>

        <div className="flex justify-end">
          <button className="btn btn-primary" disabled={!text.trim()} onClick={add}>
            {t.refine.add}
          </button>
        </div>
      </section>

      <section className="card p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="eyebrow">{t.refine.backlogTitle}</div>
          <span className="faint num" style={{ fontSize: 12 }}>
            {t.refine.inBacklog(backlog.length)} · {t.refine.onSheet(onSheet.length)}
          </span>
        </div>
        <p className="faint mt-1" style={{ fontSize: 12, lineHeight: 1.45 }}>{t.refine.backlogNote}</p>

        {backlog.length === 0 ? (
          <div className="mt-3">
            <Empty title={t.refine.emptyTitle} body={t.refine.emptyBody} />
          </div>
        ) : (
          <div className="divide mt-2">
            {backlog.map((h) => (
              <div key={h.id} className="py-3.5">
                <div style={{ fontSize: 15, lineHeight: 1.4 }}>
                  {h.type === "avoid" && (
                    <span className="faint" style={{ fontWeight: 400 }}>{t.today.avoid} · </span>
                  )}
                  {habitName(h, t)}
                </div>
                <div className="faint flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5" style={{ fontSize: 12 }}>
                  <span>{t.categories[h.category].label}</span>
                  <span>{[t.priority.low, t.priority.medium, t.priority.high][h.weight - 1]}</span>
                  <span>{t.habits[`status${h.status[0].toUpperCase()}${h.status.slice(1)}` as "statusCandidate"]}</span>
                  <button className="btn btn-quiet" style={{ padding: "2px 9px", fontSize: 12 }}
                    onClick={() => activate(h)}>
                    {t.refine.activate}
                  </button>
                  <button className="btn btn-quiet" style={{ padding: "2px 9px", fontSize: 12 }}
                    onClick={() => actions.deleteHabit(h.id)}>
                    {t.refine.remove}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
