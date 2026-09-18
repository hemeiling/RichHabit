/**
 * ---- 9. password resets ----------------------------------------------------
 *
 * One new table holding password-reset tokens. Additive only: nothing that
 * exists is read, altered or dropped, and no row outside this table is touched.
 * Every statement is guarded, so a second run reports no changes. db/schema.sql
 * carries the same definition for fresh installs, and
 * tests/password-reset-migration.test.ts proves both produce the same structure
 * and that existing tables and rows come through untouched.
 *
 * Deliberately its own table rather than a `purpose` column on
 * email_verifications. The two credentials have different lifetimes (thirty
 * minutes against twenty-four hours) and different consequences, and sharing a
 * table would mean every existing query needed a purpose filter — where one
 * missed filter is a privilege bug rather than a cosmetic one.
 *
 * No address is stored on the row. The recipient is read from the account when
 * the message is sent, so a token issued before an address changed can never be
 * used to mail the old one.
 *
 * Its own module so the tests run exactly this code, the pattern steps 4e and 8
 * use. `client` is anything with `query(sql, params) → { rows }`.
 */

export const PASSWORD_RESET_STEPS = [
  {
    table: "password_resets",
    statements: [
      `create table if not exists password_resets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users on delete cascade,
  -- Only the SHA-256 of the token. A copy of this table is not a set of
  -- working links, for the same reason password_hash is not a password.
  token_hash  text not null,
  expires_at  timestamptz not null,
  -- Single use. Set in the same transaction that changes the password, and on
  -- every other outstanding token for that account at the same moment.
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
)`,
      `create unique index if not exists password_resets_hash_idx
  on password_resets (token_hash)`,
      // Both reads are "this account's, newest first": the rate limits and the
      // sweep that consumes outstanding tokens when a new one is issued.
      `create index if not exists password_resets_user_idx
  on password_resets (user_id, created_at desc)`,
    ],
  },
];

export const PASSWORD_RESET_TABLES = PASSWORD_RESET_STEPS.map((step) => step.table);

async function tableExists(client, table) {
  const { rows } = await client.query(
    `select 1 from information_schema.tables
      where table_schema = 'public' and table_name = $1`,
    [table],
  );
  return rows.length > 0;
}

export async function migratePasswordResets(client, log = () => {}) {
  // The table belongs to a user. Absent only on a database that has not reached
  // the base schema, where there is nothing to attach to yet.
  if (!(await tableExists(client, "users"))) return 0;

  let changed = 0;
  for (const { table, statements } of PASSWORD_RESET_STEPS) {
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
