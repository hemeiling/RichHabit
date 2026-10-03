"use client";
import { useToday } from "@/components/useToday";
import { memo, useCallback, useMemo, useState } from "react";
import { useHabits } from "@/components/store";
import { Field, GrowingTextarea, Sheet } from "@/components/ui";
import { uid } from "@/lib/habits";
import { addDays, addMonths, monthFirst, monthGrid, monthOf } from "@/lib/dates";
import {
  clockTimeFor, dateRangeFor, monthTitleFor, prettyDateFor, shortDateFor, zoneLabelFor,
} from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/context";
import {
  DEFAULT_EVENT_COLOR, EVENT_COLORS, EVENT_KINDS, KIND_EMOJI, MAX_EVENT_NOTE, MAX_EVENT_TITLE,
  ONE_OFF_ALL_DAY, REPEAT_PRESETS,
  colorHex, covers, eventLength, eventProblem, isAllDay, layoutWeekCapped, repeatPreset, ruleFor,
  suggestedStartTime, withAllDay, withEnd, withEndTime, withKind, withStart, withStartTime,
} from "@/lib/importantDates";
import type { EventBar, EventKind } from "@/lib/importantDates";
import { MAX_REPEAT_INTERVAL, addMonthsClamped } from "@/lib/recurrence";
import { dayAgenda, importantDateItems, upcomingItems } from "@/lib/calendar";
import type { AgendaRow, CalendarItem } from "@/lib/calendar";
import { deviceTimeZone, zonedToInstant } from "@/lib/zonedTime";
import type { Dict, Locale } from "@/lib/i18n";
import type { ImportantDate, RepeatRule, RepeatUnit } from "@/lib/types";

/**
 * §26. Important Dates — the trips, birthdays, deadlines and appointments this
 * person cares about, beside the day they are working through.
 *
 * Still deliberately small. The month is an overview: bars, never times or
 * titles crammed into cells. Tapping any date opens that day's agenda, which is
 * where times are read — all-day things first, because a birthday or a trip
 * frames the whole day, then everything with a time, in time order. An event
 * can repeat (every week, month or year, or every N of them), and a repeating
 * event is still one row; its occurrences are computed.
 *
 * Everything drawn here is a `CalendarItem` (lib/calendar), not an
 * `ImportantDate`: this panel draws a calendar, and Important Dates are its one
 * source today. Everything here is private: nothing reaches Community
 * Progress, another account, an admin screen or an AI provider.
 *
 * The rules live in lib/importantDates.ts, lib/recurrence.ts and
 * lib/calendar.ts. This file is the interaction.
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

/** A stored kind, as a label. Unknown keys (an older or newer build) read as
 *  no kind at all rather than as a bare key on screen. */
const kindLabel = (kind: string, t: Dict): string | null =>
  (kind && kind !== "none" && kind in t.importantDates.kinds
    ? t.importantDates.kinds[kind as EventKind] : null);

/** The title as shown: the kind's emoji in front, the person's words untouched. */
const shownTitle = (title: string, kind: string) =>
  (KIND_EMOJI[kind] ? `${KIND_EMOJI[kind]} ${title}` : title);

const repeatText = (rule: RepeatRule | null, t: Dict, locale: Locale): string | null => {
  if (!rule) return null;
  const every = t.importantDates.repeatSummary[rule.unit](rule.interval);
  return rule.until ? `${every} ${t.importantDates.repeatUntil(shortDateFor(rule.until, locale))}` : every;
};

const blankEvent = (date: string): ImportantDate => ({
  id: uid(),
  title: "",
  startDate: date,
  endDate: date,
  note: "",
  color: DEFAULT_EVENT_COLOR,
  kind: "none",
  ...ONE_OFF_ALL_DAY,
});

/** What the editor is open on: the series, and which occurrence was tapped. */
interface Editing { event: ImportantDate; isNew: boolean; occurrence: string | null }

/* ------------------------------ the calendar ------------------------------ */

/**
 * Memoised, and not as a reflex.
 *
 * Today re-renders on every tick of a habit — the store hands out a new state
 * object each time — and a month grid formats a date per cell for its label and
 * now expands every repeating event for the six weeks it shows. None of it can
 * have changed because a habit was ticked, so none of it should be redone.
 * `onPickDay` is wrapped in `useCallback` below to make this hold; the language
 * still repaints it, because that arrives through context rather than props.
 */
const MonthGrid = memo(function MonthGrid({
  month, events, viewerZone, today, onPickDay,
}: {
  month: string; events: ImportantDate[]; viewerZone: string | null; today: string;
  onPickDay: (date: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const weeks = useMemo(() => monthGrid(month), [month]);
  const items = useMemo(
    () => importantDateItems(events, weeks[0][0], weeks[weeks.length - 1][6], viewerZone),
    [events, weeks, viewerZone]);

  return (
    <div className="cal" role="group" aria-label={t.importantDates.monthGrid(monthTitleFor(month, locale))}>
      <div className="cal-caption">{monthTitleFor(month, locale)}</div>
      <div className="cal-row" aria-hidden="true">
        {t.days.initial.map((d, i) => <div key={i} className="cal-head">{d}</div>)}
      </div>

      {weeks.map((week) => {
        const { bars, hidden } = layoutWeekCapped(items, week, MAX_LANES);
        const lanes = Math.min(MAX_LANES, Math.max(0, ...bars.map((b) => b.lane + 1)));
        return (
          <div key={week[0]}>
            <div className="cal-row">
              {week.map((date) => {
                const count = items.filter((e) => covers(e, date)).length;
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

function Bar({ bar }: { bar: EventBar<CalendarItem> }) {
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
  editing, viewerZone, today, onSave, onDelete, onDeleteOccurrence, onClose, onBack,
}: {
  editing: Editing;
  viewerZone: string | null;
  today: string;
  onSave: (e: ImportantDate) => void;
  onDelete: (id: string) => void;
  onDeleteOccurrence: (id: string, on: string) => void;
  onClose: () => void;
  /** Present only when this was opened from a day's agenda. */
  onBack?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { event, isNew, occurrence } = editing;
  const [draft, setDraft] = useState(event);
  const [tried, setTried] = useState(false);
  const [custom, setCustom] = useState(draft.color.startsWith("#"));
  /** Whether the person has chosen a repeat here — a birthday then never overrides it. */
  const [repeatChosen, setRepeatChosen] = useState(!isNew);
  const [customOpen, setCustomOpen] = useState(repeatPreset(draft.repeat) === "custom");
  /**
   * The times last typed — and the zone they were meant in — kept while All day
   * is on, so turning it off again restores the event exactly. Without the zone,
   * a Chicago 7 PM toggled on and off on a New York phone would come back as a
   * New York 7 PM.
   */
  const [lastTimes, setLastTimes] = useState(
    { start: draft.startTime, end: draft.endTime, zone: draft.timeZone });
  const [askDelete, setAskDelete] = useState(false);
  const problem = eventProblem(draft);
  const timed = !isAllDay(draft);
  const wasRepeating = !isNew && event.repeat != null;

  const save = () => {
    setTried(true);
    if (problem) return;
    onSave({
      ...draft,
      title: draft.title.trim(),
      note: draft.note.trim(),
      // A time is meant somewhere. The event keeps the zone it was set in; a
      // new time takes this device's.
      timeZone: timed ? draft.timeZone ?? viewerZone : null,
    });
    onClose();
  };

  const setAllDay = (allDay: boolean) => {
    if (allDay) {
      setLastTimes({ start: draft.startTime, end: draft.endTime, zone: draft.timeZone });
      setDraft(withAllDay(draft, true, "", null, null));
    } else {
      setDraft(withAllDay(draft, false,
        lastTimes.start ?? suggestedStartTime(draft.startDate, today), lastTimes.end,
        lastTimes.zone ?? viewerZone));
    }
  };

  const pickPreset = (preset: (typeof REPEAT_PRESETS)[number]) => {
    setRepeatChosen(true);
    setCustomOpen(preset === "custom");
    setDraft({ ...draft, repeat: ruleFor(preset, draft.repeat) });
  };
  const setRule = (patch: Partial<RepeatRule>) =>
    setDraft({ ...draft, repeat: { ...(draft.repeat ?? { unit: "week", interval: 1, until: null }), ...patch } });

  const preset = customOpen ? "custom" : repeatPreset(draft.repeat);
  const otherZone = timed && draft.timeZone && viewerZone && draft.timeZone !== viewerZone
    ? draft.timeZone : null;

  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? t.importantDates.newTitle : t.importantDates.editTitle}
      footer={askDelete && occurrence ? (
        /*
         * The two deletes a repeating event has, and nothing else: this one
         * date, or the whole series. Shown in place of the footer so the
         * choice sits where the Delete button was.
         */
        <div className="w-full">
          <div className="eyebrow mb-2">{t.importantDates.deleteWhich}</div>
          <div className="flex flex-wrap gap-2 justify-end">
            <button className="btn" onClick={() => setAskDelete(false)}>{t.common.cancel}</button>
            <button className="btn btn-danger"
              onClick={() => { onDeleteOccurrence(event.id, occurrence); onClose(); }}>
              {t.importantDates.deleteThisOnly(shortDateFor(occurrence, locale))}
            </button>
            <button className="btn btn-danger"
              onClick={() => { onDelete(event.id); onClose(); }}>
              {t.importantDates.deleteAll}
            </button>
          </div>
        </div>
      ) : (
        <>
          {!isNew && (
            <button
              className="btn btn-danger" style={{ marginRight: "auto" }}
              onClick={() => {
                if (wasRepeating && occurrence) { setAskDelete(true); return; }
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
      )}
    >
      {/* Editing a repeating event edits all of it — said before anything is changed. */}
      {wasRepeating && (
        <p className="faint" style={{ fontSize: 12.5, marginTop: -8, marginBottom: 12 }}>
          ↻ {repeatText(event.repeat, t, locale)} · {t.importantDates.editsAll}
        </p>
      )}

      <Field label={t.importantDates.eventTitle}>
        <input
          className="input" autoFocus={isNew} maxLength={MAX_EVENT_TITLE}
          placeholder={t.importantDates.titlePlaceholder}
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
        />
      </Field>

      {/*
        * Two dates, always both shown, and a time under each once the event is
        * not all day — a time belongs to its date, which is also what makes an
        * evening that runs past midnight read correctly.
        */}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.importantDates.start}>
          <input
            className="input num" type="date" value={draft.startDate}
            onChange={(e) => e.target.value && setDraft(withStart(draft, e.target.value))}
          />
          {timed && (
            <input
              className="input num mt-2" type="time" required value={draft.startTime ?? ""}
              aria-label={t.importantDates.startTime}
              onChange={(e) => e.target.value && setDraft(withStartTime(draft, e.target.value))}
            />
          )}
        </Field>
        <Field label={t.importantDates.end}>
          <input
            className="input num" type="date" value={draft.endDate} min={draft.startDate}
            onChange={(e) => e.target.value && setDraft(withEnd(draft, e.target.value))}
          />
          {timed && (draft.endTime != null ? (
            <div className="time-with-clear mt-2">
              <input
                className="input num" type="time" value={draft.endTime}
                aria-label={t.importantDates.endTime}
                onChange={(e) => setDraft(withEndTime(draft, e.target.value || null))}
              />
              <button type="button" className="btn btn-quiet" aria-label={t.importantDates.removeEndTime}
                title={t.importantDates.removeEndTime}
                onClick={() => setDraft({ ...draft, endTime: null })}>×</button>
            </div>
          ) : (
            <button type="button" className="btn btn-quiet mt-2 time-add"
              onClick={() => setDraft(withEndTime(draft, addHour(draft.startTime!)))}>
              + {t.importantDates.addEndTime}
            </button>
          ))}
        </Field>
      </div>

      <div className="flex items-center justify-between gap-3" style={{ marginTop: -4, marginBottom: 12 }}>
        <span className="faint" style={{ fontSize: 12 }}>
          {t.importantDates.length(Math.max(1, eventLength(draft)))}
          {timed && draft.endTime && draft.endDate !== draft.startDate && eventLength(draft) === 2
            && ` · ${t.importantDates.endsNextDay}`}
        </span>
        <label className="switch-row">
          <span>{t.importantDates.allDay}</span>
          <input type="checkbox" role="switch" className="switch" checked={!timed}
            onChange={(e) => setAllDay(e.target.checked)} />
        </label>
      </div>
      {otherZone && (
        <p className="faint" style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>
          {t.importantDates.timesIn(zoneLabelFor(otherZone, locale))}
        </p>
      )}

      {/* Before Repeat on purpose: picking 🎂 visibly sets "Every year" just below. */}
      <ChoiceGroup label={`${t.importantDates.kind} · ${t.common.optional}`}>
        <div className="flex flex-wrap gap-1.5">
          {EVENT_KINDS.map((k) => (
            <button
              key={k} type="button" className="chip" data-on={draft.kind === k}
              style={{ padding: "5px 11px", fontSize: 12.5 }}
              onClick={() => {
                const next = withKind(draft, k, repeatChosen);
                if (next.repeat !== draft.repeat) setCustomOpen(false);
                setDraft(next);
              }}
            >
              {KIND_EMOJI[k] ? `${KIND_EMOJI[k]} ` : ""}{t.importantDates.kinds[k]}
            </button>
          ))}
        </div>
      </ChoiceGroup>

      <ChoiceGroup label={t.importantDates.repeat}>
        <div className="flex flex-wrap gap-1.5">
          {REPEAT_PRESETS.map((p) => (
            <button
              key={p} type="button" className="chip" data-on={preset === p}
              style={{ padding: "5px 11px", fontSize: 12.5 }}
              aria-pressed={preset === p}
              onClick={() => pickPreset(p)}
            >
              {t.importantDates.repeatOptions[p]}
            </button>
          ))}
        </div>
      </ChoiceGroup>

      {/* Only after Custom: every N of a unit, and an optional last date. */}
      {preset === "custom" && draft.repeat && (
        <div className="repeat-custom">
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ fontSize: 13.5 }}>{t.importantDates.every}</span>
            <input
              className="input num" type="number" inputMode="numeric" min={1} max={MAX_REPEAT_INTERVAL}
              style={{ width: 72 }} aria-label={t.importantDates.intervalLabel}
              value={Number.isFinite(draft.repeat.interval) && draft.repeat.interval > 0 ? draft.repeat.interval : ""}
              onChange={(e) => setRule({ interval: e.target.value === "" ? 0 : Math.trunc(Number(e.target.value)) })}
            />
            <select
              className="select" style={{ width: "auto" }} aria-label={t.importantDates.unitLabel}
              value={draft.repeat.unit}
              onChange={(e) => setRule({ unit: e.target.value as RepeatUnit })}
            >
              {(["week", "month", "year"] as const).map((u) => (
                <option key={u} value={u}>{t.importantDates.units[u](draft.repeat!.interval || 1)}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-3">
            <span className="eyebrow" style={{ marginRight: 2 }}>{t.importantDates.repeatEnds}</span>
            <button type="button" className="chip" data-on={!draft.repeat.until}
              style={{ padding: "5px 11px", fontSize: 12.5 }}
              onClick={() => setRule({ until: null })}>
              {t.importantDates.endsNever}
            </button>
            <button type="button" className="chip" data-on={!!draft.repeat.until}
              style={{ padding: "5px 11px", fontSize: 12.5 }}
              onClick={() => setRule({ until: draft.repeat!.until ?? addMonthsClamped(draft.startDate, 12) })}>
              {t.importantDates.endsOn}
            </button>
            {draft.repeat.until && (
              <input
                className="input num" type="date" style={{ width: "auto" }}
                aria-label={t.importantDates.repeatEndDate}
                value={draft.repeat.until} min={draft.startDate}
                onChange={(e) => e.target.value && setRule({ until: e.target.value })}
              />
            )}
          </div>
        </div>
      )}

      <ChoiceGroup label={t.importantDates.colour}>
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
      </ChoiceGroup>

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

/**
 * A labelled row of choices — chips or swatches.
 *
 * Not a `Field`: that is a `<label>`, and a label lends its whole text to the
 * first control inside it, so the first chip of a row was announced as the
 * heading plus every other chip. A group with a heading names the row and
 * leaves each button its own name.
 */
function ChoiceGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block mb-3" role="group" aria-label={label}>
      <div className="eyebrow mb-1.5" aria-hidden="true">{label}</div>
      {children}
    </div>
  );
}

/** An hour later, stopping at 23:59 rather than wrapping into tomorrow. */
function addHour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return h >= 23 ? "23:59" : `${String(h + 1).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/* ------------------------------ the agenda -------------------------------- */

/**
 * One day, read in order: what frames the day first (birthdays, trips,
 * holidays, and the middle days of anything long), then everything with a
 * time, earliest first. Nobody arranges this by hand.
 *
 * Tapping any date opens this, empty or not — one interaction for the whole
 * month. An empty day says so plainly and puts Add right there, so the extra
 * tap is the obvious next step rather than a detour.
 */
function DayAgendaSheet({
  date, items, today, onPick, onAdd, onMove, onClose,
}: {
  date: string; items: CalendarItem[]; today: string;
  onPick: (item: CalendarItem) => void; onAdd: () => void;
  onMove: (date: string) => void; onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const agenda = useMemo(() => dayAgenda(items, date), [items, date]);
  const empty = agenda.allDay.length === 0 && agenda.timed.length === 0;

  return (
    <Sheet open onClose={onClose} title={t.importantDates.dayTitle(prettyDateFor(date, locale))}>
      <div className="flex items-center gap-1" style={{ marginTop: -8, marginBottom: 10 }}>
        <button className="btn btn-quiet" style={{ padding: "3px 10px", fontSize: 15 }}
          onClick={() => onMove(addDays(date, -1))} aria-label={t.importantDates.previousDay}>‹</button>
        <button className="btn btn-quiet" style={{ padding: "3px 10px", fontSize: 12 }}
          onClick={() => onMove(today)} disabled={date === today}>{t.importantDates.todayTag}</button>
        <button className="btn btn-quiet" style={{ padding: "3px 10px", fontSize: 15 }}
          onClick={() => onMove(addDays(date, 1))} aria-label={t.importantDates.nextDay}>›</button>
      </div>

      {empty ? (
        <div className="agenda-empty">
          <p className="muted">{t.importantDates.nothingPlanned}</p>
          <button className="btn btn-primary agenda-add" onClick={onAdd} autoFocus>
            + {t.importantDates.add}
          </button>
        </div>
      ) : (
        <>
          {agenda.allDay.length > 0 && (
            <section className="agenda-band" aria-label={t.importantDates.agendaAllDay}>
              <div className="eyebrow" style={{ fontSize: 10 }}>{t.importantDates.agendaAllDay}</div>
              {agenda.allDay.map((row) => (
                <AgendaLine key={row.item.id} row={row} onPick={onPick} />
              ))}
            </section>
          )}
          {agenda.timed.length > 0 && (
            <ol className="agenda-timed">
              {agenda.timed.map((row) => (
                <li key={row.item.id}><AgendaLine row={row} onPick={onPick} /></li>
              ))}
            </ol>
          )}
          <button className="btn w-full mt-4" onClick={onAdd}>+ {t.importantDates.add}</button>
        </>
      )}
    </Sheet>
  );
}

function AgendaLine({ row, onPick }: { row: AgendaRow; onPick: (item: CalendarItem) => void }) {
  const t = useT();
  const locale = useLocale();
  const { item, part } = row;
  const time = (v: string) => clockTimeFor(v, locale);

  /* The left column: a time for anything that has one today, nothing for all day. */
  const when = part === "single" || part === "start" ? time(item.startTime!)
    : part === "end" ? t.importantDates.untilTime(time(item.endTime!)) : null;

  /* The line under the title says only what the left column could not. */
  const details: string[] = [];
  if (part === "single" && item.endTime) {
    details.push(t.importantDates.timeRange(time(item.startTime!), time(item.endTime)));
  } else if (part === "start") {
    details.push(item.endTime
      ? `${t.importantDates.timeRange(time(item.startTime!), time(item.endTime))} · ${dateRangeFor(item.startDate, item.endDate, locale)}`
      : dateRangeFor(item.startDate, item.endDate, locale));
  } else if (part === "allDay" && !item.allDay) {
    details.push(t.importantDates.continues);
  }
  if (part === "allDay" && row.days > 1) details.push(t.importantDates.dayOf(row.day, row.days));
  if (item.original && (part === "single" || part === "start")) {
    // The zone named as a region ("Central Time"), never as the city in its id.
    const at = zonedToInstant(item.occurrenceDate, item.original.startTime, item.original.timeZone);
    details.push(t.importantDates.zoneTime(time(item.original.startTime),
      zoneLabelFor(item.original.timeZone, locale, at)));
  }
  const repeat = repeatText(item.repeat, t, locale);
  if (repeat) details.push(`↻ ${repeat}`);
  const kind = kindLabel(item.kind, t);
  if (kind && !KIND_EMOJI[item.kind]) details.push(kind);
  if (item.hasNote) details.push(t.importantDates.hasNote);

  return (
    <button className="agenda-row" onClick={() => onPick(item)}
      aria-label={t.importantDates.open(item.title)}>
      {when !== null || part !== "allDay"
        ? <span className="agenda-time num">{when}</span>
        : null}
      <span className="event-dot" style={{ background: colorHex(item.color) }} aria-hidden="true" />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="block" style={{ fontSize: 15, overflowWrap: "anywhere" }}>
          {shownTitle(item.title, item.kind)}
        </span>
        {details.length > 0 && (
          <span className="faint num block" style={{ fontSize: 12 }}>{details.join(" · ")}</span>
        )}
      </span>
    </button>
  );
}

/* -------------------------------- the panel ------------------------------- */

export default function ImportantDates() {
  const { state, actions } = useHabits();
  const t = useT();
  const locale = useLocale();
  const today = useToday();
  /** Read once per mount. Times are shown in the zone this device is in now. */
  const viewerZone = useMemo(() => deviceTimeZone(), []);

  /**
   * The month is an offset from the current one, never an absolute month. That
   * is the whole of the automatic rollover: when the date changes, "this month"
   * changes with it, and a panel left on its default needs no correcting.
   */
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);

  const events = state.importantDates;
  const unavailable = state.unavailable.includes("importantDates");
  const month = addMonths(monthOf(today), offset);

  const all = useMemo(() => upcomingItems(events, today, viewerZone), [events, today, viewerZone]);
  const upcoming = expanded ? all : all.slice(0, UPCOMING);
  const dayItems = useMemo(
    () => (day ? importantDateItems(events, day, day, viewerZone) : []),
    [events, day, viewerZone]);

  /** One rule for tapping a day: it opens that day's agenda, empty or not. */
  const pickDay = useCallback((date: string) => setDay(date), []);

  /** An item is a view of its source; editing it edits the series it came from. */
  const openItem = (item: CalendarItem) => {
    const event = events.find((e) => e.id === item.sourceId);
    if (event) setEditing({ event, isNew: false, occurrence: item.occurrenceDate });
  };

  /**
   * Where "+ Add an event" starts.
   *
   * Today, while today is on screen — which is the common case and the obvious
   * answer. Once someone has navigated to March, though, an event dated today
   * would be created outside the calendar they are looking at, so it starts on
   * the 1st of the first month in view instead.
   */
  const addFrom = monthOf(today) === month ? today : monthFirst(month);

  const close = () => { setEditing(null); setDay(null); };

  return (
    <section className="card p-4" aria-labelledby="important-dates-title">
      <div className="flex items-baseline justify-between gap-2">
        <div className="eyebrow" id="important-dates-title" style={{ fontSize: 10 }}>
          📍 {t.importantDates.title}
        </div>
        <div className="flex items-center gap-0.5" style={{ flex: "none" }}>
          <button className="btn btn-quiet" style={{ padding: "3px 8px", fontSize: 14 }}
            onClick={() => setOffset((n) => n - 1)} aria-label={t.importantDates.previousMonth}>‹</button>
          <button className="btn btn-quiet" style={{ padding: "3px 8px", fontSize: 11.5 }}
            onClick={() => setOffset(0)} disabled={offset === 0}
            aria-label={t.importantDates.backToNow}>{t.importantDates.backToNow}</button>
          <button className="btn btn-quiet" style={{ padding: "3px 8px", fontSize: 14 }}
            onClick={() => setOffset((n) => n + 1)} aria-label={t.importantDates.nextMonth}>›</button>
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
          <div className="mt-3">
            <MonthGrid month={month} events={events} viewerZone={viewerZone} today={today}
              onPickDay={pickDay} />
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
                  <button key={e.id} className="event-row" onClick={() => openItem(e)}
                    aria-label={t.importantDates.open(e.title)}>
                    <span className="event-dot" style={{ background: colorHex(e.color) }} aria-hidden="true" />
                    <span className="event-line">
                      <span className="num faint event-when" style={{ fontSize: 11.5 }}>
                        {dateRangeFor(e.startDate, e.endDate, locale)}
                        {e.startTime && ` · ${clockTimeFor(e.startTime, locale)}`}
                        {covers(e, today) && (
                          <span style={{ color: "var(--accent)", marginLeft: 5 }}>
                            {e.startDate === e.endDate
                              ? t.importantDates.todayTag : t.importantDates.onNow}
                          </span>
                        )}
                      </span>
                      <span className="event-what" style={{ fontSize: 13.5 }}>
                        {shownTitle(e.title, e.kind)}
                        {e.repeat && (
                          <span className="faint" style={{ marginLeft: 5, fontSize: 11.5 }}
                            title={repeatText(e.repeat, t, locale) ?? undefined}>↻</span>
                        )}
                      </span>
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
            onClick={() => setEditing({ event: blankEvent(addFrom), isNew: true, occurrence: null })}>
            + {t.importantDates.add}
          </button>
        </>
      )}

      {day && !editing && (
        <DayAgendaSheet
          date={day}
          items={dayItems}
          today={today}
          onPick={openItem}
          onAdd={() => setEditing({ event: blankEvent(day), isNew: true, occurrence: null })}
          onMove={setDay}
          onClose={close}
        />
      )}

      {editing && (
        <EventEditor
          key={`${editing.event.id}@${editing.occurrence ?? ""}`}
          editing={editing}
          viewerZone={viewerZone}
          today={today}
          onSave={actions.saveImportantDate}
          onDelete={actions.deleteImportantDate}
          onDeleteOccurrence={actions.deleteImportantDateOccurrence}
          onClose={close}
          onBack={day ? () => setEditing(null) : undefined}
        />
      )}
    </section>
  );
}
