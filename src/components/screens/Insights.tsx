"use client";
import { useHabits } from "@/components/store";
import AskCoach from "@/components/AskCoach";
import { Bars, Heatmap } from "@/components/ui";
import { addDays, rangeBack, todayISO } from "@/lib/dates";
import { CATEGORIES, dayScore, dayStreak, habitStats, rangeScore } from "@/lib/habits";
import { coach } from "@/lib/coach";
import { useT } from "@/lib/i18n/context";
import type { Trend } from "@/lib/habits";

export default function Insights() {
  const { state } = useHabits();
  const t = useT();
  const today = todayISO();
  const week = rangeScore(state, rangeBack(today, 7));
  const month = rangeScore(state, rangeBack(today, 30));
  const quarter = rangeScore(state, rangeBack(today, 90));
  const todayScore = dayScore(state, today);

  const totalCompleted = Object.values(state.completions)
    .reduce((a, day) => a + Object.values(day).filter((c) => c.done).length, 0);

  const rows = state.habits.filter((h) => h.active).map((h) => ({ h, s: habitStats(state, h, 30) }));

  const catRows = CATEGORIES.map((c) => {
    const xs = rows.filter((r) => r.h.category === c.id && r.s.pct != null);
    return {
      label: t.categories[c.id].label,
      value: xs.length ? Math.round(xs.reduce((a, b) => a + (b.s.pct ?? 0), 0) / xs.length) : null,
      sub: t.insights.habitCount(xs.length),
    };
  });

  // Sleep against the next day's completion — the first correlation worth having.
  const pairs = Object.entries(state.metrics)
    .filter(([, v]) => v.sleep != null && v.sleep !== "")
    .map(([d, v]) => ({ sleep: Number(v.sleep), next: dayScore(state, addDays(d, 1)).pct }))
    .filter((p): p is { sleep: number; next: number } => p.next != null && !Number.isNaN(p.sleep));

  const corr = (() => {
    if (pairs.length < 5) return null;
    const n = pairs.length;
    const mx = pairs.reduce((a, p) => a + p.sleep, 0) / n;
    const my = pairs.reduce((a, p) => a + p.next, 0) / n;
    const num = pairs.reduce((a, p) => a + (p.sleep - mx) * (p.next - my), 0);
    const den = Math.sqrt(
      pairs.reduce((a, p) => a + (p.sleep - mx) ** 2, 0) *
      pairs.reduce((a, p) => a + (p.next - my) ** 2, 0),
    );
    return den ? num / den : null;
  })();

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <div className="eyebrow">{t.insights.score}</div>
        <div className="flex items-end gap-3 mt-1">
          <span className="display num" style={{ fontSize: 46, lineHeight: 1 }}>
            {todayScore.pct ?? "—"}<span style={{ fontSize: 22 }}>%</span>
          </span>
          <span className="muted mb-1.5" style={{ fontSize: 14 }}>{t.insights.todaySuffix}</span>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          {([[t.insights.sevenDays, week.pct], [t.insights.thirtyDays, month.pct], [t.insights.ninetyDays, quarter.pct]] as const).map(([label, v]) => (
            <div key={label} className="flat p-3">
              <div className="eyebrow" style={{ fontSize: 10 }}>{label}</div>
              <div className="display num mt-1" style={{ fontSize: 24 }}>{v == null ? "—" : `${v}%`}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          {([[t.insights.currentStreak, `${dayStreak(state)}d`], [t.insights.perfectDays, month.perfect], [t.insights.habitsCompleted, totalCompleted]] as const).map(([label, v]) => (
            <div key={label} className="flat p-3">
              <div className="eyebrow" style={{ fontSize: 10 }}>{label}</div>
              <div className="display num mt-1" style={{ fontSize: 24 }}>{v}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-3">{t.insights.lastWeeks(17)}</div>
        <Heatmap state={state} />
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-3">{t.insights.byTimeOfDay}</div>
        <Bars rows={catRows} />
      </section>

      <section className="card px-5 py-2">
        <div className="eyebrow pt-4 pb-1">{t.insights.perHabit}</div>
        {rows.length === 0 ? (
          <p className="muted py-4" style={{ fontSize: 14 }}>{t.insights.noActiveHabits}</p>
        ) : (
          <div className="divide">
            {[...rows].sort((a, b) => (b.s.pct ?? -1) - (a.s.pct ?? -1)).map(({ h, s }) => (
              <div key={h.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span style={{ fontSize: 15 }}>{h.name}</span>
                  <span className="num" style={{ fontSize: 15, flex: "none" }}>{s.pct == null ? "—" : `${s.pct}%`}</span>
                </div>
                <div className="faint flex flex-wrap gap-x-3 mt-1 num" style={{ fontSize: 12 }}>
                  <span>{t.insights.doneCount(s.done, s.scheduled)}</span>
                  <span>{t.insights.missedCount(s.missed)}</span>
                  <span>{t.insights.streakCount(s.streak)}</span>
                  <span>{t.insights.bestCount(s.longest)}</span>
                  <span style={{ color: s.trend === "up" ? "var(--accent)" : s.trend === "down" ? "var(--warn)" : undefined }}>
                    {t.trends[s.trend]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="h-2" />
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-2">{t.insights.patterns}</div>
        {corr == null ? (
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
            {t.insights.noCorrelation}
          </p>
        ) : (
          <p style={{ fontSize: 14, lineHeight: 1.5 }}>
            {t.insights.correlation(pairs.length, corr.toFixed(2))}{" "}
            {corr > 0.3
              ? t.insights.corrPositive
              : corr < -0.3
                ? t.insights.corrNegative
                : t.insights.corrNone}
          </p>
        )}
        <div className="mt-3 flex flex-col gap-2">
          {coach.suggestions(state).map((s, i) => (
            <div key={i} className="flat p-3.5" style={{ fontSize: 14, lineHeight: 1.45 }}>
              {s.kind === "worst" ? t.suggestions.worst(s.name, s.pct)
                : s.kind === "best" ? t.suggestions.best(s.name, s.pct)
                  : s.kind === "weakestWindow"
                    ? t.suggestions.weakestWindow(s.category, s.pct)
                    : t.suggestions[s.kind]}
            </div>
          ))}
        </div>
      </section>

      <AskCoach />
    </div>
  );
}
