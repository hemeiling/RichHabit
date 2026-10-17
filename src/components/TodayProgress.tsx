"use client";
import { ScoreDial } from "@/components/ui";
import { CATEGORIES, dayScore, isDone, scheduledOn } from "@/lib/habits";
import { useT } from "@/lib/i18n/context";
import type { AppState } from "@/lib/types";

/**
 * Today's progress, at a glance: the score dial, how each time of day is
 * going, and how many of the day's habits are done.
 *
 * This used to be the top half of Rich Habits. It moved to Insights, which is
 * where progress is reviewed: Rich Habits is for doing the day's habits, and a
 * phone should open on the first habit, not on a dashboard. The figures are
 * exactly the ones it showed there — the same `dayScore`, the same scheduled
 * list, the same weighting preference — so nothing is recalculated and no
 * record is touched.
 *
 * The current streak is not repeated here: Insights already shows it beside
 * perfect days and the 7/30/90-day scores, where a figure about many days
 * belongs.
 */
export default function TodayProgress({ state, date }: { state: AppState; date: string }) {
  const t = useT();
  const score = dayScore(state, date);
  const list = scheduledOn(state, date);
  const segments = list.map((h) => ({
    weight: state.prefs.weighted ? h.weight || 1 : 1,
    done: isDone(state, date, h.id),
  }));

  return (
    <section id="today" className="card p-5" aria-labelledby="today-progress-title">
      <div id="today-progress-title" className="eyebrow">{t.insights.todayProgress}</div>
      <div className="flex flex-col sm:flex-row items-center gap-5 mt-3">
        <ScoreDial score={score.pct} segments={segments.length ? segments : [{ weight: 1, done: false }]} />
        <div className="flex-1 w-full">
          <div className="grid grid-cols-2 min-[360px]:grid-cols-3 gap-2">
            {CATEGORIES.map((c) => {
              const hs = list.filter((h) => h.category === c.id);
              const done = hs.filter((h) => isDone(state, date, h.id)).length;
              return (
                <div key={c.id} className="flat p-3">
                  <div className="eyebrow" style={{ fontSize: 10 }}>{t.categories[c.id].label}</div>
                  <div className="num display mt-1" style={{ fontSize: 20 }}>
                    {done}<span className="faint">/{hs.length}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3" style={{ fontSize: 13 }}>
            <span className="muted">{t.today.done} <b className="num" style={{ color: "var(--ink)" }}>{score.done}/{score.total}</b></span>
          </div>
        </div>
      </div>
    </section>
  );
}
