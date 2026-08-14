import type { Category, HabitKind, TrackingType } from "@/lib/types";

/**
 * The curated habit library (§10–11).
 *
 * Structure and suggested defaults only — every display string resolves through
 * `templates.habits` in the dictionaries, so the library reads in the language
 * the browser is using and adding a language never means editing this file.
 *
 * Everything here is a *suggestion*. Adopting a library habit copies it into the
 * user's own `habits` row, and from that moment the copy is theirs: editing it
 * does not change the catalogue, and the catalogue changing does not rewrite
 * anyone's habit.
 */
export interface LibraryHabit {
  key: string;
  category: Category;
  kind: HabitKind;
  /** §18 life domain, for browsing by area of life rather than time of day. */
  lifeDomain: "health" | "career" | "learning" | "money" | "relationships" | "home";
  tracking: TrackingType;
  weight: 1 | 2 | 3;
  /** §20. What still counts on a bad day, and what a good day looks like. */
  minimum: number | null;
  target: number | null;
  unit: string | null;
  frequency: "daily" | "days" | "times";
}

export const LIBRARY: LibraryHabit[] = [
  // ── morning ───────────────────────────────────────────────────────────────
  { key: "plan_priorities", category: "morning", kind: "good", lifeDomain: "career", tracking: "boolean", weight: 3, minimum: null, target: null, unit: null, frequency: "daily" },
  { key: "exercise", category: "morning", kind: "good", lifeDomain: "health", tracking: "duration", weight: 3, minimum: 5, target: 30, unit: "min", frequency: "daily" },
  { key: "read_for_learning", category: "morning", kind: "good", lifeDomain: "learning", tracking: "duration", weight: 2, minimum: 2, target: 30, unit: "min", frequency: "daily" },
  { key: "begin_intentionally", category: "morning", kind: "good", lifeDomain: "health", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily" },
  { key: "skip_early_email", category: "morning", kind: "avoid", lifeDomain: "career", tracking: "avoidance", weight: 1, minimum: null, target: null, unit: null, frequency: "daily" },
  { key: "brush_morning_night", category: "morning", kind: "good", lifeDomain: "health", tracking: "count", weight: 1, minimum: 1, target: 2, unit: "times", frequency: "daily" },

  // ── daytime ───────────────────────────────────────────────────────────────
  { key: "important_goals", category: "daytime", kind: "good", lifeDomain: "career", tracking: "count", weight: 3, minimum: 1, target: 3, unit: "tasks", frequency: "daily" },
  { key: "top_three_priorities", category: "daytime", kind: "good", lifeDomain: "career", tracking: "boolean", weight: 3, minimum: null, target: null, unit: null, frequency: "daily" },
  { key: "drink_water", category: "daytime", kind: "good", lifeDomain: "health", tracking: "quantity", weight: 1, minimum: 4, target: 8, unit: "glasses", frequency: "daily" },
  { key: "movement_breaks", category: "daytime", kind: "good", lifeDomain: "health", tracking: "interval", weight: 2, minimum: 2, target: 6, unit: "times", frequency: "daily" },
  { key: "stand_every_hour", category: "daytime", kind: "good", lifeDomain: "health", tracking: "interval", weight: 2, minimum: 3, target: 8, unit: "times", frequency: "daily" },
  { key: "avoid_junk_food", category: "daytime", kind: "avoid", lifeDomain: "health", tracking: "avoidance", weight: 2, minimum: null, target: null, unit: null, frequency: "daily" },
  { key: "downtime_learning", category: "daytime", kind: "good", lifeDomain: "learning", tracking: "duration", weight: 1, minimum: 5, target: 20, unit: "min", frequency: "daily" },
  { key: "record_spending", category: "daytime", kind: "good", lifeDomain: "money", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily" },

  // ── nighttime ─────────────────────────────────────────────────────────────
  { key: "read_for_learning_night", category: "nighttime", kind: "good", lifeDomain: "learning", tracking: "duration", weight: 2, minimum: 2, target: 30, unit: "min", frequency: "daily" },
  { key: "prepare_tomorrow", category: "nighttime", kind: "good", lifeDomain: "career", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily" },
  { key: "bedtime_routine", category: "nighttime", kind: "good", lifeDomain: "health", tracking: "boolean", weight: 3, minimum: null, target: null, unit: null, frequency: "daily" },
  { key: "limit_tv", category: "nighttime", kind: "avoid", lifeDomain: "home", tracking: "maximum", weight: 2, minimum: null, target: 1, unit: "hr", frequency: "daily" },
  { key: "limit_internet", category: "nighttime", kind: "avoid", lifeDomain: "home", tracking: "maximum", weight: 2, minimum: null, target: 1, unit: "hr", frequency: "daily" },
  { key: "review_spending", category: "nighttime", kind: "good", lifeDomain: "money", tracking: "boolean", weight: 1, minimum: null, target: null, unit: null, frequency: "times" },
  { key: "meaningful_goal_hour", category: "nighttime", kind: "good", lifeDomain: "career", tracking: "duration", weight: 3, minimum: 5, target: 60, unit: "min", frequency: "daily" },
  { key: "reach_out_to_someone", category: "nighttime", kind: "good", lifeDomain: "relationships", tracking: "boolean", weight: 1, minimum: null, target: null, unit: null, frequency: "times" },
];

export const libraryByKey = new Map(LIBRARY.map((h) => [h.key, h]));

/** The keys the starter sheet uses, so the library can mark what is already on it. */
export const libraryFor = (category: Category) =>
  LIBRARY.filter((h) => h.category === category).sort((a, b) => a.key.localeCompare(b.key));
