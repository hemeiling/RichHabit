"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useHabits } from "@/components/store";
import { Empty, Field, Sheet } from "@/components/ui";
import { GOAL_AREAS, habitStats, uid } from "@/lib/habits";
import { useT } from "@/lib/i18n/context";
import { goalName, habitName } from "@/lib/templates";
import type { Goal } from "@/lib/types";

export default function Goals() {
  const { state, actions } = useHabits();
  const t = useT();
  const router = useRouter();
  const [draft, setDraft] = useState<Goal | null>(null);

  const unlinked = state.habits.filter((h) => h.active && !h.goalId);
  const isExisting = (g: Goal) => state.goals.some((x) => x.id === g.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="muted" style={{ fontSize: 14, maxWidth: 420 }}>
          {t.goals.intro}
        </p>
        <button className="btn btn-primary" style={{ flex: "none" }}
          onClick={() => setDraft({ id: uid(), name: "", templateKey: null, area: GOAL_AREAS[0], why: "" })}>{t.common.new}</button>
      </div>

      {state.goals.length === 0 && (
        <Empty title={t.goals.noneTitle} body={t.goals.noneBody} />
      )}

      {state.goals.map((g) => {
        const habits = state.habits.filter((h) => h.goalId === g.id);
        const stats = habits.map((h) => habitStats(state, h, 30)).filter((s) => s.pct != null);
        const progress = stats.length
          ? Math.round(stats.reduce((a, b) => a + (b.pct ?? 0), 0) / stats.length)
          : null;
        return (
          <section key={g.id} className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow">{t.goalAreas[g.area] ?? g.area}</div>
                <h2 className="display" style={{ fontSize: 23, lineHeight: 1.15, marginTop: 2 }}>{goalName(g, t)}</h2>
              </div>
              <div className="text-right" style={{ flex: "none" }}>
                <div className="display num" style={{ fontSize: 27 }}>{progress == null ? "—" : `${progress}%`}</div>
                <div className="eyebrow" style={{ fontSize: 10 }}>{t.goals.thirtyDay}</div>
              </div>
            </div>
            {g.why && <p className="muted mt-2" style={{ fontSize: 14, lineHeight: 1.45 }}>{g.why}</p>}

            <div className="mt-3.5">
              {habits.length === 0 ? (
                <p className="faint" style={{ fontSize: 13.5 }}>{t.goals.noHabitsYet}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {habits.map((h) => {
                    const s = habitStats(state, h, 30);
                    return (
                      <button key={h.id} className="flat p-3 w-full text-left" style={{ cursor: "pointer" }}
                        onClick={() => router.push(`/habits?edit=${h.id}`)}>
                        <div className="flex justify-between items-baseline gap-3">
                          <span style={{ fontSize: 14.5 }}>{habitName(h, t)}</span>
                          <span className="num muted" style={{ fontSize: 13, flex: "none" }}>
                            {s.pct == null ? "—" : `${s.pct}%`}
                          </span>
                        </div>
                        <div style={{ height: 4, background: "var(--line)", borderRadius: 3, marginTop: 7, overflow: "hidden" }}>
                          <div style={{ width: `${s.pct ?? 0}%`, height: "100%", background: "var(--accent)" }} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-3.5">
              <button className="btn" onClick={() => setDraft({ ...g, name: goalName(g, t) })}>{t.goals.editGoal}</button>
              <button className="btn" onClick={() => router.push("/habits")}>{t.goals.addAHabit}</button>
            </div>
          </section>
        );
      })}

      {unlinked.length > 0 && (
        <section className="card p-5">
          <div className="eyebrow mb-2">{t.goals.notLinked}</div>
          <div className="flex flex-wrap gap-2">
            {unlinked.map((h) => (
              <button key={h.id} className="chip" onClick={() => router.push(`/habits?edit=${h.id}`)}>{habitName(h, t)}</button>
            ))}
          </div>
        </section>
      )}

      {draft && (
        <Sheet
          open onClose={() => setDraft(null)} title={isExisting(draft) ? t.goals.editGoal : t.goals.newGoal}
          footer={
            <>
              {isExisting(draft) && (
                <button className="btn btn-danger mr-auto"
                  onClick={() => { actions.deleteGoal(draft.id); setDraft(null); }}>{t.common.delete}</button>
              )}
              <button className="btn" onClick={() => setDraft(null)}>{t.common.cancel}</button>
              <button className="btn btn-primary" disabled={!draft.name.trim()}
                onClick={() => { actions.saveGoal({ ...draft, name: draft.name.trim() }); setDraft(null); }}>
                {t.goals.saveGoal}
              </button>
            </>
          }
        >
          <Field label={t.goals.fieldGoal}>
            {/* Shows the translated name for a seeded goal. Typing over it makes
                the text the user's own — the key goes, and it stops translating. */}
            <input className="input" autoFocus value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value, templateKey: null })}
              placeholder={t.goals.goalPlaceholder} />
          </Field>
          <Field label={t.goals.fieldArea}>
            <select className="select" value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value })}>
              {GOAL_AREAS.map((a) => <option key={a} value={a}>{t.goalAreas[a] ?? a}</option>)}
            </select>
          </Field>
          <Field label={t.goals.fieldWhy} hint={t.goals.whyHint}>
            <textarea className="textarea" rows={3} value={draft.why}
              onChange={(e) => setDraft({ ...draft, why: e.target.value })} />
          </Field>
        </Sheet>
      )}
    </div>
  );
}
