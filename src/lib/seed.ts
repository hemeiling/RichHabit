import type { Category, HabitKind, Locale } from "@/lib/types";

/**
 * The starter set every new account gets, in the language they signed up in.
 *
 * This used to be `seed_new_user()` in SQL. It moved here because the habit
 * names have to be translated, and because deriving `kind` from an English name
 * prefix ("Avoid…", "Limit…", "Skip…") stopped working the moment the names
 * were Chinese. Kind is now stated outright.
 *
 * All of it is editable and deletable — none of these are special to the app.
 */

export interface SeedGoal {
  key: "career" | "health" | "learning";
  name: string;
  area: string;
}

export interface SeedHabit {
  name: string;
  category: Category;
  kind: HabitKind;
  weight: 1 | 2 | 3;
  target: number | null;
  unit: string | null;
  goal: SeedGoal["key"] | null;
}

interface SeedSet {
  goals: SeedGoal[];
  habits: SeedHabit[];
}

const EN: SeedSet = {
  goals: [
    { key: "career", name: "Career growth", area: "Career" },
    { key: "health", name: "Health & energy", area: "Health" },
    { key: "learning", name: "Learning", area: "Learning" },
  ],
  habits: [
    { name: "Read for learning", category: "morning", kind: "good", weight: 3, target: 30, unit: "min", goal: "learning" },
    { name: "Exercise", category: "morning", kind: "good", weight: 3, target: 30, unit: "min", goal: "health" },
    { name: "Plan today's priorities", category: "morning", kind: "good", weight: 2, target: null, unit: null, goal: "career" },
    { name: "Work on a personal goal", category: "morning", kind: "good", weight: 2, target: null, unit: null, goal: "career" },
    { name: "Skip the early email check", category: "morning", kind: "avoid", weight: 1, target: null, unit: null, goal: null },
    { name: "Do important goal-related work", category: "daytime", kind: "good", weight: 3, target: 3, unit: "tasks", goal: "career" },
    { name: "Drink enough water", category: "daytime", kind: "good", weight: 1, target: 8, unit: "glasses", goal: "health" },
    { name: "Avoid junk food", category: "daytime", kind: "avoid", weight: 2, target: null, unit: null, goal: "health" },
    { name: "Avoid gossip", category: "daytime", kind: "avoid", weight: 1, target: null, unit: null, goal: null },
    { name: "Use downtime for learning", category: "daytime", kind: "good", weight: 1, target: null, unit: null, goal: "learning" },
    { name: "Limit recreational TV", category: "nighttime", kind: "avoid", weight: 2, target: 1, unit: "hr", goal: null },
    { name: "Limit recreational internet", category: "nighttime", kind: "avoid", weight: 2, target: 1, unit: "hr", goal: null },
    { name: "Spend an hour on a meaningful goal", category: "nighttime", kind: "good", weight: 3, target: 60, unit: "min", goal: "career" },
    { name: "Read for learning", category: "nighttime", kind: "good", weight: 2, target: 30, unit: "min", goal: "learning" },
    { name: "Prepare for tomorrow", category: "nighttime", kind: "good", weight: 2, target: null, unit: null, goal: null },
    { name: "Go to bed on time", category: "nighttime", kind: "good", weight: 3, target: null, unit: null, goal: "health" },
  ],
};

const ZH: SeedSet = {
  goals: [
    { key: "career", name: "事业成长", area: "Career" },
    { key: "health", name: "健康与精力", area: "Health" },
    { key: "learning", name: "学习成长", area: "Learning" },
  ],
  habits: [
    { name: "阅读学习", category: "morning", kind: "good", weight: 3, target: 30, unit: "分钟", goal: "learning" },
    { name: "锻炼身体", category: "morning", kind: "good", weight: 3, target: 30, unit: "分钟", goal: "health" },
    { name: "规划今天的优先事项", category: "morning", kind: "good", weight: 2, target: null, unit: null, goal: "career" },
    { name: "推进一个个人目标", category: "morning", kind: "good", weight: 2, target: null, unit: null, goal: "career" },
    { name: "早上不先看邮件", category: "morning", kind: "avoid", weight: 1, target: null, unit: null, goal: null },
    { name: "做与目标相关的重要工作", category: "daytime", kind: "good", weight: 3, target: 3, unit: "项", goal: "career" },
    { name: "喝足够的水", category: "daytime", kind: "good", weight: 1, target: 8, unit: "杯", goal: "health" },
    { name: "不吃垃圾食品", category: "daytime", kind: "avoid", weight: 2, target: null, unit: null, goal: "health" },
    { name: "不说闲话", category: "daytime", kind: "avoid", weight: 1, target: null, unit: null, goal: null },
    { name: "用碎片时间学习", category: "daytime", kind: "good", weight: 1, target: null, unit: null, goal: "learning" },
    { name: "少看娱乐电视", category: "nighttime", kind: "avoid", weight: 2, target: 1, unit: "小时", goal: null },
    { name: "少刷娱乐网络", category: "nighttime", kind: "avoid", weight: 2, target: 1, unit: "小时", goal: null },
    { name: "花一小时投入有意义的目标", category: "nighttime", kind: "good", weight: 3, target: 60, unit: "分钟", goal: "career" },
    { name: "阅读学习", category: "nighttime", kind: "good", weight: 2, target: 30, unit: "分钟", goal: "learning" },
    { name: "为明天做准备", category: "nighttime", kind: "good", weight: 2, target: null, unit: null, goal: null },
    { name: "按时上床睡觉", category: "nighttime", kind: "good", weight: 3, target: null, unit: null, goal: "health" },
  ],
};

const SETS: Record<Locale, SeedSet> = { en: EN, zh: ZH };

export const seedSet = (locale: Locale): SeedSet => SETS[locale] ?? EN;

type Q = <T = any>(text: string, params?: unknown[]) => Promise<T[]>;

/**
 * Creates the profile, preferences, goals, habits, schedules and goal links for
 * a new account. Runs inside the sign-up transaction, so an account never
 * exists half-seeded — the same guarantee the old database trigger gave.
 */
export async function seedAccount(q: Q, userId: string, locale: Locale) {
  const set = seedSet(locale);

  await q("insert into profiles (id) values ($1)", [userId]);
  await q("insert into user_preferences (user_id) values ($1)", [userId]);

  const goalIds = new Map<SeedGoal["key"], string>();
  for (const g of set.goals) {
    const rows = await q<{ id: string }>(
      "insert into goals (user_id, name, area) values ($1,$2,$3) returning id",
      [userId, g.name, g.area],
    );
    goalIds.set(g.key, rows[0].id);
  }

  for (const h of set.habits) {
    const rows = await q<{ id: string }>(
      `insert into habits (user_id, name, category, kind, weight, target, unit, sort_order)
       values ($1,$2,$3::habit_category,$4::habit_kind,$5,$6,$7,0) returning id`,
      [userId, h.name, h.category, h.kind, h.weight, h.target, h.unit],
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
