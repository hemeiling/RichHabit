import { addDays, daysBetween, dow, rangeBack, todayISO, weekStart } from "./dates";
import type { AppState, Category, Frequency, Habit } from "./types";

export const CATEGORIES: { id: Category; label: string; note: string }[] = [
  { id: "morning", label: "Morning", note: "Phase one" },
  { id: "daytime", label: "Daytime", note: "Phase two" },
  { id: "nighttime", label: "Nighttime", note: "Phase three" },
];

export const catLabel = (id: Category) => CATEGORIES.find((c) => c.id === id)?.label ?? id;

export const GOAL_AREAS = [
  "Health", "Fitness", "Career", "Learning",
  "Relationships", "Financial", "Personal project", "Sleep",
];

export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2) + Date.now().toString(36));

export const blankHabit = (): Habit => ({
  id: uid(), name: "", templateKey: null, description: "", category: "morning", type: "good",
  frequency: { mode: "daily", days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3 },
  tracking: "boolean", minimum: null, target: null, unit: "",
  anchor: "", environment: "", friction: "",
  startDate: todayISO(), status: "active", active: true, weight: 2,
  replacesHabitId: null, rationale: null,
  goalId: null, sortOrder: 0, createdAt: Date.now(),
});

/**
 * A list with `id` moved to where `targetId` currently sits — the one rule for
 * what a rearrangement means, shared by dragging and by the menu's up/down so
 * the two cannot disagree.
 *
 * The moved item takes the target's place and the target shifts away from it,
 * which is what dropping something onto a row looks like it should do in both
 * directions. Unknown ids leave the list alone rather than throwing: a stale
 * drag after a habit was removed elsewhere is not an error.
 */
export function moveWithin(ids: string[], id: string, targetId: string): string[] {
  const from = ids.indexOf(id);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

export const isDone = (s: AppState, date: string, habitId: string) =>
  !!s.completions[date]?.[habitId]?.done;

function completedCount(s: AppState, habitId: string, fromISO: string, toISO: string) {
  let n = 0;
  for (let d = fromISO; daysBetween(d, toISO) >= 0; d = addDays(d, 1)) {
    if (s.completions[d]?.[habitId]?.done) n++;
  }
  return n;
}

/**
 * The schedule that was in force on `date`.
 *
 * Each version runs from its own `from` until the next one starts, so a change
 * made today leaves every earlier day judged by the rule it was lived under.
 * A day before the first recorded version takes the first one: a habit's first
 * schedule row can be dated a day after its start (rows written before this
 * rule used the server's UTC date), and that day was always meant to follow it.
 */
export function frequencyOn(habit: Habit, date: string): Frequency {
  const history = habit.frequencyHistory;
  if (!history?.length) return habit.frequency;
  let f = history[0].frequency;
  for (const v of history) {
    if (v.from > date) break;   // YYYY-MM-DD compares as text
    f = v.frequency;
  }
  return f;
}

/** Same rule as stored: the weekly count only means something in `times` mode. */
export function sameFrequency(a: Frequency, b: Frequency): boolean {
  const days = (f: Frequency) => [...(f.days ?? [])].sort((x, y) => x - y).join();
  return a.mode === b.mode && days(a) === days(b)
    && (a.mode !== "times" || a.timesPerWeek === b.timesPerWeek);
}

/**
 * The habit with its schedule history brought up to date for a save on
 * `today` — the browser's copy of the rule `saveHabit` applies on the server,
 * so Today shows the change before the next load confirms it.
 *
 * An unchanged schedule adds nothing. A changed one becomes a version from
 * today, replacing one already made today; and it never starts before the
 * newest version on record, so a version dated ahead of the person's calendar
 * (written under the old UTC rule, or before crossing time zones) is amended
 * rather than left to overrule the newer choice when its date arrives.
 */
export function withScheduleVersion(h: Habit, today: string): Habit {
  const history = h.frequencyHistory ?? [];
  const latest = history[history.length - 1];
  if (latest && sameFrequency(latest.frequency, h.frequency)) return h;
  const from = latest && latest.from > today ? latest.from : today;
  return {
    ...h,
    frequencyHistory: [...history.filter((v) => v.from < from), { from, frequency: h.frequency }],
  };
}

export function isScheduled(s: AppState, habit: Habit, date: string): boolean {
  if (!habit.active) return false;
  if (daysBetween(habit.startDate, date) < 0) return false;
  const f = frequencyOn(habit, date);
  if (f.mode === "daily") return true;
  if (f.mode === "days") return (f.days ?? []).includes(dow(date));
  // Flexible habits stay on the list until the week's target is met.
  if (isDone(s, date, habit.id)) return true;
  return completedCount(s, habit.id, weekStart(date), date) < (f.timesPerWeek || 1);
}

export const scheduledOn = (s: AppState, date: string) =>
  s.habits.filter((h) => isScheduled(s, h, date));

// ── Targets: one scoring rule for Today, Week, Insights and Community ────────
/*
 * · A habit on fixed days (daily, or chosen weekdays) owes one session on each
 *   scheduled day. A "times a week" habit owes N sessions per week (the app's
 *   week, `weekStart`). Days with nothing scheduled are never counted.
 * · A target counts toward a score once it is MET or once its TIME IS UP,
 *   whichever comes first, and earns at most what it asked for: doing more
 *   never scores over 100%, and a week (or a day) still in progress neither
 *   counts against anyone early nor counts as done before it is — 2 of 3 by
 *   Wednesday is 2 of 3 progress, not 100%.
 * · A week's target is shared out over its days, each carrying N/7 under the
 *   schedule in force on it (HT-2a versions; none before the habit existed),
 *   and rounded: a habit started on a Thursday asks 1 of 3 that week, one
 *   started on the last day of the week starts counting the next.
 * · A week counts in the range its last day falls in; a range ending today
 *   also counts the current week once its target is met.
 * Nothing here writes or reinterprets stored data: completions and schedule
 * versions are read exactly as recorded.
 */

/** One commitment: a scheduled day's session, or a week's quota. */
export interface Target {
  start: string;
  end: string;
  target: number;
  done: number;
  /** The day the target was reached, if it was. */
  metOn: string | null;
}

const isQuota = (f: Frequency) => f.mode === "times";
const onFixedDay = (f: Frequency, date: string) =>
  f.mode === "daily" || (f.mode === "days" && (f.days ?? []).includes(dow(date)));

/** The days of the week starting `ws` on which `habit` ran as a "times a week" habit. */
function quotaDays(habit: Habit, ws: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    if (d >= habit.startDate && isQuota(frequencyOn(habit, d))) out.push(d);
  }
  return out;
}

/** The weekly target of a "times a week" habit for the week starting `ws`. */
export function weekTarget(s: AppState, habit: Habit, ws: string): Target {
  const days = quotaDays(habit, ws);
  const share = days.reduce((n, d) => n + (frequencyOn(habit, d).timesPerWeek || 1) / 7, 0);
  const target = Math.min(Math.floor(share + 0.5 + 1e-9), days.length);
  let done = 0, metOn: string | null = null;
  for (const d of days) {
    if (!isDone(s, d, habit.id)) continue;
    done++;
    if (done === target) metOn = d;
  }
  return { start: ws, end: addDays(ws, 6), target, done, metOn: target > 0 ? metOn : null };
}

/** Sessions done toward the week's target on its days from `ws` up to and including `upTo`. */
function weekDoneBy(s: AppState, habit: Habit, ws: string, upTo: string): number {
  return quotaDays(habit, ws).filter((d) => d <= upTo && isDone(s, d, habit.id)).length;
}

/**
 * Every target of `habit` belonging to [from, to]: its sessions on those days,
 * and its weeks ending in them — plus, when the range ends `today`, the week in
 * progress (counted once met, shown as in progress until then).
 */
export function targetsOf(s: AppState, habit: Habit, from: string, to: string, today: string): Target[] {
  if (!habit.active) return [];
  const out: Target[] = [];
  for (let d = from > habit.startDate ? from : habit.startDate; d <= to; d = addDays(d, 1)) {
    if (!onFixedDay(frequencyOn(habit, d), d)) continue;
    const done = isDone(s, d, habit.id);
    out.push({ start: d, end: d, target: 1, done: done ? 1 : 0, metOn: done ? d : null });
  }
  for (let ws = weekStart(from); ws <= to; ws = addDays(ws, 7)) {
    const t = weekTarget(s, habit, ws);
    if (t.target === 0) continue;
    const endsInRange = t.end >= from && t.end <= to;
    const inProgress = t.end > to && to === today;
    if (endsInRange || inProgress) out.push(t);
  }
  return out;
}

/** Counts toward a score: met by `today`, or its last day is over. */
export const isSettled = (t: Target, today: string) =>
  t.target > 0 && ((t.metOn !== null && t.metOn <= today) || t.end < today);

export interface Accomplishment {
  pct: number | null;
  earned: number;
  required: number;
  /** Targets in the range still in progress — neither credited nor missed yet. */
  open: number;
}

/**
 * Sessions earned ÷ sessions required over the settled targets of a range of
 * dates (contiguous, any order). Every session counts the same; with the
 * weighting preference on, each habit's sessions count by its weight.
 */
export function accomplishment(
  s: AppState, dates: string[], today = todayISO(), habits = s.habits,
): Accomplishment {
  if (!dates.length) return { pct: null, earned: 0, required: 0, open: 0 };
  const sorted = [...dates].sort();
  const from = sorted[0], to = sorted[sorted.length - 1];
  let earned = 0, required = 0, open = 0;
  for (const h of habits) {
    const w = s.prefs.weighted ? h.weight || 1 : 1;
    for (const t of targetsOf(s, h, from, to, today)) {
      if (t.start > today) continue;   // still to come
      if (!isSettled(t, today)) { open++; continue; }
      earned += Math.min(t.done, t.target) * w;
      required += t.target * w;
    }
  }
  return { pct: required ? Math.round((earned / required) * 100) : null, earned, required, open };
}

export type HabitStatusKey = "completed" | "due" | "behind" | "on_track";

export interface HabitStatus {
  status: HabitStatusKey;
  /** Progress toward the current target: a day's session, or the week's quota. */
  done: number;
  target: number;
  period: "day" | "week";
}

/**
 * What a habit needs from the person on `today` — kept apart from how much of
 * its target is done. A weekly habit is Completed when the week's target is
 * met, Due today when every remaining day is needed, Behind when the full
 * target is out of reach (still worth doing), and On track otherwise. A
 * fixed-day habit is Due today or Completed on its days, On track on others;
 * a missed day stays in history and never leaves a lingering "Behind".
 */
export function habitStatus(s: AppState, habit: Habit, today = todayISO()): HabitStatus {
  const f = frequencyOn(habit, today);
  const doneToday = isDone(s, today, habit.id);
  if (!isQuota(f)) {
    if (today < habit.startDate || !onFixedDay(f, today)) return { status: "on_track", done: 0, target: 0, period: "day" };
    return { status: doneToday ? "completed" : "due", done: doneToday ? 1 : 0, target: 1, period: "day" };
  }
  const t = weekTarget(s, habit, weekStart(today));
  const sofar = weekDoneBy(s, habit, t.start, today);
  if (t.target === 0) return { status: "on_track", done: sofar, target: 0, period: "week" };
  const remaining = t.target - sofar;
  const left = daysBetween(today, t.end) + 1 - (doneToday ? 1 : 0);
  const status: HabitStatusKey = remaining <= 0 ? "completed"
    : remaining > left ? "behind" : remaining === left ? "due" : "on_track";
  return { status, done: sofar, target: t.target, period: "week" };
}

/**
 * Whether `habit` owes a session on `date`: "done", "due" (owed, not done) or
 * "none". A weekly habit is owed on a day it is Due or Behind, and counts as
 * done on a day its session went toward the target; on a day it is merely on
 * track, leaving it costs nothing.
 */
function owedOn(s: AppState, habit: Habit, date: string): "done" | "due" | "none" {
  if (!habit.active || date < habit.startDate) return "none";
  const f = frequencyOn(habit, date);
  const doneToday = isDone(s, date, habit.id);
  if (!isQuota(f)) return onFixedDay(f, date) ? (doneToday ? "done" : "due") : "none";
  const t = weekTarget(s, habit, weekStart(date));
  if (t.target === 0) return "none";
  const before = weekDoneBy(s, habit, t.start, addDays(date, -1));
  if (doneToday) return before < t.target ? "done" : "none";
  const remaining = t.target - before;
  return remaining > 0 && remaining >= daysBetween(date, t.end) + 1 ? "due" : "none";
}

export interface DayScore {
  pct: number | null; done: number; total: number; weightDone: number; weightTotal: number;
}

/** One day as Today's ring shows it: the sessions owed that day, and how many were done. */
export function dayScore(s: AppState, date: string): DayScore {
  let done = 0, total = 0, wDone = 0, wTotal = 0;
  for (const h of s.habits) {
    const owed = owedOn(s, h, date);
    if (owed === "none") continue;
    const w = s.prefs.weighted ? h.weight || 1 : 1;
    total++;
    wTotal += w;
    if (owed === "done") { done++; wDone += w; }
  }
  if (!total) return { pct: null, done: 0, total: 0, weightDone: 0, weightTotal: 0 };
  return { pct: Math.round((wDone / wTotal) * 100), done, total, weightDone: wDone, weightTotal: wTotal };
}

/**
 * A range's score — its `accomplishment` — with the day counts screens show
 * beside it. `today` decides what is settled: the viewer's date for a range in
 * progress, any later day for a finished one.
 */
export function rangeScore(s: AppState, dates: string[], today = todayISO()) {
  const a = accomplishment(s, dates, today);
  let perfect = 0, activeDays = 0;
  dates.forEach((d) => {
    if (d > today) return;
    const day = dayScore(s, d);
    if (day.total === 0) return;
    activeDays++;
    if (day.done === day.total) perfect++;
  });
  return { pct: a.pct, perfect, activeDays, earned: a.earned, required: a.required, open: a.open };
}

/** Counts back over scheduled days only. An unchecked today doesn't break it yet. */
export function habitStreak(s: AppState, habit: Habit) {
  let streak = 0, cursor = todayISO(), guard = 0;
  if (isScheduled(s, habit, cursor) && !isDone(s, cursor, habit.id)) cursor = addDays(cursor, -1);
  while (guard++ < 400) {
    if (daysBetween(habit.startDate, cursor) < 0) break;
    if (isScheduled(s, habit, cursor) || isDone(s, cursor, habit.id)) {
      if (isDone(s, cursor, habit.id)) streak++;
      else break;
    }
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function habitLongestStreak(s: AppState, habit: Habit) {
  const dates = Object.keys(s.completions)
    .filter((d) => s.completions[d]?.[habit.id]?.done)
    .sort();
  if (!dates.length) return 0;
  let best = 1, run = 1;
  for (let i = 1; i < dates.length; i++) {
    let gapOk = true;
    for (let d = addDays(dates[i - 1], 1); d !== dates[i]; d = addDays(d, 1)) {
      if (isScheduled(s, habit, d)) { gapOk = false; break; }
    }
    run = gapOk || daysBetween(dates[i - 1], dates[i]) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

export type Trend = "up" | "down" | "flat" | "new";

export interface HabitStats {
  scheduled: number; done: number; missed: number;
  pct: number | null; streak: number; longest: number; trend: Trend;
}

/** One habit over the last `windowDays`, by the same targets every score uses — in sessions, not weights. */
export function habitStats(s: AppState, habit: Habit, windowDays = 30): HabitStats {
  const end = todayISO();
  const plain: AppState = { ...s, prefs: { ...s.prefs, weighted: false } };
  const of = (dates: string[]) => accomplishment(plain, dates, end, [habit]);
  const rate = (a: Accomplishment) => (a.required ? a.earned / a.required : null);
  const dates = rangeBack(end, windowDays);
  const all = of(dates);
  const half = Math.floor(windowDays / 2);
  const older = rate(of(dates.slice(0, half))), recent = rate(of(dates.slice(half)));
  let trend: Trend = "flat";
  if (older != null && recent != null) {
    if (recent - older > 0.12) trend = "up";
    else if (older - recent > 0.12) trend = "down";
  } else trend = "new";
  return {
    scheduled: all.required, done: all.earned, missed: all.required - all.earned,
    pct: all.pct,
    streak: habitStreak(s, habit),
    longest: habitLongestStreak(s, habit),
    trend,
  };
}

/** Consecutive days where most of what was scheduled actually happened. */
export function dayStreak(s: AppState) {
  const ok = (d: string) => { const x = dayScore(s, d); return x.total > 0 && (x.pct ?? 0) >= 60; };
  let streak = 0, cursor = todayISO(), guard = 0;
  if (!ok(cursor)) cursor = addDays(cursor, -1);
  while (guard++ < 400 && ok(cursor)) { streak++; cursor = addDays(cursor, -1); }
  return streak;
}

/** A week by the same targets every score uses — in sessions, not weights. */
export function weekSummary(s: AppState, weekOf: string, category: Category | null) {
  const today = todayISO();
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekOf, i));
  const habits = s.habits.filter((h) => h.active && (!category || h.category === category));
  const plain: AppState = { ...s, prefs: { ...s.prefs, weighted: false } };
  const per = habits.map((habit) => {
    const a = accomplishment(plain, week, today, [habit]);
    return { habit, pct: a.pct, done: a.earned, scheduled: a.required };
  }).filter((x): x is { habit: Habit; pct: number; done: number; scheduled: number } => x.pct != null);
  const all = accomplishment(plain, week, today, habits);
  const sorted = [...per].sort((a, b) => b.pct - a.pct);
  return {
    pct: all.pct,
    done: all.earned, scheduled: all.required,
    best: sorted[0] ?? null,
    worst: sorted.length > 1 ? sorted[sorted.length - 1] : null,
    longest: habits.reduce((m, h) => Math.max(m, habitLongestStreak(s, h)), 0),
    daysCounted: week.filter((d) => daysBetween(d, today) >= 0).length,
  };
}

export type EncouragementKey =
  | "nothingScheduled" | "startAgain" | "firstIsHardest"
  | "allDone" | "strongDay" | "underway";

/** Returns a dictionary key rather than a sentence, so it can be translated. */
export function encouragement(s: AppState, date: string, score: DayScore): EncouragementKey {
  const y = dayScore(s, addDays(date, -1));
  const missedYesterday = y.total > 0 && (y.pct ?? 0) < 50;
  if (score.total === 0) return "nothingScheduled";
  if (score.done === 0 && missedYesterday) return "startAgain";
  if (score.done === 0) return "firstIsHardest";
  if (score.done === score.total) return "allDone";
  if ((score.pct ?? 0) >= 70) return "strongDay";
  return "underway";
}
