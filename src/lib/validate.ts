import { ApiError, check, isUuid } from "@/lib/http";
import { isTemplateWording } from "@/lib/templates";
import { SPENDING_CATEGORIES } from "@/lib/types";
import { MAX_PRIORITIES } from "@/lib/types";
import type {
  AwarenessEntry, DayMetrics, Goal, Habit, Prefs, SpendingRecord, Stack, WeeklyReview,
} from "@/lib/types";

/**
 * Every request body is parsed into the shape SQL expects, or rejected as a 400.
 * Route handlers get a real `Habit`, not a cast — the cast was a lie whenever a
 * client sent something else, and the lie surfaced as a Postgres error.
 *
 * Only fields the write actually uses are read. Anything extra is dropped.
 */

const CATEGORIES = ["morning", "daytime", "nighttime"] as const;
const KINDS = ["good", "avoid"] as const;
const MODES = ["daily", "days", "times"] as const;
const GRADES = ["good", "bad", "neutral"] as const;
const THEMES = ["light", "dark"] as const;
const LOCALES = ["en", "zh", "both"] as const;
const STATUSES = ["candidate", "recommended", "planned", "active", "paused",
  "established", "retired"] as const;
const TRACKING = ["boolean", "count", "duration", "quantity",
  "interval", "maximum", "avoidance"] as const;

/** Keeps a template key only while the stored name still matches the template. */
function templateKeyFor(kind: "habits" | "goals", raw: unknown, name: string): string | null {
  if (typeof raw !== "string" || !raw) return null;
  if (!/^[a-z0-9_]{1,40}$/.test(raw)) return null;
  return isTemplateWording(kind, raw, name) ? raw : null;
}

const optionalUuid = (v: unknown, field: string): string =>
  v === "" || v == null ? "" : check.uuid(v, field);

function days(v: unknown): number[] {
  if (!Array.isArray(v)) return [0, 1, 2, 3, 4, 5, 6];
  const out = v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return [...new Set(out)].sort();
}

export function parseHabit(b: any): Habit {
  const mode = check.oneOf(b?.frequency?.mode, MODES, "frequency.mode");
  const weight = Number(b?.weight);
  if (![1, 2, 3].includes(weight)) throw new ApiError("weight must be 1, 2 or 3");

  const timesPerWeek = Number(b?.frequency?.timesPerWeek ?? 3);
  if (mode === "times" && !(timesPerWeek >= 1 && timesPerWeek <= 7)) {
    throw new ApiError("frequency.timesPerWeek must be between 1 and 7");
  }
  const chosen = days(b?.frequency?.days);
  if (mode === "days" && chosen.length === 0) {
    throw new ApiError("Pick at least one day of the week");
  }

  const name = check.text(b?.name, "name", 200).trim() || "Untitled";
  return {
    id: check.uuid(b?.id, "id"),
    name,
    // A template key survives only while the name is still the template's own
    // wording in some language. Rename it and it becomes the user's text,
    // permanently — checked here rather than trusting the client to clear it.
    templateKey: templateKeyFor("habits", b?.templateKey, name),
    description: check.text(b?.description, "description"),
    category: check.oneOf(b?.category, CATEGORIES, "category"),
    type: check.oneOf(b?.type, KINDS, "type"),
    frequency: { mode, days: chosen, timesPerWeek },
    tracking: check.oneOf(b?.tracking ?? "boolean", TRACKING, "tracking"),
    minimum: check.numberOrNull(b?.minimum, "minimum"),
    target: check.numberOrNull(b?.target, "target"),
    unit: check.text(b?.unit, "unit", 40),
    anchor: check.text(b?.anchor, "anchor", 200),
    environment: check.text(b?.environment, "environment", 300),
    friction: check.text(b?.friction, "friction", 300),
    startDate: check.date(b?.startDate, "startDate"),
    status: check.oneOf(b?.status ?? (b?.active === false ? "paused" : "active"), STATUSES, "status"),
    active: (b?.status ?? (b?.active === false ? "paused" : "active")) === "active",
    // §10. Ownership of the referenced habit is checked in the query layer;
    // this only guarantees the shape.
    replacesHabitId: isUuid(b?.replacesHabitId) ? b.replacesHabitId : null,
    // Generated prose, not something the client should be able to make long.
    rationale: check.text(b?.rationale, "rationale", 600) || null,
    weight: weight as 1 | 2 | 3,
    goalId: isUuid(b?.goalId) ? b.goalId : null,
    // Bounded so a client cannot write an order that overflows the int column.
    sortOrder: Math.min(9999, Math.max(0, Math.trunc(Number(b?.sortOrder) || 0))),
    createdAt: Number(b?.createdAt) || Date.now(),
  };
}

export function parseGoal(b: any): Goal {
  const name = check.text(b?.name, "name", 200).trim() || "Untitled";
  return {
    id: check.uuid(b?.id, "id"),
    name,
    templateKey: templateKeyFor("goals", b?.templateKey, name),
    area: check.text(b?.area, "area", 80) || "Health",
    why: check.text(b?.why, "why"),
  };
}

export function parseCompletion(b: any) {
  return {
    habitId: check.uuid(b?.habitId, "habitId"),
    date: check.date(b?.date, "date"),
    done: b?.done === true,
    value: check.numberOrNull(b?.value, "value"),
    note: check.text(b?.note, "note"),
  };
}

/** Bounds a journal entry so one day cannot be used as unbounded storage. */
export const MAX_GRATITUDE_ITEMS = 20;
export const MAX_GRATITUDE_LENGTH = 300;

export function parseJournal(b: any) {
  const raw = Array.isArray(b?.gratitude) ? b.gratitude : [];
  if (raw.length > MAX_GRATITUDE_ITEMS) {
    throw new ApiError(`A day can hold at most ${MAX_GRATITUDE_ITEMS} entries`);
  }
  // Blank lines are the natural state of a form with three boxes and one thing
  // to say, so they are dropped rather than refused.
  const gratitude = raw
    .map((v: unknown) => check.text(v, "gratitude", MAX_GRATITUDE_LENGTH).trim())
    .filter(Boolean);

  return {
    date: check.date(b?.date, "date"),
    gratitude,
    reflection: check.text(b?.reflection ?? b?.body, "reflection", 10_000),
  };
}

export const MAX_PRIORITY_LENGTH = 200;

/**
 * A new line on the post-it.
 *
 * The five-item cap is not checked here. It is a rule about what a *day* holds,
 * and a day's contents are now derived from dates rather than sent by the
 * client — so the server would have to recompute the day to enforce it, and
 * `addPriority` does exactly that before inserting. Here we only check that the
 * line is a line.
 */
export function parseNewPriority(b: any) {
  const text = check.text(b?.text, "text", MAX_PRIORITY_LENGTH).trim();
  if (!text) throw new ApiError("A priority needs some words");
  return { id: check.uuid(b?.id, "id"), text, date: check.date(b?.date, "date") };
}

/**
 * Ticking or un-ticking. `date` is the day being looked at, which is the day
 * the completion is recorded against — see `setPriorityDone`.
 */
export function parsePriorityDone(b: any) {
  return {
    id: check.uuid(b?.id, "id"),
    done: b?.done === true,
    date: check.date(b?.date, "date"),
  };
}

export function parseMonthlyReflection(b: any) {
  const month = check.text(b?.month, "month", 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ApiError("month must be YYYY-MM");
  return { month, body: check.text(b?.body, "body", 10_000) };
}

export function parseAwareness(b: any): AwarenessEntry {
  const time = check.text(b?.time, "time", 5);
  if (time && !/^\d{2}:\d{2}$/.test(time)) throw new ApiError("time must be HH:MM");
  return {
    id: check.uuid(b?.id, "id"),
    time,
    activity: check.text(b?.activity, "activity", 200).trim() || "Untitled",
    duration: check.text(b?.duration, "duration", 40),
    context: check.text(b?.context, "context", 200),
    notes: check.text(b?.notes, "notes"),
    grade: check.oneOf(b?.grade, GRADES, "grade"),
  };
}

export function parseStack(b: any): Stack {
  const time = check.text(b?.time, "time", 5);
  if (time && !/^\d{2}:\d{2}$/.test(time)) throw new ApiError("time must be HH:MM");
  const stack: Stack = {
    id: check.uuid(b?.id, "id"),
    triggerHabitId: optionalUuid(b?.triggerHabitId, "triggerHabitId"),
    triggerText: check.text(b?.triggerText, "triggerText", 200),
    newHabitId: optionalUuid(b?.newHabitId, "newHabitId"),
    newText: check.text(b?.newText, "newText", 200),
    time,
    location: check.text(b?.location, "location", 200),
  };
  // Mirrors the stack_has_trigger / stack_has_target check constraints, so a
  // half-filled form is a message rather than a constraint violation.
  if (!stack.triggerHabitId && !stack.triggerText) throw new ApiError("A stack needs a trigger");
  if (!stack.newHabitId && !stack.newText) throw new ApiError("A stack needs something to attach");
  return stack;
}

export function parseMetrics(b: any): { date: string; metrics: DayMetrics } {
  const m = b?.metrics ?? {};
  return {
    date: check.date(b?.date, "date"),
    metrics: {
      weight: check.numberOrNull(m.weight, "weight"),
      calories: check.numberOrNull(m.calories, "calories"),
      sleep: check.numberOrNull(m.sleep, "sleep"),
      water: check.numberOrNull(m.water, "water"),
      cardioMin: check.numberOrNull(m.cardioMin, "cardioMin"),
      cardio: m.cardio === true,
      gym: m.gym === true,
    },
  };
}

export function parseReview(b: any): WeeklyReview {
  return {
    id: check.uuid(b?.id, "id"),
    weekStart: check.date(b?.weekStart, "weekStart"),
    wentWell: check.text(b?.wentWell, "wentWell", 10_000),
    gotInWay: check.text(b?.gotInWay, "gotInWay", 10_000),
    focus: check.text(b?.focus, "focus", 10_000),
    modify: check.text(b?.modify, "modify", 10_000),
    add: check.text(b?.add, "add", 10_000),
    // Written as jsonb; the shape is the app's own snapshot, not user input.
    stats: b?.stats && typeof b.stats === "object" ? b.stats : undefined,
  };
}

export function parseSpending(b: any): SpendingRecord {
  const amount = check.numberOrNull(b?.amount, "amount");
  if (amount == null || amount < 0) throw new ApiError("amount must be zero or more");
  if (amount > 1_000_000_000) throw new ApiError("amount is too large");
  return {
    id: check.uuid(b?.id, "id"),
    date: check.date(b?.date, "date"),
    // Two decimal places: currency-agnostic, but still money.
    amount: Math.round(amount * 100) / 100,
    description: check.text(b?.description, "description", 200),
    category: check.oneOf(b?.category ?? "other", SPENDING_CATEGORIES, "category"),
    needWant: check.oneOf(b?.needWant ?? "need", ["need", "want"] as const, "needWant"),
    planned: b?.planned !== false,
    notes: check.text(b?.notes, "notes", 500),
  };
}

export function parsePrefs(b: any): Prefs {
  return {
    theme: check.oneOf(b?.theme, THEMES, "theme"),
    weighted: b?.weighted !== false,
    goalWeight: check.numberOrNull(b?.goalWeight, "goalWeight"),
    locale: check.oneOf(b?.locale ?? "en", LOCALES, "locale"),
  };
}

/**
 * A list of ids, for operations that are about the list rather than about any
 * one row — reordering a section, for instance. Bounded, because the only
 * legitimate caller sends one section's worth.
 */
export function parseIdList(b: any, field: string): string[] {
  const raw = b?.[field];
  if (!Array.isArray(raw)) throw new ApiError(`${field} must be an array`);
  if (raw.length > 200) throw new ApiError(`${field} has too many entries`);
  return raw.map((v, i) => check.uuid(v, `${field}[${i}]`));
}
