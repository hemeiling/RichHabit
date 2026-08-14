"use client";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import * as db from "@/lib/db";
import { isDone } from "@/lib/habits";
import { emptyState, isNumericTracking } from "@/lib/types";
import type {
  AppState, AwarenessEntry, DayMetrics, Goal, Habit, Prefs, Stack, WeeklyReview,
} from "@/lib/types";

interface Actions {
  toggle: (date: string, habitId: string) => void;
  /** Logs how much / how it went. A row exists only when done, so this marks it done. */
  logCompletion: (date: string, habitId: string, value: number | null, note: string) => void;
  saveHabit: (h: Habit) => void;
  deleteHabit: (id: string) => void;
  saveGoal: (g: Goal) => void;
  deleteGoal: (id: string) => void;
  setDayNote: (date: string, body: string) => void;
  saveAwareness: (e: AwarenessEntry) => void;
  deleteAwareness: (id: string) => void;
  saveStack: (k: Stack) => void;
  deleteStack: (id: string) => void;
  setMetrics: (date: string, m: DayMetrics) => void;
  saveReview: (r: WeeklyReview) => void;
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

    setDayNote: (date, body) => runDebounced(
      `note:${date}`,
      (s) => ({ ...s, dayNotes: { ...s.dayNotes, [date]: body } }),
      () => db.saveDayNote(date, body),
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
