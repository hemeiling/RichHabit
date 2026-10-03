/**
 * ---- 13. Important Dates: optional times, and repeating events -------------
 *
 * Seven columns on the existing `important_dates` table, and the named CHECKs
 * that keep them coherent. Nothing else.
 *
 *   start_time, end_time   optional wall-clock times; null = all day
 *   time_zone              the IANA zone the times were meant in
 *   repeat_unit            null = does not repeat; week | month | year
 *   repeat_interval        every N units (default 1)
 *   repeat_until           optional last occurrence start, inclusive
 *   excluded_on            single occurrences deleted from a series
 *
 * Why this is safe on a table that already holds people's dates:
 *
 *   - Additive only. Columns are added; nothing is dropped, renamed, rewritten,
 *     backfilled, deleted or reseeded. No UPDATE runs.
 *   - Every new column is nullable or has a constant default, so an existing
 *     row reads as exactly what it already was: all day (`start_time` null),
 *     once (`repeat_unit` null), nothing excluded. A constant default is
 *     stored as table metadata (PostgreSQL 11+), so no row is rewritten.
 *   - Each CHECK passes trivially for every existing row, because each one is
 *     written to be satisfied by those defaults. Adding them validates the
 *     table once and changes nothing.
 *   - Ids, titles, dates, notes, colours and kinds are not touched.
 *
 * Idempotent: a column is added only if absent, a constraint only if no
 * constraint of that name exists. A second run reports no changes.
 *
 * `client` is anything with `query(sql, params) → { rows }`. db/schema.sql
 * carries the same definitions for fresh installs, and
 * tests/important-dates-migration.test.ts proves both produce the same
 * structure and that existing rows come through byte-for-byte unchanged.
 */

export const IMPORTANT_DATES_V2_COLUMNS = [
  ["start_time", "time"],
  ["end_time", "time"],
  ["time_zone", "text"],
  ["repeat_unit", "text"],
  ["repeat_interval", "smallint not null default 1"],
  ["repeat_until", "date"],
  ["excluded_on", "date[] not null default '{}'::date[]"],
];

export const IMPORTANT_DATES_V2_CONSTRAINTS = [
  ["important_dates_repeat_unit_check",
    "check (repeat_unit is null or repeat_unit in ('week','month','year'))"],
  ["important_dates_repeat_interval_check",
    "check (repeat_interval between 1 and 99)"],
  ["important_dates_repeat_until_check",
    "check (repeat_until is null or repeat_until >= starts_on)"],
  ["important_dates_excluded_on_check",
    "check (cardinality(excluded_on) <= 500)"],
  // A time zone or an end time only with a start time: an all-day event has none.
  ["important_dates_time_check",
    "check (start_time is not null or (end_time is null and time_zone is null))"],
  // On a single day, the end is after the start. Overnight events end the next day.
  ["important_dates_time_order_check",
    "check (start_time is null or end_time is null or ends_on > starts_on or end_time > start_time)"],
  ["important_dates_time_zone_check",
    "check (time_zone is null or length(time_zone) between 1 and 64)"],
];

async function tableExists(client, table) {
  const { rows } = await client.query(
    `select 1 from information_schema.tables
      where table_schema = 'public' and table_name = $1`, [table]);
  return rows.length > 0;
}

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`, [table, column]);
  return rows.length > 0;
}

async function constraintExists(client, name) {
  const { rows } = await client.query(
    `select 1 from pg_constraint
      where conrelid = 'public.important_dates'::regclass and conname = $1`, [name]);
  return rows.length > 0;
}

export async function migrateImportantDatesV2(client, log = () => {}) {
  // Created by step 4b. Absent only on a database that has not reached it.
  if (!(await tableExists(client, "important_dates"))) return 0;

  let changed = 0;
  for (const [column, type] of IMPORTANT_DATES_V2_COLUMNS) {
    if (await columnExists(client, "important_dates", column)) continue;
    await client.query(`alter table important_dates add column ${column} ${type}`);
    log(`  important_dates.${column} added`);
    changed++;
  }
  for (const [name, definition] of IMPORTANT_DATES_V2_CONSTRAINTS) {
    if (await constraintExists(client, name)) continue;
    await client.query(`alter table important_dates add constraint ${name} ${definition}`);
    log(`  important_dates: ${name} added`);
    changed++;
  }
  return changed;
}
