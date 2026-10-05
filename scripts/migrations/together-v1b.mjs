/**
 * ---- 16. Together V1B: groups, tasks, assignees ------------------------------
 *
 * Three new tables. Nothing that exists is altered, rewritten or backfilled; no
 * V1A table, function or trigger is touched, and every existing row is left as
 * it was.
 *
 *   together_groups          a light label for organising a space's work
 *                            ("Sourcing"). Not a permission and not a project:
 *                            every member sees every task. Names are unique per
 *                            space, ignoring case. Deleting one keeps its tasks.
 *   together_tasks           one piece of shared work. `stage` is where it is —
 *                            'backlog' (captured, not promised) or one of the
 *                            board's four fixed stages. Order within a stage is
 *                            `moved_at desc, id desc`: creating or moving a task
 *                            sets `moved_at`, so new and moved work comes to the
 *                            top and editing never reorders. `created_by` is an
 *                            audit fact, never changed by the application;
 *                            `text_version` counts title/description changes so
 *                            two people editing the same text cannot silently
 *                            overwrite each other. Deletion is soft
 *                            (`deleted_at`), so a mistaken delete can be undone.
 *   together_task_assignees  who has taken a task on — none, one or several.
 *
 * Every relation inside a space is board-scoped by a composite foreign key, so a
 * task cannot point at another space's group, and an assignee must be a current
 * member of the task's own space. That second key is also what clears an
 * assignment when its person is removed, leaves or deletes their account: the
 * membership row goes, and the assignment cascades with it.
 *
 * Accounts are referenced only as `set null` (creator, last editor, who
 * deleted): an account's deletion keeps the shared work and forgets the person.
 * Each such column is indexed so that deletion does not scan the table.
 *
 * Idempotent: every statement is `if not exists`. db/schema.sql carries the
 * same statements for fresh installs; tests/together-v1b-migration.test.ts
 * proves both match, that the step is additive, and that every existing table
 * and row comes through unchanged.
 */

export const TOGETHER_V1B_TABLES = ["together_groups", "together_tasks", "together_task_assignees"];

export const TOGETHER_V1B_STATEMENTS = [
  `create table if not exists together_groups (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references together_boards on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 40),
  created_by uuid references users on delete set null,
  created_at timestamptz not null default now(),
  unique (board_id, id)
)`,
  `create unique index if not exists together_groups_name on together_groups (board_id, lower(name))`,
  `create index if not exists together_groups_created_by on together_groups (created_by) where created_by is not null`,
  `create table if not exists together_tasks (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references together_boards on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 200),
  description  text check (description is null or length(description) <= 10000),
  stage        text not null check (stage in ('backlog','todo','doing','waiting','done')),
  moved_at     timestamptz not null default now(),
  group_id     uuid,
  effort       smallint check (effort between 1 and 99),
  due_on       date check (due_on between '2000-01-01' and '2100-12-31'),
  created_by   uuid references users on delete set null,
  updated_by   uuid references users on delete set null,
  text_version integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   uuid references users on delete set null,
  unique (board_id, id),
  foreign key (board_id, group_id) references together_groups (board_id, id) on delete set null (group_id)
)`,
  `create index if not exists together_tasks_stage
  on together_tasks (board_id, stage, moved_at desc, id desc) where deleted_at is null`,
  `create index if not exists together_tasks_deleted
  on together_tasks (board_id, deleted_at desc) where deleted_at is not null`,
  `create index if not exists together_tasks_created_by on together_tasks (created_by) where created_by is not null`,
  `create index if not exists together_tasks_updated_by on together_tasks (updated_by) where updated_by is not null`,
  `create index if not exists together_tasks_deleted_by on together_tasks (deleted_by) where deleted_by is not null`,
  `create table if not exists together_task_assignees (
  task_id     uuid not null,
  board_id    uuid not null,
  user_id     uuid not null,
  assigned_at timestamptz not null default now(),
  primary key (task_id, user_id),
  foreign key (board_id, task_id) references together_tasks (board_id, id) on delete cascade,
  foreign key (board_id, user_id) references together_members (board_id, user_id) on delete cascade
)`,
  `create index if not exists together_task_assignees_member on together_task_assignees (board_id, user_id)`,
];

async function tableExists(client, table) {
  const { rows } = await client.query(
    `select 1 from information_schema.tables where table_schema = 'public' and table_name = $1`, [table]);
  return rows.length > 0;
}

/** Runs after step 15, which it depends on: without Together V1A there is nothing to add to. */
export async function migrateTogetherV1B(client, log = () => {}) {
  if (!(await tableExists(client, "together_members"))) return 0;
  const existed = {};
  for (const t of TOGETHER_V1B_TABLES) existed[t] = await tableExists(client, t);
  for (const statement of TOGETHER_V1B_STATEMENTS) await client.query(statement);
  let changed = 0;
  for (const t of TOGETHER_V1B_TABLES) {
    if (!existed[t]) { log(`  created ${t}`); changed++; }
  }
  return changed;
}
