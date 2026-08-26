"use client";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useHabits } from "@/components/store";
import { Field, GrowingTextarea, Sheet } from "@/components/ui";
import { uid } from "@/lib/habits";
import { addMonths, monthFirst, monthGrid, monthOf, todayISO } from "@/lib/dates";
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
/**
 * How many upcoming events fit in the rail before the list offers the rest.
 * Expanding then shows *everything* — the button names the number it is about
 * to reveal, and a list that quietly stopped at twenty would be a cap nobody
 * was told about.
 */
const UPCOMING = 5;

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

/**
 * Memoised, and not as a reflex.
 *
 * Today re-renders on every tick of a habit — the store hands out a new state
 * object each time — and a month grid formats a date per cell for its label:
 * 84 across the two months, 168 in bilingual mode, measured at 3-4ms on a
 * laptop and several times that on a phone. None of it can have changed
 * because a habit was ticked, so none of it should be redone. `onPickDay` is
 * wrapped in `useCallback` below to make this hold; the language still repaints
 * it, because that arrives through context rather than through props.
 */
const MonthGrid = memo(function MonthGrid({
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
});

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

      {/*
        * The note is where the event actually gets written down — flights, an
        * address, an agenda, whatever was emailed over. It grows as it is
        * typed or pasted and then scrolls inside itself, so the dialog stays a
        * dialog. No `maxLength`: see `eventProblem`.
        */}
      <Field label={`${t.importantDates.note} · ${t.common.optional}`}>
        <GrowingTextarea
          rows={3}
          maxHeight="38vh"
          placeholder={t.importantDates.notePlaceholder}
          value={draft.note}
          onChange={(note) => setDraft({ ...draft, note })}
        />
        {/* Silent until it is nearly relevant. A counter under every note would
            be pressure to be brief, which is the opposite of the point. */}
        {draft.note.length > MAX_EVENT_NOTE * 0.9 && (
          <div className="faint num mt-1" style={{
            fontSize: 12,
            color: draft.note.length > MAX_EVENT_NOTE ? "var(--warn)" : undefined,
          }}>
            {t.importantDates.noteLength(draft.note.length, MAX_EVENT_NOTE)}
          </div>
        )}
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
 * What is on one day.
 *
 * Shown for any day that has something on it, whether that is one thing or
 * five, and it always offers to add another — which is the point. A day with
 * nothing on it skips this and opens a new event directly, because there is
 * nothing to choose between.
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
                {/* Which of the day's events is the one with the details in it. */}
                {e.note.trim() && ` · ${t.importantDates.hasNote}`}
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

  const all = useMemo(() => upcomingEvents(events, today, Number.MAX_SAFE_INTEGER), [events, today]);
  const upcoming = expanded ? all : all.slice(0, UPCOMING);

  /**
   * One rule for tapping a day: an empty day is a new event on it, and a day
   * with anything on it shows what that is.
   *
   * The obvious shortcut — open the single event directly when there is only
   * one — was there and is deliberately gone. It saved a tap and cost a way
   * out: a day already holding one event had no path to a second, because
   * every tap on it landed in the existing event's editor. Editing in one tap
   * is what the upcoming list is for.
   */
  const pickDay = useCallback((date: string) => {
    if (eventsOn(events, date).length === 0) {
      setEditing({ event: blankEvent(date), isNew: true });
    } else {
      setDay(date);
    }
  }, [events]);

  /**
   * Where "+ Add an event" starts.
   *
   * Today, while today is on screen — which is the common case and the obvious
   * answer. Once someone has navigated to March, though, an event dated today
   * would be created outside the calendar they are looking at, so it starts on
   * the 1st of the first month in view instead.
   */
  const addFrom = monthOf(today) === base || monthOf(today) === months[1]
    ? today : monthFirst(base);

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
            {all.length > UPCOMING && (
              <button className="btn btn-quiet mt-1" style={{ padding: "3px 8px", fontSize: 11.5 }}
                onClick={() => setExpanded((v) => !v)}>
                {expanded
                  ? t.importantDates.showFewer
                  : t.importantDates.showMore(all.length - UPCOMING)}
              </button>
            )}
          </div>

          <button className="btn w-full mt-3" style={{ padding: "6px 12px", fontSize: 12.5 }}
            onClick={() => setEditing({ event: blankEvent(addFrom), isNew: true })}>
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
          key={editing.event.id}
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
