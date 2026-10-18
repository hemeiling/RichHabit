/**
 * Flexible repetition and the weekly rotation — runner step 22, after Google
 * sign-in (21).
 *
 * Everything is additive and touches no existing row:
 *
 *   freq_mode                     — three new values: 'every_n_days',
 *                                   'month_times', 'month_days'. Appended, so
 *                                   every existing value keeps its meaning.
 *   habit_schedules.interval_days — every N days: the gap (2–365)…
 *   habit_schedules.anchor_date   — …and the day the rhythm counts from, so a
 *                                   missed day never moves the next one.
 *   habit_schedules.times_per_month — N times in each calendar month (1–31).
 *   habit_schedules.days_of_month — specific days (1–31); a day a month does
 *                                   not have falls on its last day.
 *   habits.rotation               — a habit that cycles through a fixed list,
 *                                   one item per week ('franklin_virtues')…
 *   habits.rotation_start         — …counted from this Sunday, so each past
 *                                   week keeps the virtue it had.
 *
 * Every new column is nullable with no default, so adding it rewrites nothing,
 * and every CHECK is satisfied by every existing row (all of them are null, or
 * name a mode the check does not constrain). The checks compare `mode::text`
 * rather than the enum: a value added in this transaction may not be used as
 * an enum literal until it commits.
 *
 * Postgres cannot drop an enum value, so the three modes are permanent once
 * this runs. Unused, they are inert; older code never writes them.
 *
 * db/schema.sql carries the same statements for fresh installs;
 * tests/flexible-repetition-migration.test.ts proves both match.
 */

export const FREQ_MODES_ADDED = ["every_n_days", "month_times", "month_days"];

const DAYS_1_TO_31 = `'{${Array.from({ length: 31 }, (_, i) => i + 1).join(",")}}'::smallint[]`;

export const FLEXIBLE_REPETITION_STATEMENTS = [
  ...FREQ_MODES_ADDED.map((v) => `alter type freq_mode add value if not exists '${v}'`),
  `alter table habit_schedules add column if not exists interval_days smallint`,
  `alter table habit_schedules add column if not exists anchor_date date`,
  `alter table habit_schedules add column if not exists times_per_month smallint`,
  `alter table habit_schedules add column if not exists days_of_month smallint[]`,
  `alter table habits add column if not exists rotation text`,
  `alter table habits add column if not exists rotation_start date`,
];

/** [table, name, definition] — added only when absent, by name. */
export const FLEXIBLE_REPETITION_CHECKS = [
  ["habit_schedules", "interval_days_range", `check (interval_days between 2 and 365)`],
  ["habit_schedules", "times_per_month_range", `check (times_per_month between 1 and 31)`],
  ["habit_schedules", "days_of_month_range", `check (days_of_month <@ ${DAYS_1_TO_31})`],
  ["habit_schedules", "every_n_days_valid",
    `check (mode::text <> 'every_n_days' or (interval_days is not null and anchor_date is not null))`],
  ["habit_schedules", "month_times_valid",
    `check (mode::text <> 'month_times' or times_per_month is not null)`],
  ["habit_schedules", "month_days_valid",
    `check (mode::text <> 'month_days' or coalesce(array_length(days_of_month, 1), 0) > 0)`],
  ["habits", "rotation_known", `check (rotation in ('franklin_virtues'))`],
  ["habits", "rotation_has_start", `check (rotation is null or rotation_start is not null)`],
];

export const checkStatement = ([table, name, def]) => `alter table ${table} add constraint ${name} ${def}`;

async function tableExists(client, table) {
  const { rows } = await client.query(
    `select 1 from information_schema.tables where table_schema = 'public' and table_name = $1`, [table]);
  return rows.length > 0;
}

export async function migrateFlexibleRepetition(client, log = () => {}) {
  if (!(await tableExists(client, "habit_schedules")) || !(await tableExists(client, "habits"))) return 0;
  let changed = 0;

  const { rows: modes } = await client.query(
    `select unnest(enum_range(null::freq_mode))::text as v`);
  const hadModes = new Set(modes.map((r) => r.v));
  const { rows: cols } = await client.query(
    `select table_name || '.' || column_name as c from information_schema.columns
      where table_schema = 'public' and table_name in ('habit_schedules', 'habits')`);
  const hadCols = new Set(cols.map((r) => r.c));
  const { rows: cons } = await client.query(
    `select conname from pg_constraint
      where conrelid in ('habit_schedules'::regclass, 'habits'::regclass) and contype = 'c'`);
  const hadChecks = new Set(cons.map((r) => r.conname));

  for (const statement of FLEXIBLE_REPETITION_STATEMENTS) await client.query(statement);
  for (const check of FLEXIBLE_REPETITION_CHECKS) {
    if (hadChecks.has(check[1])) continue;
    await client.query(checkStatement(check));
    log(`  added check ${check[0]}.${check[1]}`);
    changed++;
  }

  for (const v of FREQ_MODES_ADDED) {
    if (!hadModes.has(v)) { log(`  freq_mode admits '${v}'`); changed++; }
  }
  for (const c of ["habit_schedules.interval_days", "habit_schedules.anchor_date",
    "habit_schedules.times_per_month", "habit_schedules.days_of_month",
    "habits.rotation", "habits.rotation_start"]) {
    if (!hadCols.has(c)) { log(`  added column ${c}`); changed++; }
  }
  return changed;
}
