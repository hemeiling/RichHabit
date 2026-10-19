"use client";
import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useHabits } from "@/components/store";
import { startDragAutoScroll, stopDragAutoScroll } from "@/lib/dragAutoScroll";
import AddHabit from "@/components/AddHabit";
import CommunityCard from "@/components/CommunityCard";
import GratitudeJournal from "@/components/GratitudeJournal";
import HabitEditor from "@/components/HabitEditor";
import HabitMenu from "@/components/HabitMenu";
import { Empty, Field, Sheet } from "@/components/ui";
import { isNumericTracking } from "@/lib/types";
import { addDays, dow, prettyDate, todayISO } from "@/lib/dates";
import {
  CATEGORIES, blankHabit, dayScore, encouragement, habitStatus, habitStreak, isDone,
  moveWithin, scheduledOn,
} from "@/lib/habits";
import { useLocale, useT } from "@/lib/i18n/context";
import { prettyDateFor, shortDateFor } from "@/lib/i18n";
import { habitName, habitNameOn, habitUnit, rotationPrecept } from "@/lib/templates";
import type { AppState, Category, Habit } from "@/lib/types";

/**
 * Rich Habits — the daily habit experience.
 *
 * This is what /today was, moved rather than rebuilt: the same day header, the
 * same three sections, the same rows, sheets, drag-and-drop and journal,
 * reading and writing the same records. Three things left, and nothing else
 * changed. The priority matrix is Priority Compass now, Important Dates went
 * with it, and the day's score dashboard is Insights' "Today · Daily progress".
 *
 * The date on screen drives the whole page, as it always did: which habits are
 * scheduled, which are ticked, and which day's journal you are writing in.
 */

/**
 * Logging how much, and how it went. The "Note" marker on a row used to have no
 * way of ever being set — this is what sets it. A completion row exists only
 * when the habit was done, so saving an entry marks it done.
 */
function LogSheet({
  habit, date, entry, onSave, onClose,
}: {
  habit: Habit; date: string;
  entry: { value?: number | null; note?: string } | undefined;
  onSave: (value: number | null, note: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState(entry?.value == null ? "" : String(entry.value));
  const [note, setNote] = useState(entry?.note ?? "");

  return (
    <Sheet
      open onClose={onClose} title={t.today.logTitle}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t.common.cancel}</button>
          <button className="btn btn-primary"
            onClick={() => { onSave(value === "" ? null : Number(value), note.trim()); onClose(); }}>
            {t.today.logSave}
          </button>
        </>
      }
    >
      <p className="muted mb-3" style={{ fontSize: 14 }}>{habitName(habit, t)}</p>
      {habit.target != null && (
        <Field label={`${t.today.logValue}${habit.unit ? ` (${habitUnit(habit, t)})` : ""}`}>
          <input className="input num" type="number" inputMode="decimal" autoFocus
            placeholder={String(habit.target)} value={value}
            onChange={(e) => setValue(e.target.value)} />
        </Field>
      )}
      <Field label={t.today.logNote} hint={t.today.logNoteHint}>
        <textarea className="textarea" rows={3} value={note}
          autoFocus={habit.target == null}
          onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Sheet>
  );
}

function HabitRow({
  state, habit, date, onToggle, onOpen, onMenu, onStep, drag,
}: {
  state: AppState; habit: Habit; date: string;
  onToggle: (id: string) => void; onOpen: (h: Habit) => void; onMenu: (h: Habit) => void;
  onStep: (h: Habit, delta: number) => void;
  /** Drag-and-drop wiring, supplied by the section. */
  drag: {
    dragging: boolean;
    over: boolean;
    onDragStart: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: () => void;
    onDragEnd: () => void;
  };
}) {
  const t = useT();
  const done = isDone(state, date, habit.id);
  const streak = habitStreak(state, habit);
  const entry = state.completions[date]?.[habit.id];
  /* A weekly or monthly habit says how far its period has come and what it
     needs now — two answers, kept apart (the scoring revision). */
  const week = (() => {
    const st = habitStatus(state, habit, date);
    if (st.period === "day") return null;
    const monthly = st.period === "month";
    if (st.target === 0) {
      return { progress: monthly ? t.today.startsNextMonth : t.today.startsNextWeek, status: null, met: false };
    }
    const label = { on_track: t.today.statusOnTrack, due: t.today.statusDue,
      behind: t.today.statusBehind, completed: t.today.statusCompleted }[st.status];
    const progress = monthly ? t.today.monthProgress(st.done, st.target) : t.today.weekProgress(st.done, st.target);
    return { progress, status: label, met: st.status === "completed" };
  })();

  const numeric = isNumericTracking(habit.tracking);
  const unit = habitUnit(habit, t);
  const value = entry?.value ?? null;

  /** What the row shows about its own measurement. */
  const measure = !numeric || habit.target == null
    ? null
    : habit.tracking === "maximum"
      ? value == null ? t.today.underLimit(habit.target, unit)
        : t.today.overLimit(value, habit.target, unit)
      : t.today.progress(value ?? 0, habit.target, unit);

  /**
   * §20. Which bar was cleared. Derived rather than stored: the same completion
   * row answers both questions, and the definition can change without a
   * migration.
   */
  const reached = (() => {
    if (!numeric || value == null) return null;
    if (habit.tracking === "maximum") {
      return habit.target != null && value <= habit.target ? "target" : null;
    }
    if (habit.target != null && value >= habit.target) return "target";
    if (habit.minimum != null && value >= habit.minimum) return "minimum";
    return null;
  })();

  return (
    <div
      className="habit-row flex items-center gap-3 py-3"
      data-habit-id={habit.id}
      data-dragging={drag.dragging || undefined}
      data-over={drag.over || undefined}
      onDragOver={drag.onDragOver}
      onDrop={(e) => { e.preventDefault(); drag.onDrop(); }}
    >
      {/* Appears on hover on a pointer device only. The normal state of the row
          stays a checkbox and a name; on a phone reordering lives in the menu. */}
      <span
        className="drag-handle faint" draggable
        onDragStart={drag.onDragStart} onDragEnd={drag.onDragEnd}
        aria-hidden="true" title={t.customise.dragHandle}
        style={{ flex: "none", cursor: "grab", fontSize: 13, lineHeight: 1, userSelect: "none" }}
      >⠿</span>
      <button
        className="tick" data-on={done} onClick={() => onToggle(habit.id)} aria-pressed={done}
        aria-label={done ? t.today.uncheck(habitNameOn(habit, t, date)) : t.today.check(habitNameOn(habit, t, date))}
      >
        {done && (
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M4.5 10.5l3.6 3.6L15.5 6.8" stroke="var(--accent-ink)" strokeWidth="2.4"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <button
        className="flex-1 text-left"
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
        onClick={() => onOpen(habit)}
      >
        <div style={{ fontSize: 15.5, fontWeight: 500, opacity: done ? 0.55 : 1, letterSpacing: "-0.01em" }}>
          {habit.type === "avoid" && <span className="faint" style={{ fontWeight: 400 }}>{t.today.avoid} · </span>}
          {habitNameOn(habit, t, date)}
        </div>
        {/* HT-2c. A rotating habit carries the week's own words (Franklin's precept). */}
        {rotationPrecept(habit, t, date) && (
          <div className="muted mt-0.5" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
            {rotationPrecept(habit, t, date)}
          </div>
        )}
        {/* §11. The anchor is what makes the habit happen, so it belongs on the
            row rather than buried in the editor. */}
        {habit.anchor && (
          <div className="faint mt-0.5" style={{ fontSize: 12 }}>
            {t.today.anchorPrefix(habit.anchor)}
          </div>
        )}
        <div className="faint flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5" style={{ fontSize: 12 }}>
          {/* §12/§20. What the row says about itself depends on how it is
              measured: a limit reads differently from a target, and a number
              reads differently from a tick. */}
          {measure && <span className="num">{measure}</span>}
          {week && <span className="num" data-week-progress="">{week.progress}</span>}
          {week?.status && (
            <span data-week-status="" style={week.met ? { color: "var(--accent)" } : undefined}>{week.status}</span>
          )}
          {reached === "target" && <span style={{ color: "var(--accent)" }}>{t.today.targetMet}</span>}
          {reached === "minimum" && <span>{t.today.minimumMet}</span>}
          {streak > 0 && <span className="num">{t.today.daysRunning(streak)}</span>}
          {habit.weight === 3 && <span>{t.today.highPriority}</span>}
          {entry?.note && <span>{t.today.note}</span>}
        </div>
      </button>

      {/* A number is entered where it is read. The tick stays the fast path. */}
      {numeric && (
        <div className="flex items-center gap-1" style={{ flex: "none" }}>
          <button className="btn btn-quiet" style={{ padding: "2px 8px", fontSize: 15 }}
            aria-label={t.today.removeOne} disabled={(entry?.value ?? 0) <= 0}
            onClick={() => onStep(habit, -1)}>−</button>
          <button className="btn btn-quiet" style={{ padding: "2px 8px", fontSize: 15 }}
            aria-label={t.today.addOne} onClick={() => onStep(habit, 1)}>+</button>
        </div>
      )}
      <button
        className="btn btn-quiet" style={{ padding: "4px 9px", flex: "none", fontSize: 15 }}
        onClick={() => onMenu(habit)} aria-label={t.customise.menuTitle} title={t.customise.menuTitle}
      >
        ⋯
      </button>
    </div>
  );
}

/**
 * Rows glide to their new places when the order changes — after a drop, or a
 * menu Move up/down — instead of jumping, so the eye can follow which habit
 * went where (FLIP: remember where each row was, let React re-render, then
 * animate each moved row from its old offset to zero).
 *
 * Only an ORDER change animates. `signature` is the visible order; ticking a
 * habit, expanding a row or typing in the journal moves rows too, but leaves
 * the signature alone and so stays still. Changing day swaps the set of rows
 * rather than reordering it, and is skipped the same way. Users who ask for
 * reduced motion get the instant move. Purely visual: nothing is written.
 */
function useReorderGlide(signature: string) {
  const tops = useRef(new Map<string, number>());
  const previous = useRef(signature);
  useLayoutEffect(() => {
    const rows = document.querySelectorAll<HTMLElement>(".habit-row[data-habit-id]");
    const now = new Map<string, number>();
    rows.forEach((el) => now.set(el.dataset.habitId!, el.getBoundingClientRect().top + window.scrollY));

    const reordered = signature !== previous.current
      && previous.current.split(",").sort().join(",") === signature.split(",").sort().join(",");
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reordered && !calm) {
      rows.forEach((el) => {
        const before = tops.current.get(el.dataset.habitId!);
        const after = now.get(el.dataset.habitId!)!;
        if (before == null || Math.abs(before - after) < 1) return;
        el.animate?.(
          [{ transform: `translateY(${before - after}px)` }, { transform: "translateY(0)" }],
          { duration: 200, easing: "cubic-bezier(.2,.7,.3,1)" });
      });
    }
    tops.current = now;
    previous.current = signature;
  });
}

export default function RichHabits() {
  const { state, actions } = useHabits();
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [date, setDate] = useState(todayISO());
  const [logging, setLogging] = useState<Habit | null>(null);
  const [menu, setMenu] = useState<Habit | null>(null);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [adding, setAdding] = useState<Category | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const isToday = date === todayISO();

  /** Distinct days with a completion — what decides whether erasing is offered. */
  const daysRecorded = (habitId: string) =>
    Object.values(state.completions).filter((day) => day[habitId]).length;

  /**
   * The order of one section after moving `id` to sit where `target` is. Both
   * dragging and the menu's up/down end here, so there is one rule for what an
   * arrangement means, and one write.
   */
  const reorderWithin = (category: Category, id: string, targetId: string) => {
    if (id === targetId) return;
    const inSection = state.habits
      .filter((h) => h.category === category && h.status !== "retired")
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
    const ids = moveWithin(inSection.map((h) => h.id), id, targetId);
    actions.reorderHabits(ids);
  };

  /** Menu "move up / move down": the same operation, one place along. */
  const nudge = (habit: Habit, delta: -1 | 1) => {
    const siblings = list.filter((h) => h.category === habit.category);
    const at = siblings.findIndex((h) => h.id === habit.id);
    const neighbour = siblings[at + delta];
    if (neighbour) reorderWithin(habit.category, habit.id, neighbour.id);
  };

  /**
   * §14. Taking a habit off the sheet is a status change, never a delete: the
   * row and every completion against it stay exactly where they were, so
   * Insights and the coach still see the history.
   */
  const setStatus = (habit: Habit, status: Habit["status"]) =>
    actions.saveHabit({ ...habit, status, active: status === "active" });

  /**
   * §10/§18. Replacing keeps the original and its record, retires it, and
   * starts a new habit that points back at what it replaced.
   */
  const startReplacement = (habit: Habit) => {
    setMenu(null);
    setEditing({
      ...blankHabit(),
      category: habit.category,
      sortOrder: habit.sortOrder,
      replacesHabitId: habit.id,
    });
  };

  /**
   * §12/§20. Stepping a numeric habit records the amount and, with it, whether
   * the day counts: reaching the minimum is enough to be done, so a partial day
   * still counts without claiming the target was met. A `maximum` habit is the
   * other way round — it counts while it stays under the limit.
   */
  const step = (habit: Habit, delta: number) => {
    const current = state.completions[date]?.[habit.id]?.value ?? 0;
    const next = Math.max(0, current + delta);
    const bar = habit.tracking === "maximum"
      ? null                                     // handled by the comparison below
      : habit.minimum ?? habit.target;
    const done = habit.tracking === "maximum"
      ? habit.target == null || next <= habit.target
      : bar == null ? next > 0 : next >= bar;

    if (!done && next === 0) {
      actions.toggle(date, habit.id);            // clears the row entirely
      return;
    }
    actions.logCompletion(date, habit.id, next,
      state.completions[date]?.[habit.id]?.note ?? "");
  };

  const score = dayScore(state, date);
  const list = scheduledOn(state, date);
  useReorderGlide(list.map((h) => `${h.category}:${h.id}`).join(","));

  return (
    /*
     * Two columns on a wide screen, one below 1280px — see `.with-rail` in
     * globals.css. The rail is second in the document, so when it collapses it
     * lands beneath the day's habits rather than above them: on a phone the
     * first thing you should see is what you have to do, not how you compare.
     */
    <div className="with-rail">
      <div className="flex flex-col gap-4">
      {/*
        * The day, and nothing between it and the day's habits. The score dial,
        * the per-section counts and the streak that used to fill this card are
        * Insights' "Today · Daily progress" now (components/TodayProgress):
        * this page is for doing the habits, Insights for reviewing them, and on
        * a phone the first habit should be on the first screen. Each section
        * below still shows its own "x of y" for whichever day is on screen.
        */}
      <section className="card px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow">{isToday ? t.today.todayLabel : t.days.short[dow(date)]}</div>
            <h1 className="display" style={{ fontSize: 25, lineHeight: 1.15, marginTop: 2 }}>{prettyDateFor(date, locale)}</h1>
          </div>
          <div className="flex gap-1" style={{ flex: "none" }}>
            <button className="btn btn-quiet" style={{ padding: "8px 12px" }}
              onClick={() => setDate(addDays(date, -1))} aria-label={t.common.previousDay}>‹</button>
            <button className="btn btn-quiet" style={{ padding: "8px 12px" }} disabled={isToday}
              onClick={() => setDate(addDays(date, 1))} aria-label={t.common.nextDay}>›</button>
          </div>
        </div>
        <p className="mt-1.5 muted" style={{ fontSize: 14, lineHeight: 1.45 }}>
          {t.encouragement[encouragement(state, date, score)]}{" "}
          <Link href="/insights#today" className="faint" style={{ whiteSpace: "nowrap", textDecoration: "underline", textUnderlineOffset: 3 }}>
            {t.today.seeProgress}
          </Link>
        </p>
      </section>

      {/*
        * The priority matrix used to sit here, between the day's summary and
        * the checklist. It is Priority Compass now, at /priorities, reached
        * from the sidebar — the same component, unchanged, simply given its
        * own address.
        *
        * Nothing replaces it on this page. A summary card would be a second,
        * lesser rendering of a screen that already exists, and the app settled
        * that question once before when Community Progress became a top-level
        * destination: one home per experience.
        */}

      {/* Every section is rendered whether or not it has habits: an empty one
          still needs its "+ Add habit", or the page would offer no way to fill
          it. The old empty state only appeared when the whole day was empty. */}
      {CATEGORIES.map((c) => {
        const hs = list.filter((h) => h.category === c.id);
        return (
          <section key={c.id} className="card px-5 py-2">
            <div className="flex items-baseline justify-between pt-3 pb-1">
              <h2 className="display" style={{ fontSize: 20 }}>{t.categories[c.id].label}</h2>
              {hs.length > 0 && (
                <span className="eyebrow">
                  {t.common.of(hs.filter((h) => isDone(state, date, h.id)).length, hs.length)}
                </span>
              )}
            </div>
            <div className="divide">
              {hs.map((h) => (
                <HabitRow key={h.id} state={state} habit={h} date={date}
                  onToggle={(id) => actions.toggle(date, id)}
                  onOpen={(habit) => setEditing(habit)}
                  onMenu={setMenu}
                  onStep={step}
                  drag={{
                    dragging: dragged === h.id,
                    over: overId === h.id && dragged !== null && dragged !== h.id,
                    onDragStart: () => { setDragged(h.id); startDragAutoScroll(); },
                    onDragOver: (e) => { e.preventDefault(); setOverId(h.id); },
                    onDrop: () => {
                      if (dragged) reorderWithin(c.id, dragged, h.id);
                      stopDragAutoScroll(); setDragged(null); setOverId(null);
                    },
                    onDragEnd: () => { stopDragAutoScroll(); setDragged(null); setOverId(null); },
                  }} />
              ))}
            </div>

            {/* §12. Subtle on purpose: the page is a checklist first. */}
            <button className="w-full text-left py-3 faint"
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14 }}
              onClick={() => setAdding(c.id)}>
              + {t.customise.addHabit}
            </button>
          </section>
        );
      })}

      {list.length === 0 && (
        <Empty title={t.today.nothingScheduled} body={t.today.nothingScheduledBody} />
      )}

      {logging && (
        <LogSheet
          habit={logging} date={date} entry={state.completions[date]?.[logging.id]}
          onSave={(value, note) => actions.logCompletion(date, logging.id, value, note)}
          onClose={() => setLogging(null)}
        />
      )}

      {menu && (() => {
        const siblings = list.filter((h) => h.category === menu.category);
        const at = siblings.findIndex((h) => h.id === menu.id);
        return (
          <HabitMenu
            habit={menu}
            daysRecorded={daysRecorded(menu.id)}
            canMoveUp={at > 0}
            canMoveDown={at >= 0 && at < siblings.length - 1}
            onLog={() => { setLogging(menu); setMenu(null); }}
            onEdit={() => { setEditing(menu); setMenu(null); }}
            onMove={(category) => actions.saveHabit({ ...menu, category })}
            onReorder={(delta) => { nudge(menu, delta); setMenu(null); }}
            onStatus={(status) => setStatus(menu, status)}
            onReplace={() => startReplacement(menu)}
            onDelete={() => actions.deleteHabit(menu.id)}
            onClose={() => setMenu(null)}
          />
        );
      })()}

      {adding && (
        <AddHabit
          section={adding}
          habits={state.habits}
          goals={state.goals}
          nextSortOrder={
            Math.max(0, ...state.habits.filter((h) => h.category === adding)
              .map((h) => h.sortOrder)) + 1
          }
          onSave={actions.saveHabit}
          onClose={() => setAdding(null)}
        />
      )}

      {editing && (
        <HabitEditor
          habit={editing} goals={state.goals}
          onSave={(h) => {
            actions.saveHabit(h);
            // §10. A replacement retires what it replaces, rather than deleting
            // it — the old habit and its record are the point of comparison.
            if (h.replacesHabitId) {
              const old = state.habits.find((x) => x.id === h.replacesHabitId);
              if (old) setStatus(old, "retired");
            }
            setEditing(null);
          }}
          onDelete={(id) => { actions.deleteHabit(id); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}

      {/* The day's journal, at the bottom where it was. Navigating to another
          day shows that day's entry — nothing is overwritten. */}
      <GratitudeJournal date={date} />
      </div>

      {/*
        * The rail: Community Progress — Monthly Habit Accomplishments, the
        * existing board, for connection and motivation beside the day's work.
        * Your own month is in Insights (`MonthProgress`), with the rest of
        * your personal statistics.
        *
        * Below 1280px the grid collapses and the rail follows the main content
        * down the page — see `.with-rail` — which puts the board after the
        * checklist and the journal on a phone. That order is deliberate: the
        * first thing you should see is what you have to do, not how you
        * compare. Nothing is hidden and nothing is repositioned by script.
        *
        * Important Dates used to sit here too. It is on Priority Compass now,
        * beside the matrix, where what is coming up belongs next to what
        * deserves attention. It is not rendered anywhere else.
        */}
      <aside className="rail flex flex-col gap-4">
        <CommunityCard kind="habits" />
      </aside>
    </div>
  );
}
