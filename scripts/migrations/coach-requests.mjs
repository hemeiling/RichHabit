/**
 * ---- 10. AI coach request log -----------------------------------------------
 *
 * One append-only table recording that the AI coach was asked something, so the
 * per-user safety limit can be counted in the database rather than in memory.
 *
 * Why a table and not a Map: the existing in-memory limiter in lib/ai/limits.ts
 * resets on every deploy and is not shared between instances, which makes it a
 * courtesy rather than a guard. A cost control that forgets everything when the
 * service restarts is not a cost control.
 *
 * Why not count analytics_events instead, which would need no schema: the coach
 * writes `coach_question_asked` only *after* a successful model call, and
 * trackEvent deliberately swallows its own failures. Counting those would
 * under-count exactly the failed, slow and abandoned calls that still cost
 * money.
 *
 * It records that a request happened and nothing else — no question, no answer,
 * no tokens. This is a safety limit, not the AI usage ledger; that is a later
 * phase with its own design.
 *
 * Additive only. Nothing that exists is read, altered or dropped, and no row
 * outside this table is touched. Every statement is guarded, so a second run
 * reports no changes. db/schema.sql carries the same definition for fresh
 * installs, and tests/coach-requests-migration.test.ts proves both produce the
 * same structure and that existing tables and rows come through untouched.
 *
 * `client` is anything with `query(sql, params) → { rows }`.
 */

export const COACH_REQUEST_STEPS = [
  {
    table: "coach_requests",
    statements: [
      `create table if not exists coach_requests (
  id          bigserial primary key,
  user_id     uuid not null references users on delete cascade,
  occurred_at timestamptz not null default now()
)`,
      // Every read is "this account's, within the last hour or day", and the
      // per-account sweep deletes by the same shape.
      `create index if not exists coach_requests_user_time_idx
  on coach_requests (user_id, occurred_at desc)`,
    ],
  },
];

export const COACH_REQUEST_TABLES = COACH_REQUEST_STEPS.map((step) => step.table);

async function tableExists(client, table) {
  const { rows } = await client.query(
    `select 1 from information_schema.tables
      where table_schema = 'public' and table_name = $1`,
    [table],
  );
  return rows.length > 0;
}

export async function migrateCoachRequests(client, log = () => {}) {
  // The table belongs to a user. Absent only on a database that has not reached
  // the base schema, where there is nothing to attach to yet.
  if (!(await tableExists(client, "users"))) return 0;

  let changed = 0;
  for (const { table, statements } of COACH_REQUEST_STEPS) {
    const existed = await tableExists(client, table);
    // `if not exists` on every statement: an index missing from an existing
    // table is still created, and nothing present is replaced.
    for (const statement of statements) await client.query(statement);
    if (!existed) {
      log(`  created ${table}`);
      changed++;
    }
  }
  return changed;
}
