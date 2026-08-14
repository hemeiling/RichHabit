"use client";
import { useHabits } from "@/components/store";
import AskCoach from "@/components/AskCoach";
import { Bars, Heatmap } from "@/components/ui";
import { addDays, rangeBack, todayISO } from "@/lib/dates";
import { CATEGORIES, dayScore, dayStreak, habitStats, rangeScore } from "@/lib/habits";
import { coach } from "@/lib/coach";
import type { Trend } from "@/lib/habits";

const TREND_LABEL: Record<Trend, string> = {
  up: "Improving", down: "Slipping", flat: "Steady", new: "Too early",
};

export default function Insights() {
  const { state } = useHabits();
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
      label: c.label,
      value: xs.length ? Math.round(xs.reduce((a, b) => a + (b.s.pct ?? 0), 0) / xs.length) : null,
      sub: `${xs.length} habit${xs.length === 1 ? "" : "s"}`,
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
        <div className="eyebrow">Rich habit score</div>
        <div className="flex items-end gap-3 mt-1">
          <span className="display num" style={{ fontSize: 46, lineHeight: 1 }}>
            {todayScore.pct ?? "—"}<span style={{ fontSize: 22 }}>%</span>
          </span>
          <span className="muted mb-1.5" style={{ fontSize: 14 }}>today</span>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          {([["7 days", week.pct], ["30 days", month.pct], ["90 days", quarter.pct]] as const).map(([label, v]) => (
            <div key={label} className="flat p-3">
              <div className="eyebrow" style={{ fontSize: 10 }}>{label}</div>
              <div className="display num mt-1" style={{ fontSize: 24 }}>{v == null ? "—" : `${v}%`}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          {([["Current streak", `${dayStreak(state)}d`], ["Perfect days", month.perfect], ["Habits completed", totalCompleted]] as const).map(([label, v]) => (
            <div key={label} className="flat p-3">
              <div className="eyebrow" style={{ fontSize: 10 }}>{label}</div>
              <div className="display num mt-1" style={{ fontSize: 24 }}>{v}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-3">Last 17 weeks</div>
        <Heatmap state={state} />
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-3">By time of day · 30 days</div>
        <Bars rows={catRows} />
      </section>

      <section className="card px-5 py-2">
        <div className="eyebrow pt-4 pb-1">Per habit · 30 days</div>
        {rows.length === 0 ? (
          <p className="muted py-4" style={{ fontSize: 14 }}>No active habits.</p>
        ) : (
          <div className="divide">
            {[...rows].sort((a, b) => (b.s.pct ?? -1) - (a.s.pct ?? -1)).map(({ h, s }) => (
              <div key={h.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span style={{ fontSize: 15 }}>{h.name}</span>
                  <span className="num" style={{ fontSize: 15, flex: "none" }}>{s.pct == null ? "—" : `${s.pct}%`}</span>
                </div>
                <div className="faint flex flex-wrap gap-x-3 mt-1 num" style={{ fontSize: 12 }}>
                  <span>{s.done}/{s.scheduled} done</span>
                  <span>{s.missed} missed</span>
                  <span>{s.streak}d streak</span>
                  <span>best {s.longest}d</span>
                  <span style={{ color: s.trend === "up" ? "var(--accent)" : s.trend === "down" ? "var(--warn)" : undefined }}>
                    {TREND_LABEL[s.trend]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="h-2" />
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-2">Patterns</div>
        {corr == null ? (
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
            Log sleep in Metrics for a couple of weeks and the relationship between sleep and the next
            day&apos;s completion will show up here.
          </p>
        ) : (
          <p style={{ fontSize: 14, lineHeight: 1.5 }}>
            Across {pairs.length} nights, sleep and next-day completion correlate at{" "}
            <b className="num">{corr.toFixed(2)}</b> —{" "}
            {corr > 0.3
              ? "sleeping more clearly precedes better days for you."
              : corr < -0.3
                ? "more sleep is tracking with weaker days, which usually means something else is driving both."
                : "no meaningful relationship yet."}
          </p>
        )}
        <div className="mt-3 flex flex-col gap-2">
          {coach.suggestions(state).map((s, i) => (
            <div key={i} className="flat p-3.5" style={{ fontSize: 14, lineHeight: 1.45 }}>{s}</div>
          ))}
        </div>
      </section>

      <AskCoach />
    </div>
  );
}
