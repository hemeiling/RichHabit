"use client";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import * as db from "@/lib/db";
import { isDone, uid } from "@/lib/habits";
import { emptyState, isNumericTracking } from "@/lib/types";
import type {
  AppState, AwarenessEntry, DayJournal, DayMetrics, Goal, Habit, Prefs, Priority,
  SpendingRecord,
  Stack, WeeklyReview,
} from "@/lib/types";

interface Actions {
  toggle: (date: string, habitId: string) => void;
  /** Logs how much / how it went. A row exists only when done, so this marks it done. */
  logCompletion: (date: string, habitId: string, value: number | null, note: string) => void;
  saveHabit: (h: Habit) => void;
  deleteHabit: (id: string) => void;
  /** The user's arrangement of one section, as the ids in their new order. */
  reorderHabits: (ids: string[]) => void;
  saveGoal: (g: Goal) => void;
  deleteGoal: (id: string) => void;
  /** The day's gratitude journal. Auto-saved; nothing to click. */
  setJournal: (date: string, entry: DayJournal) => void;
  setMonthlyReflection: (month: string, body: string) => void;
  /**
   * The post-it. A call per record rather than one "save the day", because an
   * open priority is not owned by a day — see lib/priorities.
   */
  addPriority: (date: string, text: string) => void;
  /** `date` is the day on screen: the day the completion is recorded against. */
  setPriorityDone: (id: string, done: boolean, date: string) => void;
  deletePriority: (id: string) => void;
  reorderPriorities: (ids: string[]) => void;
  saveAwareness: (e: AwarenessEntry) => void;
  deleteAwareness: (id: string) => void;
  saveStack: (k: Stack) => void;
  deleteStack: (id: string) => void;
  setMetrics: (date: string, m: DayMetrics) => void;
  saveReview: (r: WeeklyReview) => void;
  saveSpending: (r: SpendingRecord) => void;
  deleteSpending: (id: string) => void;
  setPrefs: (p: Partial<Prefs>) => void;
}

interface Ctx {
  state: AppState;
  actions: Actions;
  loading: boolean;
  saving: boolean;
  error: string | null;
  dismissError: () => void;
  /** Re-read the account, for rows the server created rather than the client. */
  reload: () => Promise<void>;
}

const HabitsContext = createContext<Ctx | null>(null);

/**
 * §20. Whether a recorded amount clears the habit's bar. Mirrors the derivation
 * in `db/queries.ts`, which is authoritative — this only keeps the optimistic
 * update honest between the tap and the next load.
 */
function countsAsDone(habit: Habit | undefined, value: number | null): boolean {
  if (!habit || value == null || !isNumericTracking(habit.tracking)) return true;
  if (habit.tracking === "maximum") return habit.target == null || value <= habit.target;
  const bar = habit.minimum ?? habit.target;
  return bar == null ? value > 0 : value >= bar;
}

export function useHabits() {
  const ctx = useContext(HabitsContext);
  if (!ctx) throw new Error("useHabits must be used inside <HabitsProvider>");
  return ctx;
}

export function HabitsProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const debounced = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    let alive = true;
    db.loadAll()
      .then((s) => { if (alive) setState(s); })
      .catch((e: Error) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [userId]);

  /**
   * Re-reads the account. Needed when the server writes rows the client did not
   * originate — recommendations, for instance, arrive from the model rather
   * than from an optimistic local edit.
   */
  const reload = useCallback(async () => {
    try {
      setState(await db.loadAll());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  /** Update the screen immediately, write in the background, roll back if the write fails. */
  const run = useCallback((next: (s: AppState) => AppState, write: () => Promise<unknown>) => {
    let previous: AppState;
    setState((s) => { previous = s; return next(s); });
    setPending((n) => n + 1);
    write()
      .then(() => setError(null))
      .catch((e: Error) => {
        setState(previous!);
        setError(`${e.message}. That change wasn't saved.`);
      })
      .finally(() => setPending((n) => n - 1));
  }, []);

  /** For fields typed into: keep the UI live, write once the typing stops. */
  const runDebounced = useCallback((key: string, next: (s: AppState) => AppState, write: () => Promise<unknown>) => {
    setState(next);
    clearTimeout(debounced.current[key]);
    setPending((n) => n + 1);
    debounced.current[key] = setTimeout(() => {
      write()
        .then(() => setError(null))
        .catch((e: Error) => setError(`${e.message}. That change wasn't saved.`))
        .finally(() => setPending((n) => n - 1));
    }, 600);
  }, []);

  useEffect(() => {
    const timers = debounced.current;
    return () => Object.values(timers).forEach(clearTimeout);
  }, []);

  const actions: Actions = {
    toggle: (date, habitId) => {
      const done = !isDone(state, date, habitId);
      run(
        (s) => {
          const day = { ...(s.completions[date] ?? {}) };
          if (done) day[habitId] = { done: true };
          else delete day[habitId];
          return { ...s, completions: { ...s.completions, [date]: day } };
        },
        () => db.setCompletion(habitId, date, done),
      );
    },

    logCompletion: (date, habitId, value, note) => run(
      (s) => ({
        ...s,
        completions: {
          ...s.completions,
          [date]: {
            ...(s.completions[date] ?? {}),
            // Derived the same way the server does, so the row does not flash
            // as complete before the next load corrects it.
            [habitId]: { done: countsAsDone(s.habits.find((h) => h.id === habitId), value), value, note },
          },
        },
      }),
      () => db.setCompletion(habitId, date, true, value, note),
    ),

    saveHabit: (h) => run(
      (s) => ({
        ...s,
        habits: s.habits.some((x) => x.id === h.id)
          ? s.habits.map((x) => (x.id === h.id ? h : x))
          : [...s.habits, h],
      }),
      () => db.saveHabit(h),
    ),

    deleteHabit: (id) => run(
      (s) => {
        const completions: AppState["completions"] = {};
        Object.entries(s.completions).forEach(([d, m]) => {
          const { [id]: _gone, ...rest } = m;
          if (Object.keys(rest).length) completions[d] = rest;
        });
        return {
          ...s,
          habits: s.habits.filter((h) => h.id !== id),
          completions,
          stacks: s.stacks.filter((k) => k.triggerHabitId !== id && k.newHabitId !== id),
        };
      },
      () => db.deleteHabit(id),
    ),

    reorderHabits: (ids) => {
      // The order is a fact about the list, so it is applied to the list in one
      // go and written in one request rather than one save per habit.
      const rank = new Map(ids.map((id, i) => [id, i]));
      run(
        (s) => ({
          ...s,
          habits: s.habits.map((h) => (rank.has(h.id) ? { ...h, sortOrder: rank.get(h.id)! } : h))
            .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt),
        }),
        () => db.reorderHabits(ids),
      );
    },

    saveGoal: (g) => run(
      (s) => ({
        ...s,
        goals: s.goals.some((x) => x.id === g.id) ? s.goals.map((x) => (x.id === g.id ? g : x)) : [...s.goals, g],
      }),
      () => db.saveGoal(g),
    ),

    deleteGoal: (id) => run(
      (s) => ({
        ...s,
        goals: s.goals.filter((g) => g.id !== id),
        habits: s.habits.map((h) => (h.goalId === id ? { ...h, goalId: null } : h)),
      }),
      () => db.deleteGoal(id),
    ),

    setJournal: (date, entry) => runDebounced(
      `journal:${date}`,
      (s) => ({ ...s, journal: { ...s.journal, [date]: entry } }),
      // Blank lines are dropped on the way out: a form with three boxes and one
      // thing to say should not store two empty entries.
      () => db.saveJournal(date, entry.gratitude.map((g) => g.trim()).filter(Boolean),
        entry.reflection),
    ),

    /*
     * Not debounced, unlike the journal. Each of these is a discrete act on one
     * record — a line written, ticked, struck out — rather than a field being
     * typed into, and the id has to reach the server before the next tap on the
     * same row can. Ticking is what stops a priority rolling forward, so it is
     * also the one write here that must not be lost.
     */
    addPriority: (date, text) => {
      const id = uid();
      run(
        (s) => ({
          ...s,
          priorities: [...s.priorities, { id, text, createdOn: date, completedOn: null }],
        }),
        () => db.addPriority(id, text, date),
      );
    },

    setPriorityDone: (id, done, date) => run(
      (s) => ({
        ...s,
        priorities: s.priorities.map((p) =>
          (p.id === id ? { ...p, completedOn: done ? date : null } : p)),
      }),
      () => db.setPriorityDone(id, done, date),
    ),

    deletePriority: (id) => run(
      (s) => ({ ...s, priorities: s.priorities.filter((p) => p.id !== id) }),
      () => db.deletePriority(id),
    ),

    reorderPriorities: (ids) => run(
      (s) => {
        // The ids are the visible subset of one day; everything not on screen
        // keeps its place, so reordering today cannot shuffle a past day.
        const rank = new Map(ids.map((id, i) => [id, i]));
        const moving = s.priorities.filter((p) => rank.has(p.id));
        moving.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
        const queue = moving[Symbol.iterator]();
        return {
          ...s,
          priorities: s.priorities.map((p) => (rank.has(p.id) ? queue.next().value! : p)),
        };
      },
      () => db.reorderPriorities(ids),
    ),

    setMonthlyReflection: (month, body) => runDebounced(
      `reflection:${month}`,
      (s) => ({ ...s, monthlyReflections: { ...s.monthlyReflections, [month]: body } }),
      () => db.saveMonthlyReflection(month, body),
    ),

    saveAwareness: (e) => run(
      (s) => ({
        ...s,
        awareness: s.awareness.some((x) => x.id === e.id)
          ? s.awareness.map((x) => (x.id === e.id ? e : x))
          : [...s.awareness, e],
      }),
      () => db.saveAwareness(e),
    ),

    deleteAwareness: (id) => run(
      (s) => ({ ...s, awareness: s.awareness.filter((e) => e.id !== id) }),
      () => db.deleteAwareness(id),
    ),

    saveStack: (k) => run(
      (s) => ({
        ...s,
        stacks: s.stacks.some((x) => x.id === k.id) ? s.stacks.map((x) => (x.id === k.id ? k : x)) : [...s.stacks, k],
      }),
      () => db.saveStack(k),
    ),

    deleteStack: (id) => run(
      (s) => ({ ...s, stacks: s.stacks.filter((k) => k.id !== id) }),
      () => db.deleteStack(id),
    ),

    setMetrics: (date, m) => {
      const merged = { ...(state.metrics[date] ?? {}), ...m };
      runDebounced(
        `metrics:${date}`,
        (s) => ({ ...s, metrics: { ...s.metrics, [date]: { ...(s.metrics[date] ?? {}), ...m } } }),
        () => db.saveMetrics(date, merged),
      );
    },

    saveReview: (r) => run(
      (s) => ({
        ...s,
        reviews: s.reviews.some((x) => x.weekStart === r.weekStart)
          ? s.reviews.map((x) => (x.weekStart === r.weekStart ? r : x))
          : [...s.reviews, r],
      }),
      () => db.saveReview(r),
    ),

    saveSpending: (r) => run(
      (s) => ({
        ...s,
        spending: s.spending.some((x) => x.id === r.id)
          ? s.spending.map((x) => (x.id === r.id ? r : x))
          : [r, ...s.spending],
      }),
      () => db.saveSpending(r),
    ),

    deleteSpending: (id) => run(
      (s) => ({ ...s, spending: s.spending.filter((r) => r.id !== id) }),
      () => db.deleteSpending(id),
    ),

    setPrefs: (p) => {
      const next = { ...state.prefs, ...p };
      run((s) => ({ ...s, prefs: next }), () => db.savePrefs(next));
    },
  };

  return (
    <HabitsContext.Provider
      value={{ state, actions, loading, saving: pending > 0, error, reload,
        dismissError: () => setError(null) }}
    >
      {children}
    </HabitsContext.Provider>
  );
}
