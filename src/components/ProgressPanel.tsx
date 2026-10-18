"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useHabits } from "@/components/store";
import { useLocale, useT } from "@/lib/i18n/context";
import { monthTitleFor, shortDateFor, type Locale } from "@/lib/i18n";
import { rangeScore } from "@/lib/habits";
import { monthOf, monthSoFar, todayISO } from "@/lib/dates";
import { accomplishedBetween } from "@/lib/accomplishments";
import { barHeight, dailyProgress, dayIndexAt, type DayProgress } from "@/lib/progressSeries";
import { runsOf } from "@/lib/trend";

/**
 * §20. `MonthProgress` — your own month, day by day — a section of Insights,
 * where personal statistics are reviewed. It used to be the "My Progress"
 * tab of the Today rail; Today is for doing the day's habits, and the rails
 * carry Community Progress now (components/CommunityCard).
 *
 * Every habit number here comes from `dayScore` / `rangeScore`, the same
 * functions Insights' dial and score card use, and every accomplishment number
 * from the shared rule in lib/accomplishments — computed from state the browser
 * already holds. There is no second scoring rule anywhere in this file.
 */

/* ------------------------------- the chart -------------------------------- */

/** The chart's drawn width follows its container, so marks are never stretched. */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(120, Math.round(el.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Two things done each day, drawn together without pretending they share a unit.
 *
 * Habits are the thin line, on a fixed 0–100 scale: a completion rate has a real
 * ceiling, and "am I improving?" is only an honest question against it. Days
 * with nothing scheduled are gaps rather than zeroes. Accomplishments are the
 * soft columns behind it, on their own scale — the busiest day of the month is
 * the tallest column — held to the lower part of the chart so a count can never
 * be read as a height on the percentage scale. Same colour family, different
 * form and weight: the line is primary, the columns support it.
 *
 * The legend is also the reading. It shows the chosen day's two values — today
 * unless someone hovers, taps or arrows to another day — so the numbers are
 * readable on a phone without aiming a finger at a thin line.
 */
function DayChart({ days, month, locale }: { days: DayProgress[]; month: string; locale: Locale }) {
  const t = useT();
  const [boxRef, W] = useWidth(268);
  const [picked, setPicked] = useState<number | null>(null);

  const H = 84, TOP = 6, BASE = H - 2, BAND = 30, PAD = 4;
  const n = days.length;
  const step = n > 1 ? (W - PAD * 2) / (n - 1) : 0;
  const x = (i: number) => (n > 1 ? PAD + i * step : W / 2);
  const y = (pct: number) => TOP + (1 - pct / 100) * (BASE - TOP);
  const maxCount = Math.max(0, ...days.map((d) => d.count));
  const barW = Math.max(2, Math.min(7, step ? step * 0.55 : 7));
  const runs = runsOf(days.map((d) => d.pct));

  // The last day is today: the series is the month so far.
  const selected = Math.min(picked ?? n - 1, n - 1);
  const day = days[selected];
  const pick = (clientX: number, el: Element) =>
    setPicked(dayIndexAt(clientX - el.getBoundingClientRect().left, W, PAD, n));

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center" style={{ gap: "2px 12px", fontSize: 11.5 }} aria-live="polite">
        <span className="faint num" style={{ minWidth: 38 }}>{shortDateFor(day.date, locale)}</span>
        <span className="inline-flex items-center" style={{ gap: 5 }}>
          <span aria-hidden="true" style={{ width: 12, height: 2, borderRadius: 1, background: "var(--accent)", display: "inline-block" }} />
          <span className="muted">{t.progress.legendHabits}</span>
          <span className="num" style={{ color: "var(--ink)", fontWeight: 500 }}>{day.pct === null ? "—" : `${day.pct}%`}</span>
        </span>
        <span className="inline-flex items-center" style={{ gap: 5 }}>
          <span aria-hidden="true" style={{ width: 6, height: 10, borderRadius: 1.5, background: "var(--accent)", opacity: 0.32, display: "inline-block" }} />
          <span className="muted">{t.progress.legendAccomplishments}</span>
          <span className="num" style={{ color: "var(--ink)", fontWeight: 500 }}>{day.count}</span>
        </span>
      </div>

      <div ref={boxRef} style={{ marginTop: 6 }}>
        <svg
          className="progress-chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`}
          role="img" tabIndex={0}
          aria-label={t.progress.chartLabel(month)}
          style={{ display: "block", touchAction: "pan-y", cursor: "crosshair" }}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
          onPointerLeave={(e) => { if (e.pointerType === "mouse") setPicked(null); }}
          onKeyDown={(e) => {
            const moves: Record<string, number> = { ArrowLeft: selected - 1, ArrowRight: selected + 1, Home: 0, End: n - 1 };
            if (e.key in moves) { e.preventDefault(); setPicked(Math.min(n - 1, Math.max(0, moves[e.key]))); }
          }}
        >
          {/* Quarter lines for the habit scale, so the line's height means something. */}
          {[0, 50, 100].map((p) => (
            <line key={p} x1={0} x2={W} y1={y(p)} y2={y(p)} stroke="var(--line-soft)" strokeWidth="1" />
          ))}

          {/* The chosen day, behind everything drawn on it. */}
          <line x1={x(selected)} x2={x(selected)} y1={TOP} y2={BASE}
            stroke="var(--line)" strokeWidth="1" strokeDasharray="2 3" />

          {/* Accomplishments: behind the line, on their own scale. */}
          {days.map((d, i) => {
            const h = barHeight(d.count, maxCount, BAND);
            return h > 0 && (
              <rect key={d.date} x={x(i) - barW / 2} y={BASE - h} width={barW} height={h} rx={1.5}
                fill="var(--accent)" opacity={i === selected ? 0.6 : 0.3} />
            );
          })}

          {/* Habits: one path per unbroken run, so a gap stays a gap — see lib/trend. */}
          {runs.map((run, k) => (run.length > 1 ? (
            <polyline key={k} points={run.map((s) => `${x(s.index)},${y(s.value)}`).join(" ")}
              fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
          ) : (
            <circle key={k} cx={x(run[0].index)} cy={y(run[0].value)} r="1.8" fill="var(--accent)" />
          )))}
          {day.pct !== null && (
            <circle cx={x(selected)} cy={y(day.pct)} r="3.2" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />
          )}
        </svg>
      </div>
    </div>
  );
}

/* ----------------------------- my own month ------------------------------- */

/**
 * Insights' month section: the habit month-to-date figure and the day-by-day
 * chart that used to be the Today rail's "My Progress" tab — the same
 * calculation and the same chart, moved.
 *
 * Two of its old figures are not repeated, because Insights already shows them
 * right beside this: today's percentage is the dial in "Today · Daily
 * progress", and the month's accomplishment count heads the Accomplishments
 * card that follows. The chart keeps both series, which is what it is for.
 */
export function MonthProgress() {
  const { state } = useHabits();
  const t = useT();
  const locale = useLocale();
  const today = todayISO();
  const month = monthOf(today);

  /*
   * Every day of the month so far. `dayScore` is the source of truth — the same
   * call the dial makes — so the last habit point and the dial above are the
   * same measurement of the same day, and the month-to-date figure is
   * `rangeScore` over exactly these days.
   */
  const { days, mtd, accomplished } = useMemo(() => {
    const dates = monthSoFar(today);
    return {
      days: dailyProgress(state, dates),
      mtd: rangeScore(state, dates),
      accomplished: accomplishedBetween(state.priorities, dates[0], today).length,
    };
  }, [state, today]);

  const scored = days.filter((d) => d.pct !== null).length;

  return (
    <section className="card p-5" aria-labelledby="month-progress-title">
      <div id="month-progress-title" className="eyebrow">
        {t.progress.thisMonth(monthTitleFor(month, locale))}
      </div>
      <div className="flex items-end gap-3 mt-1">
        <span className="display num" style={{ fontSize: 40, lineHeight: 1 }}>
          {mtd.pct === null ? "—" : `${mtd.pct}%`}
        </span>
        <span className="muted mb-1" style={{ fontSize: 14 }}>
          {t.progress.monthToDate} · {t.progress.habitsLabel}
        </span>
      </div>

      {scored === 0 && accomplished === 0 ? (
        <p className="muted mt-3" style={{ fontSize: 13, lineHeight: 1.5 }}>{t.progress.noneYet}</p>
      ) : (
        <>
          <DayChart days={days} month={monthTitleFor(month, locale)} locale={locale} />
          <div className="flex justify-between faint num" style={{ fontSize: 10.5, marginTop: 2 }}>
            <span>1</span>
            <span>{Number(today.slice(8, 10))}</span>
          </div>
          {/* The labels that stop the figures reading as a contradiction. */}
          <p className="faint mt-2" style={{ fontSize: 11.5, lineHeight: 1.45 }}>
            {t.progress.explain}
            {/* Only when this figure and the Community board's can differ: the
                reader's own is weighted by priority, the board's never is. */}
            {state.prefs.weighted && ` ${t.progress.weightedNote}`}
          </p>
        </>
      )}
    </section>
  );
}
