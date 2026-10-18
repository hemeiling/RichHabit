import { todayISO } from "@/lib/dates";
import { blankHabit } from "@/lib/habits";
import { rotationStartFor } from "@/lib/rotation";
import type { Rotation } from "@/lib/rotation";
import { canonical, canonicalDescription } from "@/lib/templates";
import type { Category, Habit, HabitKind, TrackingType } from "@/lib/types";

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
  /** Suggested weekdays when `frequency` is "days" (0 = Sunday). */
  days?: number[];
  /** Suggested count when `frequency` is "times". */
  timesPerWeek?: number;
  /**
   * §10. Which shelf of the catalogue this sits on. The starter set has no
   * tag; the named collections are browsed and added as a set.
   */
  collection?: "franklin" | "history";
  /**
   * HT-2c. The habit rotates through this list, one item a week. Added on its
   * own, never as part of its shelf's "add all": the shelf already carries
   * each item as a habit of its own.
   */
  rotation?: Rotation;
  /**
   * The citation shown with a historical template — resolved through
   * `templates.sources`, present on every `collection` item. Each of those
   * practices is documented in the named primary source; frequencies are
   * only ever the source's own, never invented here.
   */
  source?: boolean;
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
  { key: "review_spending", category: "nighttime", kind: "good", lifeDomain: "money", tracking: "boolean", weight: 1, minimum: null, target: null, unit: null, frequency: "times", timesPerWeek: 1 },
  { key: "meaningful_goal_hour", category: "nighttime", kind: "good", lifeDomain: "career", tracking: "duration", weight: 3, minimum: 5, target: 60, unit: "min", frequency: "daily" },
  { key: "reach_out_to_someone", category: "nighttime", kind: "good", lifeDomain: "relationships", tracking: "boolean", weight: 1, minimum: null, target: null, unit: null, frequency: "times", timesPerWeek: 3 },

  /*
   * ── Franklin's thirteen virtues ──────────────────────────────────────────
   * From his Autobiography: a short precept per virtue (the descriptions
   * quote them), faults marked "every evening" — hence nighttime, daily.
   * He took the virtues one week at a time. The rotating habit below does
   * exactly that as ONE habit; each virtue is also here as an ordinary daily
   * habit for anyone who wants to keep one all the time.
   */
  { key: "franklin_virtue_week", category: "nighttime", kind: "good", lifeDomain: "home", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily", collection: "franklin", source: true, rotation: "franklin_virtues" },
  ...([
    "temperance", "silence", "order", "resolution", "frugality", "industry",
    "sincerity", "justice", "moderation", "cleanliness", "tranquility",
    "chastity", "humility",
  ].map((v): LibraryHabit => ({
    key: `franklin_${v}`, category: "nighttime", kind: "good", lifeDomain: "home",
    tracking: "boolean", weight: 2, minimum: null, target: null, unit: null,
    frequency: "daily", collection: "franklin", source: true,
  }))),
  { key: "franklin_morning_question", category: "morning", kind: "good", lifeDomain: "home", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily", collection: "franklin", source: true },
  { key: "franklin_evening_question", category: "nighttime", kind: "good", lifeDomain: "home", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily", collection: "franklin", source: true },

  /*
   * ── Practices from history ───────────────────────────────────────────────
   * Only practices their own words or an eyewitness documented, each cited
   * in `templates.sources`. Stated frequencies only: everything here was
   * described as daily (Gates: "almost every night") by its source; where a
   * source gave no amount, the template suggests none.
   */
  { key: "marcus_morning_prep", category: "morning", kind: "good", lifeDomain: "home", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily", collection: "history", source: true },
  { key: "darwin_morning_walk", category: "morning", kind: "good", lifeDomain: "health", tracking: "boolean", weight: 1, minimum: null, target: null, unit: null, frequency: "daily", collection: "history", source: true },
  { key: "hemingway_morning_writing", category: "morning", kind: "good", lifeDomain: "career", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily", collection: "history", source: true },
  { key: "darwin_daily_walk", category: "daytime", kind: "good", lifeDomain: "health", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily", collection: "history", source: true },
  { key: "buffett_reading_block", category: "daytime", kind: "good", lifeDomain: "learning", tracking: "duration", weight: 2, minimum: null, target: null, unit: "min", frequency: "daily", collection: "history", source: true },
  { key: "bezos_hard_before_lunch", category: "daytime", kind: "good", lifeDomain: "career", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily", collection: "history", source: true },
  { key: "seneca_evening_review", category: "nighttime", kind: "good", lifeDomain: "home", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily", collection: "history", source: true },
  { key: "gates_reading_before_sleep", category: "nighttime", kind: "good", lifeDomain: "learning", tracking: "duration", weight: 2, minimum: 10, target: 60, unit: "min", frequency: "daily", collection: "history", source: true },
  { key: "bezos_sleep_eight", category: "nighttime", kind: "good", lifeDomain: "health", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily", collection: "history", source: true },
];

/** The named shelves, in display order. */
export const COLLECTIONS = ["franklin", "history"] as const;
export type CollectionKey = (typeof COLLECTIONS)[number];

/**
 * A library entry as a habit this account owns — the one definition, used by
 * Add Habit and by Refine. The template's own suggestions all come across:
 * tracking, bounds, unit, weight, and the frequency *it* names (both callers
 * once rebuilt this by hand, each dropping or hard-coding the frequency).
 * `status` is the caller's: "active" from the sheet, "planned" into the
 * backlog — never anything the user did not ask for.
 */
export function habitFromLibrary(
  item: LibraryHabit,
  over: { category?: Category; sortOrder?: number; status?: "active" | "planned" } = {},
): Habit {
  const status = over.status ?? "active";
  return {
    ...blankHabit(),
    name: canonical("habits", item.key),
    description: canonicalDescription(item.key),
    templateKey: item.key,
    category: over.category ?? item.category,
    type: item.kind,
    tracking: item.tracking,
    minimum: item.minimum,
    target: item.target,
    unit: item.unit ?? "",
    weight: item.weight,
    frequency: {
      mode: item.frequency,
      days: item.days ?? [0, 1, 2, 3, 4, 5, 6],
      timesPerWeek: item.timesPerWeek ?? 3,
    },
    sortOrder: over.sortOrder ?? 0,
    status,
    active: status === "active",
    // This week is the first item unless the person chooses otherwise in the editor.
    ...(item.rotation ? { rotation: item.rotation, rotationStart: rotationStartFor(todayISO()) } : {}),
  };
}

export const libraryByKey = new Map(LIBRARY.map((h) => [h.key, h]));

/** The keys the starter sheet uses, so the library can mark what is already on it. */
export const libraryFor = (category: Category) =>
  LIBRARY.filter((h) => h.category === category).sort((a, b) => a.key.localeCompare(b.key));
