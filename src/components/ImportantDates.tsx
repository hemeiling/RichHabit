"use client";
import { useEffect, useMemo, useState } from "react";
import { useHabits } from "@/components/store";
import { Field, Sheet } from "@/components/ui";
import { uid } from "@/lib/habits";
import { addMonths, monthGrid, monthOf, todayISO } from "@/lib/dates";
import { dateRangeFor, monthTitleFor, prettyDateFor } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/context";
import {
  DEFAULT_EVENT_COLOR, EVENT_COLORS, EVENT_KINDS, MAX_EVENT_NOTE, MAX_EVENT_TITLE,
  colorHex, covers, eventLength, eventProblem, eventsOn, layoutWeekCapped, upcomingEvents,
  withEnd, withStart,
} from "@/lib/importantDates";
import type { EventBar, EventKind } from "@/lib/importantDates";
import type { Dict } from "@/lib/i18n";
import type { ImportantDate } from "@/lib/types";

/**
 * §26. Important Dates — the trips, deadlines and occasions this person cares
 * about, beside the day they are working through.
 *
 * Deliberately small. Two months by default because that is the horizon a
 * person actually plans against, navigation for everything beyond it, and no
 * times, invitations, recurrence or reminders — a calendar you glance at, not
 * one you administer. Everything here is private: nothing reaches Community
 * Progress, another account, or an admin screen.
 *
 * The rules live in lib/importantDates.ts. This file is the interaction.
 */

/** How many bars one day cell can show before it says "+n" instead. */
const MAX_LANES = 3;
/** How many upcoming events fit in the rail before the list offers the rest. */
const UPCOMING = 5;
const UPCOMING_EXPANDED = 20;

/**
 * Today, kept honest without polling.
 *
 * The default window is derived from the current date rather than stored, so it
 * rolls forward on its own — but a tab left open overnight would keep rendering
 * yesterday's idea of "this month" until something else caused a render. A
 * laptop reopened the next morning fires both of these, which is the case that
 * actually happens; nothing ticks in the background for a panel nobody is
 * looking at.
 */
function useToday(): string {
  const [day, setDay] = useState(todayISO());
  useEffect(() => {
    const check = () => setDay((d) => (todayISO() === d ? d : todayISO()));
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, []);
  return day;
}

/** A stored kind, as a label. Unknown keys (an older or newer build) read as
 *  no kind at all rather than as a bare key on screen. */
const kindLabel = (kind: string, t: Dict): string | null =>
  (kind && kind !== "none" && kind in t.importantDates.kinds
    ? t.importantDates.kinds[kind as EventKind] : null);

const blankEvent = (date: string): ImportantDate => ({
  id: uid(),
  title: "",
  startDate: date,
  endDate: date,
  note: "",
  color: DEFAULT_EVENT_COLOR,
  kind: "none",
});

/* ------------------------------ the calendar ------------------------------ */

function MonthGrid({
  month, events, today, onPickDay,
}: {
  month: string; events: ImportantDate[]; today: string;
  onPickDay: (date: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const weeks = useMemo(() => monthGrid(month), [month]);

  return (
    <div className="cal" role="group" aria-label={t.importantDates.monthGrid(monthTitleFor(month, locale))}>
      <div className="cal-caption">{monthTitleFor(month, locale)}</div>
      <div className="cal-row" aria-hidden="true">
        {t.days.initial.map((d, i) => <div key={i} className="cal-head">{d}</div>)}
      </div>

      {weeks.map((week) => {
        const { bars, hidden } = layoutWeekCapped(events, week, MAX_LANES);
        const lanes = Math.min(MAX_LANES, Math.max(0, ...bars.map((b) => b.lane + 1)));
        return (
          <div key={week[0]}>
            <div className="cal-row">
              {week.map((date) => {
                const count = events.filter((e) => covers(e, date)).length;
                return (
                  <button
                    key={date}
                    type="button"
                    className="cal-day"
                    data-outside={monthOf(date) !== month || undefined}
                    data-today={date === today || undefined}
                    onClick={() => onPickDay(date)}
                    aria-label={t.importantDates.dayLabel(prettyDateFor(date, locale), count)}
                  >
                    {Number(date.slice(8, 10))}
                    {hidden[date] ? (
                      <span className="cal-more" aria-hidden="true">
                        {t.importantDates.moreOnDay(hidden[date])}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {/*
              * The bars for the whole week at once, in a grid that shares the
              * day columns. That is what makes a range look like one thing:
              * a five-day event is a single element spanning five columns, not
              * five marks that happen to be adjacent, and it keeps its lane
              * across the row. Decorative — the day button underneath is the
              * control, so there is no 5px tap target anywhere.
              */}
            {lanes > 0 && (
              <div className="cal-bars" style={{ gridTemplateRows: `repeat(${lanes}, 5px)` }}
                aria-hidden="true">
                {bars.map((b) => <Bar key={`${b.event.id}-${b.startIndex}`} bar={b} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Bar({ bar }: { bar: EventBar }) {
  const hex = colorHex(bar.event.color);
  return (
    <span
      className="cal-bar"
      title={bar.event.title}
      style={{
        gridColumn: `${bar.startIndex + 1} / ${bar.endIndex + 2}`,
        gridRow: bar.lane + 1,
        background: hex,
        // Square where the range carries on past this row, round where it
        // genuinely begins or ends. The shape is the only thing telling you
        // whether Saturday was the end of the trip or the middle of it.
        borderTopLeftRadius: bar.continuesBefore ? 0 : 3,
        borderBottomLeftRadius: bar.continuesBefore ? 0 : 3,
        borderTopRightRadius: bar.continuesAfter ? 0 : 3,
        borderBottomRightRadius: bar.continuesAfter ? 0 : 3,
      }}
    />
  );
}

/* ------------------------------- the editor ------------------------------- */

function EventEditor({
  event, isNew, onSave, onDelete, onClose, onBack,
}: {
  event: ImportantDate; isNew: boolean;
  onSave: (e: ImportantDate) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  /** Present only when this was opened from a day that had other events on it. */
  onBack?: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(event);
  const [tried, setTried] = useState(false);
  const [custom, setCustom] = useState(draft.color.startsWith("#"));
  const problem = eventProblem(draft);

  const save = () => {
    setTried(true);
    if (problem) return;
    onSave({ ...draft, title: draft.title.trim(), note: draft.note.trim() });
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? t.importantDates.newTitle : t.importantDates.editTitle}
      footer={
        <>
          {!isNew && (
            <button
              className="btn btn-danger" style={{ marginRight: "auto" }}
              onClick={() => {
                if (window.confirm(t.importantDates.confirmDelete)) { onDelete(event.id); onClose(); }
              }}
            >
              {t.importantDates.deleteEvent}
            </button>
          )}
          {onBack && <button className="btn" onClick={onBack}>{t.common.back}</button>}
          <button className="btn" onClick={onClose}>{t.common.cancel}</button>
          <button className="btn btn-primary" onClick={save}>{t.common.save}</button>
        </>
      }
    >
      <Field label={t.importantDates.eventTitle}>
        <input
          className="input" autoFocus maxLength={MAX_EVENT_TITLE}
          placeholder={t.importantDates.titlePlaceholder}
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
        />
      </Field>

      {/*
        * Two dates, always both shown. A "runs more than one day" toggle would
        * be one fewer control and one more thing to discover; a range that is
        * already visible can be extended by typing into it.
        */}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.importantDates.start}>
          <input
            className="input num" type="date" value={draft.startDate}
            onChange={(e) => e.target.value && setDraft(withStart(draft, e.target.value))}
          />
        </Field>
        <Field label={t.importantDates.end}>
          <input
            className="input num" type="date" value={draft.endDate} min={draft.startDate}
            onChange={(e) => e.target.value && setDraft(withEnd(draft, e.target.value))}
          />
        </Field>
      </div>
      <p className="faint" style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>
        {t.importantDates.length(Math.max(1, eventLength(draft)))}
      </p>

      <Field label={t.importantDates.colour}>
        <div className="flex flex-wrap items-center gap-2">
          {EVENT_COLORS.map((c) => (
            <button
              key={c.key} type="button" className="swatch"
              data-on={draft.color === c.key || undefined}
              style={{ background: c.hex }}
              aria-pressed={draft.color === c.key}
              aria-label={t.importantDates.colourNamed(t.importantDates.colours[c.key])}
              title={t.importantDates.colours[c.key]}
              onClick={() => { setCustom(false); setDraft({ ...draft, color: c.key }); }}
            />
          ))}
          {/* The escape hatch, not the main path: eight colours cover a
              personal calendar, and a picker is there for the ninth. */}
          <label className="swatch swatch-custom" data-on={custom || undefined}
            title={t.importantDates.customColour}>
            <input
              type="color"
              value={draft.color.startsWith("#") ? draft.color : colorHex(draft.color)}
              aria-label={t.importantDates.customColour}
              onChange={(e) => { setCustom(true); setDraft({ ...draft, color: e.target.value }); }}
            />
          </label>
        </div>
      </Field>

      <Field label={`${t.importantDates.kind} · ${t.common.optional}`}>
        <div className="flex flex-wrap gap-1.5">
          {EVENT_KINDS.map((k) => (
            <button
              key={k} type="button" className="chip" data-on={draft.kind === k}
              style={{ padding: "5px 11px", fontSize: 12.5 }}
              onClick={() => setDraft({ ...draft, kind: k })}
            >
              {t.importantDates.kinds[k]}
            </button>
          ))}
        </div>
      </Field>

      <Field label={`${t.importantDates.note} · ${t.common.optional}`}>
        <textarea
          className="textarea" rows={2} maxLength={MAX_EVENT_NOTE}
          placeholder={t.importantDates.notePlaceholder}
          value={draft.note}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        />
      </Field>

      {/* Shown once saving has been attempted, so an unfinished form is not
          scolding somebody halfway through typing. */}
      {tried && problem && (
        <p role="alert" style={{ color: "var(--warn)", fontSize: 13 }}>
          {t.importantDates.problems[problem]}
        </p>
      )}
    </Sheet>
  );
}

/* -------------------------------- the day --------------------------------- */

/**
 * What is on one day, when there is more than one thing.
 *
 * A day with nothing on it goes straight to the editor, and a day with a single
 * event opens that event — this only exists for the case where a choice has to
 * be made, which is the only case where a list is faster than a guess.
 */
function DaySheet({
  date, events, onPick, onAdd, onClose,
}: {
  date: string; events: ImportantDate[];
  onPick: (e: ImportantDate) => void; onAdd: () => void; onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <Sheet open onClose={onClose} title={t.importantDates.dayTitle(prettyDateFor(date, locale))}>
      <div className="divide">
        {events.map((e) => (
          <button key={e.id} className="event-row" onClick={() => onPick(e)}
            aria-label={t.importantDates.open(e.title)}>
            <span className="event-dot" style={{ background: colorHex(e.color) }} aria-hidden="true" />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 15, overflowWrap: "anywhere" }}>{e.title}</span>
              <span className="faint num block" style={{ fontSize: 12 }}>
                {dateRangeFor(e.startDate, e.endDate, locale)}
                {kindLabel(e.kind, t) && ` · ${kindLabel(e.kind, t)}`}
              </span>
            </span>
          </button>
        ))}
      </div>
      <button className="btn w-full mt-4" onClick={onAdd}>+ {t.importantDates.add}</button>
    </Sheet>
  );
}

/* -------------------------------- the panel ------------------------------- */

export default function ImportantDates() {
  const { state, actions } = useHabits();
  const t = useT();
  const locale = useLocale();
  const today = useToday();

  /**
   * The window is an offset from the current month, never an absolute month.
   * That is the whole of the automatic rollover: when the date changes, "two
   * months from now" changes with it, and a panel left on its default needs no
   * correcting.
   */
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ event: ImportantDate; isNew: boolean } | null>(null);

  const events = state.importantDates;
  const unavailable = state.unavailable.includes("importantDates");
  const base = addMonths(monthOf(today), offset);
  const months = [base, addMonths(base, 1)];

  const upcoming = useMemo(
    () => upcomingEvents(events, today, expanded ? UPCOMING_EXPANDED : UPCOMING),
    [events, today, expanded],
  );
  const upcomingTotal = useMemo(
    () => upcomingEvents(events, today, Number.MAX_SAFE_INTEGER).length,
    [events, today],
  );

  /**
   * One tap from a day to the thing you meant: an empty day is a new event on
   * that day, a day with one event is that event, and only a day with a choice
   * on it shows a list. No screen changes and nothing navigates.
   */
  const pickDay = (date: string) => {
    const on = eventsOn(events, date);
    if (on.length === 0) setEditing({ event: blankEvent(date), isNew: true });
    else if (on.length === 1) setEditing({ event: on[0], isNew: false });
    else setDay(date);
  };

  const close = () => { setEditing(null); setDay(null); };

  return (
    <section className="card p-4" aria-labelledby="important-dates-title">
      <div className="flex items-baseline justify-between gap-2">
        <div className="eyebrow" id="important-dates-title" style={{ fontSize: 10 }}>
          📍 {t.importantDates.title}
        </div>
        <div className="flex items-center gap-0.5" style={{ flex: "none" }}>
          <button className="btn btn-quiet" style={{ padding: "3px 8px", fontSize: 14 }}
            onClick={() => setOffset((n) => n - 1)} aria-label={t.importantDates.previousMonths}>‹</button>
          <button className="btn btn-quiet" style={{ padding: "3px 8px", fontSize: 11.5 }}
            onClick={() => setOffset(0)} disabled={offset === 0}
            aria-label={t.importantDates.backToNow}>{t.importantDates.backToNow}</button>
          <button className="btn btn-quiet" style={{ padding: "3px 8px", fontSize: 14 }}
            onClick={() => setOffset((n) => n + 1)} aria-label={t.importantDates.nextMonths}>›</button>
        </div>
      </div>

      {/*
        * Unavailable is not the same as empty. If the table has not been
        * created yet the panel says so rather than showing a calendar with
        * nothing on it — the app has already been bitten once by a missing
        * table reading as an account with no data in it.
        */}
      {unavailable ? (
        <p className="muted mt-3" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          {t.importantDates.unavailable}
        </p>
      ) : (
        <>
          {/* One column in the 300px rail, two wherever the panel is wider —
              which is what a phone or a tablet gives it once the rail has
              collapsed into the page. No breakpoint to keep in step. */}
          <div className="cal-months mt-3">
            {months.map((month) => (
              <MonthGrid key={month} month={month} events={events} today={today}
                onPickDay={pickDay} />
            ))}
          </div>

          <div className="mt-3">
            <div className="eyebrow" style={{ fontSize: 10 }}>{t.importantDates.upcoming}</div>
            {upcoming.length === 0 ? (
              <p className="muted mt-1.5" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                {events.length === 0 ? t.importantDates.empty : t.importantDates.nothingUpcoming}
              </p>
            ) : (
              <div className="mt-1">
                {upcoming.map((e) => (
                  <button key={e.id} className="event-row" onClick={() => setEditing({ event: e, isNew: false })}
                    aria-label={t.importantDates.open(e.title)}>
                    <span className="event-dot" style={{ background: colorHex(e.color) }} aria-hidden="true" />
                    <span className="event-line">
                      <span className="num faint event-when" style={{ fontSize: 11.5 }}>
                        {dateRangeFor(e.startDate, e.endDate, locale)}
                        {covers(e, today) && (
                          <span style={{ color: "var(--accent)", marginLeft: 5 }}>
                            {e.startDate === e.endDate
                              ? t.importantDates.todayTag : t.importantDates.onNow}
                          </span>
                        )}
                      </span>
                      <span className="event-what" style={{ fontSize: 13.5 }}>{e.title}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* The rail stays compact by default; the rest is one tap away
                rather than gone. */}
            {upcomingTotal > UPCOMING && (
              <button className="btn btn-quiet mt-1" style={{ padding: "3px 8px", fontSize: 11.5 }}
                onClick={() => setExpanded((v) => !v)}>
                {expanded
                  ? t.importantDates.showFewer
                  : t.importantDates.showMore(upcomingTotal - UPCOMING)}
              </button>
            )}
          </div>

          <button className="btn w-full mt-3" style={{ padding: "6px 12px", fontSize: 12.5 }}
            onClick={() => setEditing({ event: blankEvent(today), isNew: true })}>
            + {t.importantDates.add}
          </button>
        </>
      )}

      {day && !editing && (
        <DaySheet
          date={day}
          events={eventsOn(events, day)}
          onPick={(e) => setEditing({ event: e, isNew: false })}
          onAdd={() => setEditing({ event: blankEvent(day), isNew: true })}
          onClose={close}
        />
      )}

      {editing && (
        <EventEditor
          event={editing.event}
          isNew={editing.isNew}
          onSave={actions.saveImportantDate}
          onDelete={actions.deleteImportantDate}
          onClose={close}
          onBack={day ? () => setEditing(null) : undefined}
        />
      )}
    </section>
  );
}
