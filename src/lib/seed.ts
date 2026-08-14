import { canonical } from "@/lib/templates";
import type { Category, HabitKind, Locale } from "@/lib/types";

/**
 * The starter set every new account gets.
 *
 * Only structure lives here — category, kind, weight, target, which goal it
 * serves. The words live in the dictionaries under `templates`, reached by key,
 * so a starter habit is not frozen into the language its owner signed up in.
 *
 * All of it is editable and deletable; none of it is special to the app.
 */

export interface SeedGoal {
  key: "career_growth" | "health_energy" | "learning";
}

export interface SeedHabit {
  /** Stable identity. The display name lives in the dictionaries. */
  key: string;
  category: Category;
  kind: HabitKind;
  weight: 1 | 2 | 3;
  target: number | null;
  /** A key into `templates.units`, not a rendered unit. */
  unit: string | null;
  goal: SeedGoal["key"] | null;
}

export const SEED_GOALS: SeedGoal[] = [
  { key: "career_growth" },
  { key: "health_energy" },
  { key: "learning" },
];

/**
 * The starter sheet, from the reference §3.
 *
 * Ten, on purpose. It has to be readable at a glance on the first morning —
 * the personalisation survey is what grows it, not the seed. Everything here
 * is a suggestion the user can keep, edit, pause or retire.
 */
export const SEED_HABITS: SeedHabit[] = [
  { key: "plan_priorities", category: "morning", kind: "good", weight: 3, target: null, unit: null, goal: "career_growth" },
  { key: "exercise", category: "morning", kind: "good", weight: 3, target: 20, unit: "min", goal: "health_energy" },
  { key: "read_for_learning", category: "morning", kind: "good", weight: 2, target: 20, unit: "min", goal: "learning" },
  { key: "begin_intentionally", category: "morning", kind: "good", weight: 2, target: null, unit: null, goal: null },
  { key: "important_goals", category: "daytime", kind: "good", weight: 3, target: 1, unit: "tasks", goal: "career_growth" },
  { key: "drink_water", category: "daytime", kind: "good", weight: 1, target: 8, unit: "glasses", goal: "health_energy" },
  { key: "movement_breaks", category: "daytime", kind: "good", weight: 2, target: null, unit: null, goal: "health_energy" },
  { key: "read_for_learning_night", category: "nighttime", kind: "good", weight: 2, target: 20, unit: "min", goal: "learning" },
  { key: "prepare_tomorrow", category: "nighttime", kind: "good", weight: 2, target: null, unit: null, goal: "career_growth" },
  { key: "bedtime_routine", category: "nighttime", kind: "good", weight: 3, target: null, unit: null, goal: "health_energy" },
];

/** Areas stay English keys; the UI translates them on render. */
const GOAL_AREA: Record<SeedGoal["key"], string> = {
  career_growth: "Career",
  health_energy: "Health",
  learning: "Learning",
};

type Q = <T = any>(text: string, params?: unknown[]) => Promise<T[]>;

/**
 * Creates the profile, preferences, goals, habits, schedules and goal links for
 * a new account. Runs inside the sign-up transaction, so an account never
 * exists half-seeded — the same guarantee the old database trigger gave.
 */
/**
 * Creates the profile, preferences, goals, habits, schedules and goal links for
 * a new account, inside the sign-up transaction so nothing exists half-seeded.
 *
 * The rows are identical whatever language the account signed up in: each
 * carries a `template_key`, and the interface renders the translation for it.
 * That is the whole fix for starter habits being stuck in one language.
 */
export async function seedAccount(q: Q, userId: string, locale: Locale) {
  await q("insert into profiles (id) values ($1)", [userId]);
  await q("insert into user_preferences (user_id, locale) values ($1,$2)", [userId, locale]);

  const goalIds = new Map<SeedGoal["key"], string>();
  for (const g of SEED_GOALS) {
    const rows = await q<{ id: string }>(
      "insert into goals (user_id, name, area, template_key) values ($1,$2,$3,$4) returning id",
      [userId, canonical("goals", g.key), GOAL_AREA[g.key], g.key],
    );
    goalIds.set(g.key, rows[0].id);
  }

  for (const h of SEED_HABITS) {
    const rows = await q<{ id: string }>(
      `insert into habits (user_id, name, template_key, category, kind, weight, target, unit,
                           status, sort_order)
       values ($1,$2,$3,$4::habit_category,$5::habit_kind,$6,$7,$8,'active',0) returning id`,
      [userId, canonical("habits", h.key), h.key, h.category, h.kind, h.weight, h.target, h.unit],
    );
    const habitId = rows[0].id;

    await q(
      "insert into habit_schedules (habit_id, user_id, mode) values ($1,$2,'daily')",
      [habitId, userId],
    );
    if (h.goal) {
      await q(
        "insert into goal_habits (goal_id, habit_id, user_id) values ($1,$2,$3)",
        [goalIds.get(h.goal), habitId, userId],
      );
    }
  }
}
