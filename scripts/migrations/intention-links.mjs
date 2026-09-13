/**
 * ---- 4e. intentions: any number of linked habits and priorities ------------
 *
 * Clarify Your Intention used to start at most three habits and one priority.
 * The product now lets somebody link as many ordinary habits and priorities as
 * they want, so this step:
 *
 *   1. removes the three-habit CHECK constraint — a constraint only; no row is
 *      read or changed, and `habit_ids` keeps its type, default and contents;
 *   2. adds `priority_ids uuid[] not null default '{}'`, with no count limit;
 *   3. copies each existing single `priority_id` into `priority_ids`, once;
 *   4. records each column's role in the database's own column comments.
 *
 * `priority_ids` is canonical from here on. `priority_id` is kept only so the
 * application released before this one keeps working if it is ever rolled
 * back: new saves write it as the first linked priority, or null. It is not a
 * source of truth and a later cleanup migration may remove it once no deployed
 * code reads it.
 *
 * Nothing is dropped except the one constraint, nothing is deleted, and
 * `updated_at` is not touched. Every statement is guarded, so a second run
 * reports no changes. Lives in its own module so the test suite can run exactly
 * this code against a real Postgres (PGlite) — see tests/intention-migration.
 *
 * `client` is anything with `query(sql, params) → { rows, rowCount }`.
 */

export const HABIT_IDS_COMMENT =
  "Every habit linked to this intention, in the order linked. No count limit.";
export const PRIORITY_IDS_COMMENT =
  "Canonical. Every priority linked to this intention, in the order linked. " +
  "The application reads and writes this list.";
export const PRIORITY_ID_COMMENT =
  "Legacy compatibility only. Written as priority_ids[1], or null, so the " +
  "pre-multi-link application still works after a rollback. Not a source of " +
  "truth. To be removed by a later cleanup migration once no deployed code reads it.";

/** A SQL string literal. COMMENT ON does not accept bind parameters. */
const literal = (text) => `'${String(text).replace(/'/g, "''")}'`;

async function columnComment(client, column) {
  const { rows } = await client.query(
    `select col_description(c.oid, a.attnum) as comment
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid
      where n.nspname = 'public' and c.relname = 'intentions'
        and a.attname = $1 and not a.attisdropped`,
    [column],
  );
  return rows[0]?.comment ?? null;
}

export async function migrateIntentionLinks(client, log = () => {}) {
  let changed = 0;

  const { rows: table } = await client.query(
    `select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'intentions'`);
  // Created by step 4d. Absent only on a database that has not reached it.
  if (table.length === 0) return 0;

  // 1. The three-habit limit.
  const { rows: limit } = await client.query(
    `select 1 from pg_constraint k
       join pg_class t on t.oid = k.conrelid
       join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and t.relname = 'intentions'
        and k.conname = 'intentions_habit_ids_check'`);
  if (limit.length > 0) {
    await client.query("alter table intentions drop constraint if exists intentions_habit_ids_check");
    log("  intentions: removed the three-habit limit");
    changed++;
  }

  // 2. The canonical priority list.
  const { rows: column } = await client.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'intentions'
        and column_name = 'priority_ids'`);
  if (column.length === 0) {
    await client.query(
      "alter table intentions add column if not exists priority_ids uuid[] not null default '{}'");
    log("  intentions: added priority_ids");
    changed++;
  }

  // 3. Carry each single link into the list, exactly once. updated_at untouched.
  const { rowCount } = await client.query(
    `update intentions
        set priority_ids = array[priority_id]
      where priority_id is not null
        and cardinality(priority_ids) = 0`);
  if (rowCount) {
    log(`  intentions: carried ${rowCount} priority link(s) into priority_ids`);
    changed += rowCount;
  }

  // 4. Each column's role, in the database itself.
  for (const [name, text] of [
    ["habit_ids", HABIT_IDS_COMMENT],
    ["priority_ids", PRIORITY_IDS_COMMENT],
    ["priority_id", PRIORITY_ID_COMMENT],
  ]) {
    if ((await columnComment(client, name)) === text) continue;
    await client.query(`comment on column intentions.${name} is ${literal(text)}`);
    log(`  intentions: documented ${name}`);
    changed++;
  }

  return changed;
}
