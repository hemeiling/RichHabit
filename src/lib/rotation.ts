import { daysBetween, weekStart, addDays } from "./dates";

/**
 * HT-2c. A habit that rotates through a fixed list, one item per week —
 * Franklin's method: "I determined to give a week's strict attention to each
 * of the virtues successively", thirteen weeks to a course, then round again.
 *
 * The habit is ONE habit (one row, one completion history, one place on the
 * active list); only what it asks of you changes with the week. Which item a
 * day belongs to is derived, never stored:
 *
 *     item = list[ whole weeks from rotationStart to the day's week  mod  length ]
 *
 * `rotationStart` is the Sunday the cycle began on (weeks run Sunday to
 * Saturday, like the rest of the app) and is fixed when the habit is created,
 * so every past week keeps the virtue it had — its history cannot be
 * re-labelled by a later edit. After the last item the list starts again;
 * a missed day is only that day, and the next week moves on regardless.
 */

/** Franklin's thirteen, in his order (Autobiography, 1791). Never reorder: history is derived from it. */
export const FRANKLIN_VIRTUES = [
  "temperance", "silence", "order", "resolution", "frugality", "industry",
  "sincerity", "justice", "moderation", "cleanliness", "tranquility",
  "chastity", "humility",
] as const;

export const ROTATIONS = {
  franklin_virtues: FRANKLIN_VIRTUES.map((v) => `franklin_${v}`),
} as const;

export type Rotation = keyof typeof ROTATIONS;
export const isRotation = (v: unknown): v is Rotation =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(ROTATIONS, v);

/** The template keys a rotation cycles through. */
export const rotationKeys = (rotation: Rotation): readonly string[] => ROTATIONS[rotation];

export interface RotationItem {
  /** The template key of this week's item, e.g. `franklin_order`. */
  key: string;
  /** 0-based place in the list. */
  index: number;
  length: number;
  /** Which time round the list this is, from 1 — useful to say "second course". */
  course: number;
}

/** The item `date` falls in. Weeks before the start count backwards round the list. */
export function rotationItemOn(rotation: Rotation, rotationStart: string, date: string): RotationItem {
  const keys = ROTATIONS[rotation];
  const weeks = Math.floor(daysBetween(weekStart(rotationStart), weekStart(date)) / 7);
  const index = ((weeks % keys.length) + keys.length) % keys.length;
  return { key: keys[index], index, length: keys.length, course: Math.floor(weeks / keys.length) + 1 };
}

/**
 * The Sunday to record as the start so that `today`'s week is item `index` —
 * "start this week with Order" is the cycle having begun two weeks ago.
 */
export function rotationStartFor(today: string, index = 0): string {
  return addDays(weekStart(today), -7 * index);
}
