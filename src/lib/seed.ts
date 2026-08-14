import { libraryByKey } from "@/lib/library";
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

/**
 * A starter entry is a library key plus the goal it serves. Everything else —
 * category, kind, weight, tracking type, minimum, target, unit — comes from
 * `src/lib/library.ts`, so a template's suggested defaults are defined once
 * (§11) rather than drifting between the catalogue and the seed.
 */
export interface SeedHabit {
  key: string;
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
  { key: "plan_priorities", goal: "career_growth" },
  { key: "exercise", goal: "health_energy" },
  { key: "read_for_learning", goal: "learning" },
  { key: "begin_intentionally", goal: null },
  { key: "important_goals", goal: "career_growth" },
  { key: "drink_water", goal: "health_energy" },
  { key: "movement_breaks", goal: "health_energy" },
  { key: "read_for_learning_night", goal: "learning" },
  { key: "prepare_tomorrow", goal: "career_growth" },
  { key: "bedtime_routine", goal: "health_energy" },
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
    // The template's suggested defaults, from the one place they are defined.
    const tpl = libraryByKey.get(h.key);
    if (!tpl) continue;   // a starter key with no library entry is a bug, not a row

    const rows = await q<{ id: string }>(
      `insert into habits (user_id, name, template_key, category, kind, weight,
                           tracking_type, minimum, target, unit, status, sort_order)
       values ($1,$2,$3,$4::habit_category,$5::habit_kind,$6,$7::tracking_type,$8,$9,$10,'active',0)
       returning id`,
      [userId, canonical("habits", h.key), h.key, tpl.category, tpl.kind, tpl.weight,
        tpl.tracking, tpl.minimum, tpl.target, tpl.unit],
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
