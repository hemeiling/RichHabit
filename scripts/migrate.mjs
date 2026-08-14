/**
 * Brings an existing database up to the current schema, without losing data.
 *
 *   npm run db:migrate
 *
 * Idempotent: every step checks first and skips if it has already run, so it is
 * safe on every deploy and safe to run twice by hand.
 *
 * The interesting step is the last one. Starter habits used to be stored as
 * text in whatever language the account signed up in, which meant switching
 * language left them stuck in English. They are keyed now — but rows created
 * before that have no key, so this recognises them by name and backfills it.
 * Ids, completion history, schedules and goal links are all untouched; only
 * `template_key` is written.
 *
 * A row whose name matches no known template is left alone. That is the safe
 * direction: an unrecognised habit is treated as the user's own words.
 */
import { connect } from "./lib.mjs";

/**
 * Every wording a template has ever shipped with, across languages and across
 * the bilingual "English · 中文" form that one release used. Kept here rather
 * than imported because this is a plain Node script and the dictionaries are
 * TypeScript — and because a migration should describe the past, which the
 * current dictionary no longer does.
 */
const HABIT_ALIASES = {
  read_for_learning: ["Read for learning", "阅读学习", "Read for learning · 阅读学习"],
  exercise: ["Exercise", "锻炼身体", "锻炼", "Exercise · 锻炼身体"],
  plan_priorities: ["Plan today's priorities", "规划今天的优先事项", "规划今日优先事项",
    "Plan today's priorities · 规划今天的优先事项"],
  personal_goal: ["Work on a personal goal", "推进一个个人目标", "推进个人目标",
    "Work on a personal goal · 推进一个个人目标"],
  skip_early_email: ["Skip the early email check", "早上不先看邮件", "避免一早查看邮件",
    "Skip the early email check · 早上不先看邮件"],
  goal_related_work: ["Do important goal-related work", "做与目标相关的重要工作",
    "完成重要的目标相关工作", "Do important goal-related work · 做与目标相关的重要工作"],
  drink_water: ["Drink enough water", "喝足够的水", "Drink enough water · 喝足够的水"],
  avoid_junk_food: ["Avoid junk food", "不吃垃圾食品", "避免垃圾食品", "Avoid junk food · 不吃垃圾食品"],
  avoid_gossip: ["Avoid gossip", "不说闲话", "避免闲聊八卦", "Avoid gossip · 不说闲话"],
  downtime_learning: ["Use downtime for learning", "用碎片时间学习", "利用碎片时间学习",
    "Use downtime for learning · 用碎片时间学习"],
  limit_tv: ["Limit recreational TV", "少看娱乐电视", "减少娱乐性看电视", "Limit recreational TV · 少看娱乐电视"],
  limit_internet: ["Limit recreational internet", "少刷娱乐网络", "减少娱乐性上网",
    "Limit recreational internet · 少刷娱乐网络"],
  meaningful_goal_hour: ["Spend an hour on a meaningful goal", "花一小时投入有意义的目标",
    "Spend an hour on a meaningful goal · 花一小时投入有意义的目标"],
  prepare_tomorrow: ["Prepare for tomorrow", "为明天做准备", "Prepare for tomorrow · 为明天做准备"],
  bed_on_time: ["Go to bed on time", "按时上床睡觉", "按时睡觉", "Go to bed on time · 按时上床睡觉"],
};

const GOAL_ALIASES = {
  career_growth: ["Career growth", "事业成长", "Career growth · 事业成长"],
  health_energy: ["Health & energy", "健康与精力", "Health & energy · 健康与精力"],
  learning: ["Learning", "学习成长", "Learning · 学习成长"],
};

const UNIT_ALIASES = {
  min: ["min", "分钟", "min · 分钟"],
  glasses: ["glasses", "杯", "glasses · 杯"],
  tasks: ["tasks", "项", "tasks · 项"],
  hr: ["hr", "小时", "hr/小时"],
};

const client = await connect();
let changed = 0;

async function columnExists(table, column) {
  const { rows } = await client.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}

try {
  await client.query("begin");

  // ---- 1. columns added since the first release -----------------------------
  for (const [table, column, ddl] of [
    ["user_preferences", "locale",
     "alter table user_preferences add column locale text not null default 'en' " +
     "check (locale in ('en','zh','both'))"],
    ["users", "role", null],   // needs the enum first; handled below
    ["habits", "template_key", "alter table habits add column template_key text"],
    ["habits", "status", null],   // needs the enum first; handled below
    // §10/§18. A replacement points at the behaviour it replaces; the original
    // is kept. `on delete set null` so removing a behaviour later orphans the
    // link rather than deleting the habit built to replace it.
    ["habits", "replaces_habit_id",
     "alter table habits add column replaces_habit_id uuid references habits on delete set null"],
    ["habits", "rationale", "alter table habits add column rationale text"],
    ["goals", "template_key", "alter table goals add column template_key text"],
  ]) {
    if (await columnExists(table, column)) continue;

    if (table === "habits" && column === "status") {
      // §14. Everything that exists today was either on the sheet or paused;
      // the richer statuses only arrive with the personalisation survey.
      await client.query(`do $$ begin
        if not exists (select 1 from pg_type where typname = 'habit_status') then
          create type habit_status as enum ('candidate','recommended','planned',
            'active','paused','established','retired');
        end if;
      end $$;`);
      await client.query("alter table habits add column status habit_status not null default 'active'");
      const hasActive = await columnExists("habits", "active");
      if (hasActive) {
        await client.query(
          "update habits set status = (case when active then 'active' else 'paused' end)::habit_status",
        );
        // `active` stays for now: dropping a column is the one migration step
        // that cannot be undone, and nothing reads it any more.
        console.log("  habits.status backfilled from habits.active (which is now unused)");
      }
    } else if (table === "users" && column === "role") {
      await client.query(`do $$ begin
        if not exists (select 1 from pg_type where typname = 'user_role') then
          create type user_role as enum ('user', 'admin');
        end if;
      end $$;`);
      await client.query("alter table users add column role user_role not null default 'user'");
    } else {
      await client.query(ddl);
    }
    console.log(`  added ${table}.${column}`);
    changed++;
  }

  // ---- 2. analytics tables --------------------------------------------------
  const { rows: analytics } = await client.query(
    `select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'analytics_events'`,
  );
  if (analytics.length === 0) {
    console.log("  analytics tables are missing — apply db/schema.sql to a fresh database,");
    console.log("  or copy the 'Product usage analytics' section from it into this database.");
  }

  // ---- 3. habit library catalogue ------------------------------------------
  const { rows: lib } = await client.query(
    `select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'habit_library'`,
  );
  if (lib.length === 0) {
    // The catalogue is shared and owned by nobody, so creating it loses nothing.
    await client.query(`
      create table habit_library (
        key            text primary key,
        category       habit_category not null,
        kind           habit_kind not null default 'good',
        life_domain    text,
        tracking_type  text not null default 'boolean',
        suggested_weight   smallint not null default 2 check (suggested_weight between 1 and 3),
        suggested_minimum  numeric(8,2),
        suggested_target   numeric(8,2),
        suggested_unit     text,
        suggested_frequency freq_mode not null default 'daily',
        sort_order     int not null default 0
      )`);
    await client.query(
      "create index habit_library_category_idx on habit_library (category, sort_order)");
    console.log("  created habit_library");
    changed++;
  }

  // ---- 4. backfill template keys on rows seeded before keys existed ---------
  if (await columnExists("habits", "template_key")) {
    for (const [key, aliases] of Object.entries(HABIT_ALIASES)) {
      const { rowCount } = await client.query(
        "update habits set template_key = $1 where template_key is null and name = any($2)",
        [key, aliases],
      );
      if (rowCount) { console.log(`  habits → ${key}: ${rowCount}`); changed += rowCount; }
    }
    // Night-time reading shares its wording with the morning one; the category
    // is what tells them apart.
    const { rowCount: night } = await client.query(
      `update habits set template_key = 'read_for_learning_night'
        where template_key = 'read_for_learning' and category = 'nighttime'`,
    );
    if (night) { console.log(`  habits → read_for_learning_night: ${night}`); changed += night; }

    for (const [key, aliases] of Object.entries(UNIT_ALIASES)) {
      const { rowCount } = await client.query(
        "update habits set unit = $1 where template_key is not null and unit = any($2) and unit <> $1",
        [key, aliases],
      );
      if (rowCount) { console.log(`  units → ${key}: ${rowCount}`); changed += rowCount; }
    }
  }

  if (await columnExists("goals", "template_key")) {
    for (const [key, aliases] of Object.entries(GOAL_ALIASES)) {
      const { rowCount } = await client.query(
        "update goals set template_key = $1 where template_key is null and name = any($2)",
        [key, aliases],
      );
      if (rowCount) { console.log(`  goals → ${key}: ${rowCount}`); changed += rowCount; }
    }
  }

  await client.query("commit");
  console.log(changed ? `\nDone — ${changed} change(s).` : "\nNothing to do; already up to date.");
} catch (e) {
  await client.query("rollback");
  console.error("Migration rolled back:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
