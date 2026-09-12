"use client";
import { useMemo, useState } from "react";
import { useHabits } from "@/components/store";
import { Segmented } from "@/components/ui";
import { useToday } from "@/components/useToday";
import {
  accomplishedInMonth, accomplishedOn, carriedSince, countsByDay, countsByMonth, groupByDay,
} from "@/lib/accomplishments";
import { addMonths, monthOf } from "@/lib/dates";
import { intlTag, monthTitleFor, shortDateFor } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/context";

/**
 * Accomplishments — what the user actually got done.
 *
 * Month and year, both read straight from completed priorities the app already
 * holds; see lib/accomplishments for the rule. Nothing here is stored, scored,
 * ranked or shared.
 *
 * The tone is reflection, not reporting: one number, one small picture of when
 * it happened, and the things themselves in the user's own words. No trophies,
 * streaks or targets — the value is noticing how much was done.
 */

type View = "month" | "year";
const pad = (n: number) => String(n).padStart(2, "0");

export default function Accomplishments() {
  const { state } = useHabits();
  const t = useT();
  const locale = useLocale();
  const today = useToday();
  const a = t.insights.accomplishments;

  const currentMonth = monthOf(today);
  const currentYear = today.slice(0, 4);
  const [view, setView] = useState<View>("month");
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(currentYear);

  const monthItems = useMemo(() => accomplishedInMonth(state.priorities, month, today), [state.priorities, month, today]);
  const dayCounts = useMemo(() => countsByDay(state.priorities, month, today), [state.priorities, month, today]);
  const days = useMemo(() => groupByDay(monthItems), [monthItems]);
  const monthCounts = useMemo(() => countsByMonth(state.priorities, year, today), [state.priorities, year, today]);
  const yearTotal = monthCounts.reduce((n, c) => n + c, 0);
  const todayCount = accomplishedOn(state.priorities, today).length;

  const monthName = monthTitleFor(month, locale);
  const openMonth = (m: string) => { setMonth(m); setYear(m.slice(0, 4)); setView("month"); };

  return (
    <section className="card p-5" aria-labelledby="accomplishments-title">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="eyebrow" id="accomplishments-title">{a.title}</div>
        <Segmented<View> value={view} small
          onChange={(v) => { setView(v); if (v === "year") setYear(month.slice(0, 4)); }}
          options={[{ value: "month", label: a.month }, { value: "year", label: a.year }]} />
      </div>

      {/* Where you are in time, and the way back through it. Forward stops at now. */}
      <div className="flex items-center justify-between gap-2 mt-4">
        <button className="btn btn-quiet" style={{ padding: "5px 11px" }}
          aria-label={view === "month" ? a.previousMonth : a.previousYear}
          onClick={() => (view === "month" ? setMonth(addMonths(month, -1)) : setYear(String(Number(year) - 1)))}>‹</button>
        <span className="num" style={{ fontSize: 14, fontWeight: 500, textAlign: "center" }}>
          {view === "month" ? monthName : year}
        </span>
        <button className="btn btn-quiet" style={{ padding: "5px 11px" }}
          aria-label={view === "month" ? a.nextMonth : a.nextYear}
          disabled={view === "month" ? month >= currentMonth : year >= currentYear}
          onClick={() => (view === "month" ? setMonth(addMonths(month, 1)) : setYear(String(Number(year) + 1)))}>›</button>
      </div>

      {view === "month" ? (
        <>
          <Headline
            count={monthItems.length}
            label={month === currentMonth ? a.thisMonth : a.inMonth(monthName)}
            aside={month === currentMonth ? a.today(todayCount) : null} />
          <DayBars counts={dayCounts} month={month} today={today}
            label={a.byDay(monthItems.length, monthName)} />

          {days.length === 0 ? (
            <p className="muted mt-4" style={{ fontSize: 14, lineHeight: 1.55 }}>{a.emptyMonth(monthName)}</p>
          ) : (
            <div className="mt-5">
              <div className="eyebrow" style={{ fontSize: 10 }}>{a.yours}</div>
              {days.map((d) => (
                <div key={d.date} className="mt-4">
                  <div className="faint num" style={{ fontSize: 12.5 }}>{shortDateFor(d.date, locale)}</div>
                  <ul className="mt-1.5" style={{ display: "grid", gap: 8 }}>
                    {d.items.map((p) => {
                      const from = carriedSince(p);
                      return (
                        <li key={p.id} className="flex items-start gap-2.5">
                          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"
                            style={{ flex: "none", marginTop: 4 }}>
                            <path d="M4.5 10.5l3.6 3.6L15.5 6.8" stroke="var(--accent)" strokeWidth="2.4"
                              strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span style={{ minWidth: 0 }}>
                            {/* The user's own words, exactly as they wrote them. */}
                            <span style={{ fontSize: 15, lineHeight: 1.45, overflowWrap: "anywhere" }}>{p.text}</span>
                            {from && (
                              <span className="faint block" style={{ fontSize: 12, marginTop: 1 }}>
                                {t.priorities.carriedFrom(shortDateFor(from, locale))}
                              </span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <Headline count={yearTotal} label={year === currentYear ? a.thisYear : a.inYear(year)} aside={null} />
          <MonthBars counts={monthCounts} year={year} currentMonth={currentMonth}
            selected={month} label={a.byMonth(yearTotal, year)} onOpen={openMonth} />
          <p className="faint mt-3" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            {yearTotal === 0 ? a.emptyYear(year) : a.chooseMonth}
          </p>
        </>
      )}
    </section>
  );
}

function Headline({ count, label, aside }: { count: number; label: string; aside: string | null }) {
  return (
    <div className="flex items-baseline flex-wrap mt-3" style={{ gap: "4px 12px" }}>
      <span className="count" style={{ fontSize: 40, lineHeight: 1 }}>{count}</span>
      <span className="muted" style={{ fontSize: 14 }}>{label}</span>
      {aside && <span className="faint num" style={{ fontSize: 12.5, marginLeft: "auto" }}>{aside}</span>}
    </div>
  );
}

/**
 * One bar per day. A count, not a rate, so bars rather than a line, scaled to
 * the busiest day of the month; a day with nothing is a faint mark on the
 * baseline so the month keeps its shape. Days that have not happened yet are
 * quieter still, and today is the one bar at full strength.
 */
function DayBars({ counts, month, today, label }: {
  counts: number[]; month: string; today: string; label: string;
}) {
  const n = counts.length;
  const max = Math.max(1, ...counts);
  const H = 48, bar = 7, gap = 3, W = n * (bar + gap) - gap;
  return (
    <div className="mt-4">
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        role="img" aria-label={label} style={{ display: "block" }}>
        {counts.map((c, i) => {
          const date = `${month}-${pad(i + 1)}`;
          const x = i * (bar + gap);
          if (c === 0) {
            return <rect key={date} x={x} y={H - 2} width={bar} height={2} rx={1}
              fill="var(--line)" opacity={date > today ? 0.45 : 1} />;
          }
          const h = 5 + (c / max) * (H - 7);
          return (
            <rect key={date} x={x} y={H - h} width={bar} height={h} rx={2}
              fill="var(--accent)" opacity={date === today ? 1 : 0.72}>
              <title>{`${date}: ${c}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="flex justify-between faint num" style={{ fontSize: 10.5, marginTop: 4 }}>
        <span>1</span><span>{Math.ceil(n / 2)}</span><span>{n}</span>
      </div>
    </div>
  );
}

/**
 * Twelve columns, one per month, each a button into that month. The count sits
 * above its bar so the number is read, not estimated. Months still to come are
 * a quiet dot and cannot be opened.
 */
function MonthBars({ counts, year, currentMonth, selected, label, onOpen }: {
  counts: number[]; year: string; currentMonth: string; selected: string; label: string;
  onOpen: (month: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const max = Math.max(1, ...counts);
  /* Letters where a letter is a month name; digits where the language's short
     form would not fit twelve narrow columns on a phone. */
  const short = (i: number) => (locale === "en"
    ? new Date(2026, i, 1).toLocaleDateString(intlTag(locale), { month: "narrow" })
    : String(i + 1));

  return (
    <div role="group" aria-label={label} className="mt-4"
      style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 4, alignItems: "end" }}>
      {counts.map((c, i) => {
        const m = `${year}-${pad(i + 1)}`;
        const future = m > currentMonth;
        const name = monthTitleFor(m, locale);
        const h = c ? 6 + (c / max) * 58 : 2;
        const content = (
          <>
            <span className="num" style={{ fontSize: 10.5, minHeight: 14, color: c ? "var(--muted)" : "transparent" }}>
              {c || "0"}
            </span>
            <span style={{
              display: "block", width: "100%", maxWidth: 22, height: h, borderRadius: 3,
              background: c ? "var(--accent)" : "var(--line)",
              opacity: future ? 0.35 : m === selected ? 1 : c ? 0.72 : 1,
            }} />
            <span className="faint num" style={{ fontSize: 10.5, marginTop: 5 }}>{short(i)}</span>
          </>
        );
        const column = { display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "flex-end", minWidth: 0 };
        return future ? (
          <div key={m} style={column} aria-hidden="true">{content}</div>
        ) : (
          <button key={m} type="button" onClick={() => onOpen(m)}
            aria-label={t.insights.accomplishments.openMonth(name, c)}
            style={{ ...column, background: "none", border: "none", padding: "4px 0", cursor: "pointer", borderRadius: 8,
              outlineOffset: 1 }}>
            {content}
          </button>
        );
      })}
    </div>
  );
}
