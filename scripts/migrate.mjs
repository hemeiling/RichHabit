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
    // §12/§20. Existing habits are all boolean with a target and no minimum,
    // which is exactly what the defaults give them — no backfill needed.
    ["habits", "tracking_type", null],   // needs the enum first; handled below
    ["habits", "minimum", "alter table habits add column minimum numeric(8,2)"],
    ["habits", "anchor", "alter table habits add column anchor text"],
    ["habits", "environment", "alter table habits add column environment text"],
    ["habits", "friction", "alter table habits add column friction text"],
    ["goals", "template_key", "alter table goals add column template_key text"],
    /*
     * The gratitude journal. `day_notes.body` becomes the optional reflection
     * rather than being replaced, so every note anyone has already written
     * survives on the day it belongs to — nothing is migrated away or dropped.
     */
    ["day_notes", "gratitude",
     "alter table day_notes add column gratitude text[] not null default '{}'"],
    // Admin account management. Null disabled_at means active, so every
    // existing account stays active without a backfill.
    ["users", "disabled_at", "alter table users add column disabled_at timestamptz"],
    ["users", "must_change_password",
     "alter table users add column must_change_password boolean not null default false"],
    // Sign in with a username as well as an email. Existing rows all have an
    // address, so the column starts null everywhere and nothing is backfilled.
    ["users", "username", null],
    // Deliberately not backfilled: an existing row's origin is unknown, and
    // writing a guess into it would make the guess look like a fact.
    ["users", "created_via",
     "alter table users add column created_via text " +
     "check (created_via in ('self_signup','admin','test'))"],
  ]) {
    if (await columnExists(table, column)) continue;

    if (table === "habits" && column === "tracking_type") {
      await client.query(`do $$ begin
        if not exists (select 1 from pg_type where typname = 'tracking_type') then
          create type tracking_type as enum ('boolean','count','duration','quantity',
            'interval','maximum','avoidance');
        end if;
      end $$;`);
      await client.query(
        "alter table habits add column tracking_type tracking_type not null default 'boolean'");
    } else if (table === "habits" && column === "status") {
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
    } else if (table === "users" && column === "username") {
      await client.query("alter table users add column username text");
      await client.query(
        "create unique index if not exists users_username_idx on users (lower(username))");
      // Email stops being mandatory once a username can identify an account,
      // but every row still needs one of the two.
      await client.query("alter table users alter column email drop not null");
      await client.query(`do $$ begin
        if not exists (select 1 from pg_constraint where conname = 'users_identified') then
          alter table users add constraint users_identified
            check (email is not null or username is not null);
        end if;
      end $$;`);
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

  /*
   * ---- 2. analytics tables --------------------------------------------------
   *
   * These arrived after the first release, so a database created from the
   * original schema does not have them. This used to print advice and carry on,
   * which meant the step further down that alters `analytics_events` then threw
   * and rolled the whole migration back — a deploy from that state failed
   * outright. Create them instead.
   *
   * `user_sessions` first: `analytics_events.session_id` references it.
   */
  for (const [table, ddl, indexes] of [
    ["user_sessions", `
      create table user_sessions (
        id               uuid primary key default gen_random_uuid(),
        user_id          uuid references users on delete set null,
        started_at       timestamptz not null default now(),
        last_activity_at timestamptz not null default now(),
        ended_at         timestamptz,
        event_count      int not null default 0,
        device_type      text,
        timezone         text,
        created_at       timestamptz not null default now()
      )`, [
      "create index sessions_open_idx on user_sessions (user_id, last_activity_at desc)",
      "create index user_sessions_started_idx on user_sessions (started_at)",
    ]],
    ["analytics_events", `
      create table analytics_events (
        id            bigserial primary key,
        user_id       uuid references users on delete set null,
        anonymous_id  text,
        session_id    uuid references user_sessions on delete set null,
        event_name    text not null,
        event_category text,
        feature       text,
        page          text,
        entity_type   text,
        entity_id     uuid,
        properties    jsonb not null default '{}'::jsonb,
        occurred_at   timestamptz not null default now(),
        user_timezone text,
        app_version   text,
        created_at    timestamptz not null default now()
      )`, [
      "create index events_user_time_idx on analytics_events (user_id, occurred_at desc)",
      "create index events_time_idx on analytics_events (occurred_at desc)",
      "create index events_name_idx on analytics_events (event_name, occurred_at desc)",
      "create index events_session_idx on analytics_events (session_id)",
      "create index events_feature_idx on analytics_events (feature, occurred_at desc)",
    ]],
  ]) {
    const { rows } = await client.query(
      `select 1 from information_schema.tables
        where table_schema = 'public' and table_name = $1`, [table]);
    if (rows.length) continue;
    await client.query(ddl);
    for (const index of indexes) await client.query(index);
    console.log(`  created ${table}`);
    changed++;
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

  // ---- 4. spending awareness -----------------------------------------------
  const { rows: spending } = await client.query(
    `select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'spending_records'`,
  );
  if (spending.length === 0) {
    await client.query(`
      create table spending_records (
        id          uuid primary key default gen_random_uuid(),
        user_id     uuid not null references users on delete cascade,
        spent_on    date not null default current_date,
        amount      numeric(12,2) not null check (amount >= 0),
        description text,
        category    text not null default 'other',
        need_want   text not null default 'need' check (need_want in ('need','want')),
        planned     boolean not null default true,
        notes       text,
        created_at  timestamptz not null default now()
      )`);
    await client.query(
      "create index spending_user_date_idx on spending_records (user_id, spent_on desc)");
    console.log("  created spending_records");
    changed++;
  }

  // ---- 5. admin account management ------------------------------------------
  for (const [table, ddl, extra] of [
    ["user_invites", `
      create table user_invites (
        token       uuid primary key default gen_random_uuid(),
        user_id     uuid not null references users on delete cascade,
        created_by  uuid references users on delete set null,
        expires_at  timestamptz not null,
        used_at     timestamptz,
        created_at  timestamptz not null default now()
      )`, "create index user_invites_user_idx on user_invites (user_id)"],
    ["monthly_reflections", `
      create table monthly_reflections (
        user_id    uuid not null references users on delete cascade,
        month      text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
        body       text not null default '',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (user_id, month)
      )`, null],
    ["feedback", `
      create table feedback (
        id            uuid primary key default gen_random_uuid(),
        user_id       uuid references users on delete set null,
        type          text not null default 'general'
                      check (type in ('bug','feature','suggestion','general')),
        body          text not null check (length(body) between 1 and 4000),
        rating        smallint check (rating between 1 and 5),
        screenshot      bytea check (screenshot is null or length(screenshot) <= 1048576),
        screenshot_type text check (screenshot_type in ('image/jpeg','image/png','image/webp')),
        page          text,
        app_version   text,
        locale        text,
        status        text not null default 'new'
                      check (status in ('new','reviewing','planned','resolved')),
        area          text check (area in ('today','habits','week','insights','coach',
                                           'account','admin','mobile','other')),
        admin_note    text,
        created_at    timestamptz not null default now(),
        updated_at    timestamptz not null default now()
      )`, "create index feedback_status_idx on feedback (status, created_at desc)"],
    ["admin_audit_log", `
      create table admin_audit_log (
        id           bigserial primary key,
        admin_id     uuid references users on delete set null,
        admin_email  text not null,
        target_id    uuid references users on delete set null,
        target_email text,
        action       text not null,
        details      jsonb not null default '{}'::jsonb,
        created_at   timestamptz not null default now()
      )`, "create index admin_audit_log_created_idx on admin_audit_log (created_at desc)"],
  ]) {
    const { rows } = await client.query(
      `select 1 from information_schema.tables
        where table_schema = 'public' and table_name = $1`, [table]);
    if (rows.length) continue;
    await client.query(ddl);
    if (extra) await client.query(extra);
    console.log(`  created ${table}`);
    changed++;
  }

  /*
   * Analytics detach from a deleted user instead of vanishing with them. The
   * rows carry no name, note or habit text — only that something happened and
   * when — so keeping them preserves every aggregate the admin screens draw
   * while removing the link to a person. Both columns cascaded before this.
   */
  for (const [table, column] of [["analytics_events", "user_id"], ["user_sessions", "user_id"]]) {
    // Belt and braces: step 2 creates these when missing, but a table that is
    // not there must never take the whole migration down with it.
    const { rows: exists } = await client.query(
      `select 1 from information_schema.tables
        where table_schema = 'public' and table_name = $1`, [table]);
    if (exists.length === 0) continue;
    const { rows } = await client.query(
      `select rc.delete_rule
         from information_schema.table_constraints tc
         join information_schema.referential_constraints rc
           on rc.constraint_name = tc.constraint_name
         join information_schema.key_column_usage k
           on k.constraint_name = tc.constraint_name
        where tc.table_name = $1 and k.column_name = $2
          and tc.constraint_type = 'FOREIGN KEY'`, [table, column]);
    if (rows[0]?.delete_rule === "SET NULL") continue;
    await client.query(`alter table ${table} drop constraint ${table}_${column}_fkey`);
    await client.query(`alter table ${table} alter column ${column} drop not null`);
    await client.query(
      `alter table ${table} add constraint ${table}_${column}_fkey
         foreign key (${column}) references users on delete set null`);
    console.log(`  ${table}.${column} now detaches instead of cascading`);
    changed++;
  }

  // ---- 6. backfill template keys on rows seeded before keys existed ---------
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
