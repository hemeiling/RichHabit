/**
 * ---- 14. What's New: a per-account seen mark --------------------------------
 *
 * One nullable column on the existing `user_preferences` table, and nothing else:
 *
 *   whats_new_seen_at   publication time of the newest release this account has
 *                       been shown in What's New. Null means never opened, and
 *                       the account's creation time then marks where "unread"
 *                       starts (see src/lib/releases.ts).
 *
 * Why this is safe on a table every account has a row in:
 *
 *   - Additive only. No default, no backfill, no UPDATE, no DELETE: every
 *     existing row reads null, which is exactly "has not opened What's New".
 *     A nullable column with no default is a catalog change only — no row is
 *     rewritten.
 *   - Nothing else on the table is touched; the general preferences save does
 *     not name this column, so it can never write it.
 *
 * Idempotent: the column is added only if absent. `client` is anything with
 * `query(sql, params) → { rows }`. db/schema.sql carries the same statement for
 * fresh installs; tests/whats-new-migration.test.ts proves both match and that
 * existing rows come through unchanged.
 */

export const WHATS_NEW_COLUMN = ["user_preferences", "whats_new_seen_at", "timestamptz"];

export async function migrateWhatsNew(client, log = () => {}) {
  const [table, column, type] = WHATS_NEW_COLUMN;
  const { rows: t } = await client.query(
    `select 1 from information_schema.tables where table_schema = 'public' and table_name = $1`, [table]);
  if (t.length === 0) return 0;
  const { rows: c } = await client.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`, [table, column]);
  if (c.length) return 0;
  await client.query(`alter table ${table} add column ${column} ${type}`);
  log(`  ${table}.${column} added`);
  return 1;
}
