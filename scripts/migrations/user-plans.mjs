/**
 * ---- 11. Plans -------------------------------------------------------------
 *
 * One row per account that has a plan, and no row at all for everybody else.
 *
 * **No row means Free.** That is the whole reason this table can be introduced
 * without touching a single existing account: every account is Free today, so
 * an empty table is already the correct answer for all of them. Nothing is
 * backfilled, and no user row is read or written by this step.
 *
 * **Provenance is required for Pro.** `plan <> 'pro' or source is not null`
 * means a Pro row must say where it came from — granted, gifted, a trial, a
 * support decision, or eventually purchased. A Pro row with no provenance is
 * unauditable, and the one question anybody will ask in a year is "why does this
 * account have Pro".
 *
 * **No billing fields.** No customer id, no subscription id, no price, no
 * provider. Billing and entitlement are different concepts and this is the
 * entitlement one; `source = 'purchased'` is a valid value with no payment
 * implementation attached to it.
 *
 * `updated_at` is maintained by the same `touch_updated_at()` trigger the older
 * tables use. The schema applies that trigger to seven tables through a loop
 * that only runs on a fresh install, so this migration creates the trigger
 * itself for a database that already exists — otherwise a fresh install and a
 * migrated production would disagree about whether the column is maintained,
 * and the tests would only ever see the half that works.
 *
 * Additive only. No DROP, no ALTER of anything existing, no UPDATE, no DELETE,
 * no backfill. Every statement is guarded, so a second run reports no changes.
 * db/schema.sql carries the same definition for fresh installs, and
 * tests/user-plans-migration.test.ts proves the two produce the same structure
 * and that existing tables and rows come through untouched.
 *
 * `client` is anything with `query(sql, params) → { rows }`.
 */

export const USER_PLAN_STEPS = [
  {
    table: "user_plans",
    statements: [
      `create table if not exists user_plans (
  user_id     uuid primary key references users(id) on delete cascade,
  plan        text not null check (plan in ('free', 'pro')),
  -- Null only for a 'free' row. A Pro row must say where it came from.
  source      text check (source is null or source in
                ('grandfathered', 'purchased', 'gifted', 'promotional', 'trial', 'support')),
  granted_at  timestamptz not null default now(),
  -- Null means it does not expire. Grandfathered Pro is permanent, so its rows
  -- hold null here, and the read path treats a past date as Free.
  expires_at  timestamptz,
  -- Admin prose: why this plan exists. Never shown in Admin -> Users' listing.
  note        text,
  granted_by  uuid references users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  check (plan <> 'pro' or source is not null)
)`,
      // Reading "who is on Pro" is the only query that is not by primary key.
      `create index if not exists user_plans_plan_idx on user_plans (plan)`,
    ],
  },
];

export const USER_PLAN_TABLES = USER_PLAN_STEPS.map((step) => step.table);

async function tableExists(client, table) {
  const { rows } = await client.query(
    `select 1 from information_schema.tables
      where table_schema = 'public' and table_name = $1`,
    [table],
  );
  return rows.length > 0;
}

async function triggerExists(client, name) {
  const { rows } = await client.query(
    `select 1 from pg_trigger where tgname = $1 and not tgisinternal`, [name]);
  return rows.length > 0;
}

export async function migrateUserPlans(client, log = () => {}) {
  // The table hangs off a user. Absent only on a database that has not reached
  // the base schema, where there is nothing to attach to yet.
  if (!(await tableExists(client, "users"))) return 0;

  let changed = 0;
  for (const { table, statements } of USER_PLAN_STEPS) {
    const existed = await tableExists(client, table);
    // `if not exists` on every statement: an index missing from an existing
    // table is still created, and nothing present is replaced.
    for (const statement of statements) await client.query(statement);
    if (!existed) {
      log(`  created ${table}`);
      changed++;
    }
  }

  /*
   * The same `updated_at` mechanism the older tables use. `create trigger` has
   * no IF NOT EXISTS, so this is guarded by looking the trigger up — which also
   * makes the step idempotent. `touch_updated_at()` is part of the base schema;
   * if a database somehow lacks it, the trigger is skipped rather than failing
   * the whole migration, because a missing timestamp refresh must never block a
   * release.
   */
  const { rows: fn } = await client.query(
    `select 1 from pg_proc where proname = 'touch_updated_at'`);
  if (fn.length && !(await triggerExists(client, "user_plans_touch"))) {
    await client.query(
      `create trigger user_plans_touch before update on user_plans
         for each row execute function touch_updated_at()`);
    log("  created trigger user_plans_touch");
    changed++;
  }

  return changed;
}
