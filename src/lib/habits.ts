import { addDays, daysBetween, dow, rangeBack, todayISO, weekStart } from "./dates";
import type { AppState, Category, Habit } from "./types";

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
  id: uid(), name: "", description: "", category: "morning", type: "good",
  frequency: { mode: "daily", days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3 },
  target: null, unit: "", startDate: todayISO(), active: true, weight: 2,
  goalId: null, createdAt: Date.now(),
});

export const isDone = (s: AppState, date: string, habitId: string) =>
  !!s.completions[date]?.[habitId]?.done;

function completedCount(s: AppState, habitId: string, fromISO: string, toISO: string) {
  let n = 0;
  for (let d = fromISO; daysBetween(d, toISO) >= 0; d = addDays(d, 1)) {
    if (s.completions[d]?.[habitId]?.done) n++;
  }
  return n;
}

export function isScheduled(s: AppState, habit: Habit, date: string): boolean {
  if (!habit.active) return false;
  if (daysBetween(habit.startDate, date) < 0) return false;
  const f = habit.frequency;
  if (f.mode === "daily") return true;
  if (f.mode === "days") return (f.days ?? []).includes(dow(date));
  // Flexible habits stay on the list until the week's target is met.
  if (isDone(s, date, habit.id)) return true;
  return completedCount(s, habit.id, weekStart(date), date) < (f.timesPerWeek || 1);
}

export const scheduledOn = (s: AppState, date: string) =>
  s.habits.filter((h) => isScheduled(s, h, date));

export interface DayScore {
  pct: number | null; done: number; total: number; weightDone: number; weightTotal: number;
}

export function dayScore(s: AppState, date: string): DayScore {
  const list = scheduledOn(s, date);
  if (!list.length) return { pct: null, done: 0, total: 0, weightDone: 0, weightTotal: 0 };
  let done = 0, wDone = 0, wTotal = 0;
  list.forEach((h) => {
    const w = s.prefs.weighted ? h.weight || 1 : 1;
    wTotal += w;
    if (isDone(s, date, h.id)) { done++; wDone += w; }
  });
  return {
    pct: Math.round((wDone / wTotal) * 100),
    done, total: list.length, weightDone: wDone, weightTotal: wTotal,
  };
}

export function rangeScore(s: AppState, dates: string[]) {
  let wDone = 0, wTotal = 0, perfect = 0, activeDays = 0;
  dates.forEach((d) => {
    const day = dayScore(s, d);
    if (day.total === 0) return;
    activeDays++;
    wDone += day.weightDone;
    wTotal += day.weightTotal;
    if (day.done === day.total) perfect++;
  });
  return { pct: wTotal ? Math.round((wDone / wTotal) * 100) : null, perfect, activeDays };
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

export function habitStats(s: AppState, habit: Habit, windowDays = 30): HabitStats {
  const end = todayISO();
  const dates = rangeBack(end, windowDays);
  let scheduled = 0, done = 0, missed = 0;
  dates.forEach((d) => {
    if (daysBetween(habit.startDate, d) < 0) return;
    if (!(isScheduled(s, habit, d) || isDone(s, d, habit.id))) return;
    scheduled++;
    if (isDone(s, d, habit.id)) done++;
    else if (d !== end) missed++;
  });
  const half = Math.floor(windowDays / 2);
  const seg = (arr: string[]) => {
    let n = 0, dn = 0;
    arr.forEach((d) => {
      if (isScheduled(s, habit, d) || isDone(s, d, habit.id)) { n++; if (isDone(s, d, habit.id)) dn++; }
    });
    return n ? dn / n : null;
  };
  const older = seg(dates.slice(0, half)), recent = seg(dates.slice(half));
  let trend: Trend = "flat";
  if (older != null && recent != null) {
    if (recent - older > 0.12) trend = "up";
    else if (older - recent > 0.12) trend = "down";
  } else trend = "new";
  return {
    scheduled, done, missed,
    pct: scheduled ? Math.round((done / scheduled) * 100) : null,
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

export function weekSummary(s: AppState, weekOf: string, category: Category | null) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekOf, i))
    .filter((d) => daysBetween(d, todayISO()) >= 0);
  const habits = s.habits.filter((h) => h.active && (!category || h.category === category));
  let scheduled = 0, done = 0;
  const per = habits.map((habit) => {
    let n = 0, dn = 0;
    days.forEach((d) => {
      if (isScheduled(s, habit, d) || isDone(s, d, habit.id)) { n++; if (isDone(s, d, habit.id)) dn++; }
    });
    scheduled += n; done += dn;
    return { habit, pct: n ? Math.round((dn / n) * 100) : null, done: dn, scheduled: n };
  }).filter((x): x is { habit: Habit; pct: number; done: number; scheduled: number } => x.pct != null);
  const sorted = [...per].sort((a, b) => b.pct - a.pct);
  return {
    pct: scheduled ? Math.round((done / scheduled) * 100) : null,
    done, scheduled,
    best: sorted[0] ?? null,
    worst: sorted.length > 1 ? sorted[sorted.length - 1] : null,
    longest: habits.reduce((m, h) => Math.max(m, habitLongestStreak(s, h)), 0),
    daysCounted: days.length,
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
