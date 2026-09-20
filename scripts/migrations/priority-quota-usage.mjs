/**
 * ---- 12. Priority quota ----------------------------------------------------
 *
 * How many new priorities an account has created on one of its own calendar
 * days. One row per account per day, and no row at all until the first one is
 * created.
 *
 * **No row means nothing used.** That is what lets this table be introduced
 * without touching a single existing account: every account has used nothing
 * today as far as an empty table is concerned, so there is nothing to backfill
 * and no user row to read or write.
 *
 * **The day is part of the primary key**, which is the whole reason there is no
 * nightly reset job and no scheduled cleanup. Tomorrow is simply a different
 * key, so tomorrow's allowance starts at nothing without anybody resetting it.
 *
 * **The day is the server's answer, not the client's.** It is derived from the
 * `x-rh-timezone` header through `viewerToday`, never from the `created_on` the
 * browser sends — a quota a caller can date for itself is not a quota. The
 * column is deliberately `date` and not a timestamp: this counts days, and a
 * timestamp would invite somebody to compare instants across zones.
 *
 * **Only Free accounts ever appear here.** Pro and Admin resolve to an
 * unlimited entitlement, and the write path returns before it reaches this
 * table, so it holds no row for them at all.
 *
 * **No `updated_at`, so no trigger** — unlike `user_plans`. The row's only fact
 * is a count, and `created` already says everything that changed.
 *
 * Additive only. No DROP, no ALTER of anything existing, no UPDATE, no DELETE,
 * no backfill. Every statement is guarded, so a second run reports no changes.
 * db/schema.sql carries the same definition for fresh installs, and
 * tests/priority-quota-migration.test.ts proves the two produce the same
 * structure and that existing tables and rows come through untouched.
 *
 * `client` is anything with `query(sql, params) → { rows }`.
 */

export const PRIORITY_QUOTA_STEPS = [
  {
    table: "priority_quota_usage",
    statements: [
      `create table if not exists priority_quota_usage (
  user_id    uuid    not null references users(id) on delete cascade,
  -- The account's own calendar day, derived on the SERVER from x-rh-timezone.
  local_day  date    not null,
  -- New priorities created on that day. Never decremented: deleting a priority
  -- does not give the day back, because the day's allowance was spent creating it.
  created    integer not null default 0 check (created >= 0),
  -- The day is half the key, which is why no reset job exists.
  primary key (user_id, local_day)
)`,
    ],
  },
];

export const PRIORITY_QUOTA_TABLES = PRIORITY_QUOTA_STEPS.map((step) => step.table);

async function tableExists(client, table) {
  const { rows } = await client.query(
    `select 1 from information_schema.tables
      where table_schema = 'public' and table_name = $1`,
    [table],
  );
  return rows.length > 0;
}

export async function migratePriorityQuota(client, log = () => {}) {
  // The table hangs off a user. Absent only on a database that has not reached
  // the base schema, where there is nothing to attach to yet.
  if (!(await tableExists(client, "users"))) return 0;

  let changed = 0;
  for (const { table, statements } of PRIORITY_QUOTA_STEPS) {
    const existed = await tableExists(client, table);
    // `if not exists` on every statement, so nothing present is replaced.
    for (const statement of statements) await client.query(statement);
    if (!existed) {
      log(`  created ${table}`);
      changed++;
    }
  }

  return changed;
}
