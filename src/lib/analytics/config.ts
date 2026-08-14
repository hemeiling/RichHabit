/**
 * Every threshold the analytics use, in one place. The engagement bands and the
 * activation rule are product judgements that will change; changing them here
 * must not mean touching a query or a component.
 */

export const SESSION_IDLE_MINUTES = 30;

/** Engagement bands, evaluated top-down; the first match wins. */
export const ENGAGEMENT = {
  /** Signed up within this many days, regardless of what they have done. */
  newUserDays: 7,
  /** Active on at least this many distinct days in the last 7. */
  highlyEngagedDaysPerWeek: 3,
  /** Seen within this many days counts as active. */
  activeWithinDays: 7,
  /** Previously active, but nothing for this long. */
  atRiskAfterDays: 14,
  /** Nothing for this long. */
  dormantAfterDays: 30,
} as const;

export type EngagementStatus = "new" | "highly_engaged" | "active" | "at_risk" | "dormant";

/**
 * Activation: created a habit *and* recorded activity on N distinct days inside
 * the first M days. Both numbers are here so the definition can be retuned
 * without a migration — activation is derived from events on read, never stored.
 */
export const ACTIVATION = {
  windowDays: 7,
  distinctActiveDays: 3,
} as const;

/** Retention checkpoints, in days after signup. */
export const RETENTION_DAYS = [1, 7, 30] as const;

/**
 * Which events roll up into which product feature, for the adoption table.
 * A feature is "adopted" by a user if they have produced any of its events.
 */
export const FEATURES = {
  habits: {
    label: "Daily habit tracking",
    events: ["habit_completed", "habit_uncompleted", "habit_created", "habit_edited", "habit_archived"],
  },
  goals: { label: "Goals", events: ["goal_created", "goal_updated", "goal_deleted"] },
  review: { label: "Weekly review", events: ["weekly_review_completed"] },
  metrics: { label: "Metrics", events: ["metric_logged"] },
  awareness: { label: "Habit awareness", events: ["habit_awareness_entry_created"] },
  stacking: { label: "Habit stacking", events: ["habit_stack_created"] },
  coach: { label: "AI coach", events: ["coach_question_asked"] },
} as const;

export type FeatureKey = keyof typeof FEATURES;

/** The reverse map, so an event can name its own feature. */
export const FEATURE_OF_EVENT: Record<string, FeatureKey> = Object.fromEntries(
  Object.entries(FEATURES).flatMap(([key, f]) =>
    f.events.map((e) => [e, key as FeatureKey]),
  ),
);

export const APP_VERSION = process.env.npm_package_version ?? "0.1.0";
