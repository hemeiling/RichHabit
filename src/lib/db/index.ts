"use client";
import type {
  AppState, AwarenessEntry, DayMetrics, Goal, Habit, Prefs, Stack, WeeklyReview,
} from "@/lib/types";

/**
 * The browser's half of data access. No SQL and no credentials live here — each
 * function is one call to /api/*, which resolves the user from the session
 * cookie and does the query. Screens never import this directly; they call the
 * store, the store calls these.
 *
 * Signatures no longer take a user id. The server will not accept one.
 */

/** IANA zone name, so the server can report activity in the user's local time. */
const timezone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
};

async function send(path: string, init: RequestInit): Promise<any> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", "x-rh-timezone": timezone(), ...init.headers },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

const post = (path: string, payload: unknown) =>
  send(path, { method: "POST", body: JSON.stringify(payload) });

const remove = (path: string, id: string) =>
  send(`${path}?id=${encodeURIComponent(id)}`, { method: "DELETE" });

export async function loadAll(): Promise<AppState> {
  return send("/api/state", { method: "GET" });
}

export const saveHabit = (h: Habit) => post("/api/habits", h);
export const deleteHabit = (id: string) => remove("/api/habits", id);

export const setCompletion = (
  habitId: string, date: string, done: boolean, value?: number | null, note?: string,
) => post("/api/completions", { habitId, date, done, value, note });

export const saveGoal = (g: Goal) => post("/api/goals", g);
export const deleteGoal = (id: string) => remove("/api/goals", id);

export const saveDayNote = (date: string, body: string) => post("/api/notes", { date, body });

export const saveAwareness = (e: AwarenessEntry) => post("/api/awareness", e);
export const deleteAwareness = (id: string) => remove("/api/awareness", id);

export const saveStack = (k: Stack) => post("/api/stacks", k);
export const deleteStack = (id: string) => remove("/api/stacks", id);

export const saveMetrics = (date: string, metrics: DayMetrics) =>
  post("/api/metrics", { date, metrics });

export const saveReview = (r: WeeklyReview) => post("/api/reviews", r);

export const savePrefs = (p: Prefs) => post("/api/prefs", p);
