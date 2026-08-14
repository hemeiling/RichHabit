"use client";
import { useEffect, useState } from "react";
import { useHabits } from "@/components/store";
import { Field } from "@/components/ui";
import { addDays, daysBetween, shortDate, todayISO, weekStart } from "@/lib/dates";
import { rangeScore, uid, weekSummary } from "@/lib/habits";
import type { WeeklyReview } from "@/lib/types";

const QUESTIONS: { key: keyof Pick<WeeklyReview, "wentWell" | "gotInWay" | "focus" | "modify" | "add">; label: string; hint: string }[] = [
  { key: "wentWell", label: "What went well?", hint: "The habits that held, and why." },
  { key: "gotInWay", label: "What got in the way?", hint: "Be specific — time, energy, other people, the setup." },
  { key: "focus", label: "Which habit gets the focus next week?", hint: "One is enough." },
  { key: "modify", label: "Should any habit change?", hint: "Smaller, earlier, different day." },
  { key: "add", label: "Anything to add or drop?", hint: "Only if the current set is holding." },
];

const blankReview = (week: string): WeeklyReview => ({
  id: uid(), weekStart: week, wentWell: "", gotInWay: "", focus: "", modify: "", add: "",
});

export default function Review() {
  const { state, actions } = useHabits();
  // The week under review is the one that just finished.
  const [weekOf, setWeekOf] = useState(weekStart(addDays(todayISO(), -7)));
  const existing = state.reviews.find((r) => r.weekStart === weekOf);
  const [draft, setDraft] = useState<WeeklyReview>(existing ?? blankReview(weekOf));

  useEffect(() => {
    const found = state.reviews.find((r) => r.weekStart === weekOf);
    setDraft(found ?? blankReview(weekOf));
  }, [weekOf, state.reviews]);

  const summary = weekSummary(state, weekOf, null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekOf, i))
    .filter((d) => daysBetween(d, todayISO()) >= 0);
  const scores = rangeScore(state, days);

  const save = () => {
    actions.saveReview({
      ...draft,
      stats: {
        pct: summary.pct, done: summary.done, scheduled: summary.scheduled, perfect: scores.perfect,
        best: summary.best?.habit.name ?? null, worst: summary.worst?.habit.name ?? null,
        longest: summary.longest,
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="eyebrow">Week of</div>
            <h1 className="display" style={{ fontSize: 22, marginTop: 2 }}>
              {shortDate(weekOf)} – {shortDate(addDays(weekOf, 6))}
            </h1>
          </div>
          <div className="flex gap-1">
            <button className="btn btn-quiet" style={{ padding: "8px 12px" }}
              onClick={() => setWeekOf(addDays(weekOf, -7))} aria-label="Previous week">‹</button>
            <button className="btn btn-quiet" style={{ padding: "8px 12px" }}
              disabled={weekOf === weekStart(todayISO())}
              onClick={() => setWeekOf(addDays(weekOf, 7))} aria-label="Next week">›</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="flat p-3.5">
            <div className="eyebrow" style={{ fontSize: 10 }}>Consistency</div>
            <div className="display num mt-1" style={{ fontSize: 28 }}>
              {summary.pct == null ? "—" : `${summary.pct}%`}
            </div>
          </div>
          <div className="flat p-3.5">
            <div className="eyebrow" style={{ fontSize: 10 }}>Completed</div>
            <div className="display num mt-1" style={{ fontSize: 28 }}>
              {summary.done}<span className="faint" style={{ fontSize: 18 }}>/{summary.scheduled}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 mt-3" style={{ fontSize: 14 }}>
          <div className="flex justify-between"><span className="muted">Best habit</span><span>{summary.best?.habit.name ?? "—"}</span></div>
          <div className="flex justify-between"><span className="muted">Most missed</span><span>{summary.worst?.habit.name ?? "—"}</span></div>
          <div className="flex justify-between"><span className="muted">Longest streak</span><span className="num">{summary.longest}d</span></div>
          <div className="flex justify-between"><span className="muted">Perfect days</span><span className="num">{scores.perfect}</span></div>
        </div>
      </section>

      <section className="card p-5">
        {QUESTIONS.map((q) => (
          <Field key={q.key} label={q.label}>
            <textarea className="textarea" rows={2} placeholder={q.hint} value={draft[q.key]}
              onChange={(e) => setDraft({ ...draft, [q.key]: e.target.value })} />
          </Field>
        ))}
        <div className="flex items-center justify-between mt-1">
          <span className="faint" style={{ fontSize: 12.5 }}>
            {existing ? "Saved for this week" : "Not saved yet"}
          </span>
          <button className="btn btn-primary" onClick={save}>
            {existing ? "Update review" : "Save review"}
          </button>
        </div>
      </section>

      {state.reviews.length > 0 && (
        <section className="card px-5 py-2">
          <div className="eyebrow pt-4 pb-1">Past reviews</div>
          <div className="divide">
            {[...state.reviews].sort((a, b) => b.weekStart.localeCompare(a.weekStart)).map((r) => (
              <button key={r.id} className="w-full text-left py-3"
                style={{ background: "none", border: "none", cursor: "pointer" }}
                onClick={() => setWeekOf(r.weekStart)}>
                <div className="flex justify-between items-baseline">
                  <span style={{ fontSize: 14.5 }}>{shortDate(r.weekStart)}</span>
                  <span className="num muted" style={{ fontSize: 13 }}>
                    {r.stats?.pct == null ? "—" : `${r.stats.pct}%`}
                  </span>
                </div>
                {r.focus && <div className="muted mt-0.5" style={{ fontSize: 13 }}>Focus: {r.focus}</div>}
              </button>
            ))}
          </div>
          <div className="h-2" />
        </section>
      )}
    </div>
  );
}
