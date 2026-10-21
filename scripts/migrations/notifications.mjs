/**
 * Unified Notifications — runner step 23, after flexible repetition (22).
 *
 * Three new tables and one index. Nothing existing is altered, and no existing
 * row is read or written:
 *
 *   notifications            one row per notice a person has been given: an
 *                            assignment (Activity) or a reminder that came due.
 *                            Never a title or a name — those are read live from
 *                            the source, so a rename, a deletion or lost access
 *                            is reflected at once. `dedupe_key` is unique per
 *                            person, which is what makes creating a notice
 *                            idempotent (insert … on conflict do nothing).
 *   notification_preferences one row per person who changed a setting; no row
 *                            means the defaults, so nobody is backfilled.
 *   habit_reminders          a habit's reminder, present only once its owner
 *                            switches it on (habit reminders are opt-in).
 *   together_task_assignees_user
 *                            "my assigned tasks, across spaces": the existing
 *                            indexes lead with the task or the space.
 *
 * db/schema.sql carries the same statements for fresh installs;
 * tests/notifications-migration.test.ts proves both match.
 */

export const NOTIFICATION_TABLES = ["notifications", "notification_preferences", "habit_reminders"];
export const NOTIFICATION_INDEXES = ["notifications_feed", "notifications_unread", "together_task_assignees_user"];

export const NOTIFICATIONS_STATEMENTS = [
  `create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users on delete cascade,
  category    text not null check (category in ('reminder','activity')),
  kind        text not null check (kind in ('task_assigned','task_due','task_overdue',
                                            'date_upcoming','date_start','priority_planned','priority_overdue','habit_due')),
  source_type text not null check (source_type in ('together_task','important_date','priority','habit')),
  source_id   uuid not null,
  board_id    uuid references together_boards on delete cascade,
  occurs_on   date,
  actor_id    uuid references users on delete set null,
  dedupe_key  text not null check (length(dedupe_key) <= 200),
  notify_at   timestamptz not null,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, dedupe_key)
)`,
  `create index if not exists notifications_feed on notifications (user_id, notify_at desc, id desc)`,
  `create index if not exists notifications_unread on notifications (user_id) where read_at is null`,
  `create table if not exists notification_preferences (
  user_id             uuid primary key references users on delete cascade,
  together_assigned   boolean not null default true,
  together_due        boolean not null default true,
  important_dates     boolean not null default true,
  important_date_lead smallint not null default 1 check (important_date_lead in (0, 1, 3, 7)),
  priorities          boolean not null default true,
  habits              boolean not null default true,
  morning_time        time not null default '08:00',
  daytime_time        time not null default '13:00',
  nighttime_time      time not null default '20:00',
  time_zone           text check (time_zone is null or length(time_zone) between 1 and 64),
  materialized_at     timestamptz,
  updated_at          timestamptz not null default now()
)`,
  `create table if not exists habit_reminders (
  habit_id   uuid primary key references habits on delete cascade,
  user_id    uuid not null references users on delete cascade,
  remind_at  time,
  created_at timestamptz not null default now()
)`,
  `create index if not exists together_task_assignees_user on together_task_assignees (user_id)`,
];

async function existing(client, sql, names) {
  const { rows } = await client.query(sql, [names]);
  return new Set(rows.map((r) => r.name));
}

export async function migrateNotifications(client, log = () => {}) {
  const needed = await existing(client,
    `select table_name as name from information_schema.tables where table_schema = 'public' and table_name = any($1)`,
    ["users", "habits", "together_boards", "together_task_assignees"]);
  if (needed.size < 4) return 0;
  const hadTables = await existing(client,
    `select table_name as name from information_schema.tables where table_schema = 'public' and table_name = any($1)`,
    NOTIFICATION_TABLES);
  const hadIndexes = await existing(client,
    `select indexname as name from pg_indexes where schemaname = 'public' and indexname = any($1)`,
    NOTIFICATION_INDEXES);
  for (const statement of NOTIFICATIONS_STATEMENTS) await client.query(statement);
  let changed = 0;
  for (const t of NOTIFICATION_TABLES) if (!hadTables.has(t)) { log(`  created table ${t}`); changed++; }
  for (const i of NOTIFICATION_INDEXES) if (!hadIndexes.has(i)) { log(`  created index ${i}`); changed++; }
  return changed;
}
