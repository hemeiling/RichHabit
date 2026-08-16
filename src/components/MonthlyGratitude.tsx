"use client";
import { useMemo, useState } from "react";
import { useHabits } from "@/components/store";
import { Empty } from "@/components/ui";
import { useLocale, useT } from "@/lib/i18n/context";
import { shortDateFor } from "@/lib/i18n";
import { todayISO } from "@/lib/dates";
import { monthOf, previousMonth } from "@/lib/spending";

/**
 * The month's journal, read back.
 *
 * The daily side is meant to be over in twenty seconds; this is the other half
 * — where a month of small entries becomes something worth reading. It is a
 * review, not an analysis: entries appear as they were written, newest first,
 * and nothing is scored, ranked or interpreted.
 *
 * The month arithmetic is the same `YYYY-MM` string maths the spending module
 * uses, for the same reason: `Date.setMonth` lands on March 3 when today is
 * March 31.
 */

const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

const daysInMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

/** "2026-08" in the reader's language, without inventing a day. */
function monthLabel(month: string, locale: string): string {
  const [y, m] = month.split("-").map(Number);
  const tag = locale === "zh" ? "zh-CN" : "en-US";
  return new Date(y, m - 1, 1).toLocaleDateString(tag, { year: "numeric", month: "long" });
}

export default function MonthlyGratitude() {
  const { state, actions } = useHabits();
  const t = useT();
  const locale = useLocale();

  const thisMonth = monthOf(todayISO());
  const [month, setMonth] = useState(thisMonth);
  const [open, setOpen] = useState<string | null>(null);

  /** Every day of the chosen month that has something written on it. */
  const days = useMemo(() => Object.entries(state.journal)
    .filter(([date, entry]) => monthOf(date) === month
      && (entry.gratitude.length > 0 || entry.reflection.trim()))
    .sort(([a], [b]) => b.localeCompare(a)), [state.journal, month]);

  const entryCount = days.reduce((n, [, e]) => n + e.gratitude.length, 0);
  const reflection = state.monthlyReflections[month] ?? "";
  const atCurrent = month === thisMonth;

  return (
    <>
      <section className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="eyebrow">{t.journal.monthlyTitle}</div>
          <div className="flex items-center gap-1">
            <button className="btn btn-quiet" style={{ padding: "5px 10px" }}
              aria-label={t.journal.previousMonth}
              onClick={() => { setMonth(previousMonth(month)); setOpen(null); }}>‹</button>
            <span className="num" style={{ fontSize: 13.5, minWidth: 96, textAlign: "center" }}>
              {monthLabel(month, locale)}
            </span>
            <button className="btn btn-quiet" style={{ padding: "5px 10px" }}
              aria-label={t.journal.nextMonth} disabled={atCurrent}
              onClick={() => { setMonth(nextMonth(month)); setOpen(null); }}>›</button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="flat p-3.5">
            <div className="eyebrow" style={{ fontSize: 10, letterSpacing: "0.06em" }}>
              {t.journal.daysJournaled}
            </div>
            <div className="display num mt-1" style={{ fontSize: 22 }}>
              {t.journal.ofDays(days.length, daysInMonth(month))}
            </div>
          </div>
          <div className="flat p-3.5">
            <div className="eyebrow" style={{ fontSize: 10, letterSpacing: "0.06em" }}>
              {t.journal.entries}
            </div>
            <div className="display num mt-1" style={{ fontSize: 22 }}>{entryCount}</div>
          </div>
        </div>

        {days.length === 0 ? (
          <div className="mt-3">
            <Empty title={t.journal.empty} body={t.journal.emptyBody} />
          </div>
        ) : (
          <div className="divide mt-3">
            {days.map(([date, entry]) => {
              const expanded = open === date;
              // A day is short enough to show whole unless it has a reflection
              // or a long list; then it is worth opening deliberately.
              const preview = entry.gratitude.slice(0, expanded ? undefined : 3);
              const more = entry.gratitude.length - preview.length;
              return (
                <div key={date} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="num" style={{ fontSize: 13.5 }}>
                      {shortDateFor(date, locale)}
                    </span>
                    {(more > 0 || entry.reflection.trim()) && (
                      <button className="btn btn-quiet"
                        style={{ padding: "2px 9px", fontSize: 12.5 }}
                        onClick={() => setOpen(expanded ? null : date)}>
                        {expanded ? t.journal.collapse : t.journal.expand}
                      </button>
                    )}
                  </div>
                  <ul className="mt-1" style={{ fontSize: 14.5, lineHeight: 1.65 }}>
                    {preview.map((g, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="faint">•</span><span>{g}</span>
                      </li>
                    ))}
                    {more > 0 && <li className="faint" style={{ fontSize: 13 }}>+{more}</li>}
                  </ul>
                  {expanded && entry.reflection.trim() && (
                    <p className="muted mt-2" style={{ fontSize: 13.5, lineHeight: 1.55,
                      whiteSpace: "pre-wrap" }}>{entry.reflection}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card p-5">
        <div className="eyebrow">{t.journal.reflectTitle}</div>
        <p className="muted mt-1.5" style={{ fontSize: 14, lineHeight: 1.5 }}>
          {t.journal.reflectIntro}
        </p>
        {/* Prompts, not questions to answer. Nobody has to use them. */}
        <ul className="faint mt-2" style={{ fontSize: 13, lineHeight: 1.7 }}>
          {t.journal.prompts.map((p) => (
            <li key={p} className="flex gap-2"><span>·</span><span>{p}</span></li>
          ))}
        </ul>
        <textarea
          className="textarea mt-3" rows={4} value={reflection}
          placeholder={t.journal.reflectPlaceholder}
          onChange={(e) => actions.setMonthlyReflection(month, e.target.value)}
        />
        <p className="faint mt-2" style={{ fontSize: 12 }}>{t.journal.autosaves}</p>
      </section>
    </>
  );
}
