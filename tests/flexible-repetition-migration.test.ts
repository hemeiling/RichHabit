import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  FLEXIBLE_REPETITION_CHECKS, FLEXIBLE_REPETITION_STATEMENTS, checkStatement, migrateFlexibleRepetition,
} from "../scripts/migrations/flexible-repetition.mjs";

/**
 * The flexible-repetition migration (step 22), run for real (PGlite).
 * "Existing" is db/schema.sql without its step-22 block: the schema production
 * runs today. Proves the step only adds (three appended enum values, six
 * nullable columns, eight CHECKs), that every existing row comes through
 * byte-identical over the columns it had, that it is idempotent, that it works
 * inside one transaction as the runner calls it, that it equals a fresh
 * install — and that the code already deployed still reads and writes as
 * before.
 */

const FULL_SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const START = "-- ---- Flexible repetition and weekly rotation (step 22) ----";
const END = "-- ---- end flexible repetition and weekly rotation ----";
const at = (marker: string) => {
  const i = FULL_SCHEMA.indexOf(marker);
  if (i < 0) throw new Error(`marker missing: ${marker}`);
  return i;
};
const blockEnd = FULL_SCHEMA.indexOf("\n", at(END));
const EXISTING_SCHEMA = FULL_SCHEMA.slice(0, at(START)) + FULL_SCHEMA.slice(blockEnd);

const clientFor = (db: { query: PGlite["query"] }) => ({
  async query(sql: string, params?: unknown[]) { return { rows: (await db.query(sql, params as any[])).rows as any[] }; },
});

async function structure(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ line: string }>(`select line from (
      select 'col:'||table_name||'.'||column_name||':'||ordinal_position||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as line
        from information_schema.columns where table_schema = 'public'
      union all select 'idx:'||tablename||'.'||indexname||':'||indexdef from pg_indexes where schemaname = 'public'
      union all select 'con:'||conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid)
        from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> 0
      union all select 'enum:'||t.typname||':'||string_agg(e.enumlabel, ',' order by e.enumsortorder)
        from pg_type t join pg_enum e on e.enumtypid = t.oid group by t.typname
    ) s order by line`);
  return rows.map((r) => r.line);
}
/* What this step owns: its six columns, its eight checks, and freq_mode's
   value list (whose old line is replaced by the longer one). */
const isThisSteps = (l: string) =>
  /interval_days|anchor_date|times_per_month|days_of_month|\.rotation|rotation_known|rotation_has_start|every_n_days_valid|month_times_valid|month_days_valid|enum:freq_mode/.test(l);

let open: PGlite[] = [];
const fresh = async (schema: string) => { const db = await PGlite.create(); open.push(db); await db.exec(schema); return db; };
afterEach(async () => { for (const d of open) await d.close(); open = []; });

async function seed(db: PGlite) {
  await db.exec(`insert into users (email, username, password_hash, created_via)
    values ('a@example.com','ada','scrypt$aa$bb','self_signup');`);
  await db.exec(`
    insert into habits (user_id, name, category, status, start_date)
      select id, 'Read', 'morning', 'active', '2026-09-01' from users;
    insert into habits (user_id, name, category, status, start_date)
      select id, 'Run', 'morning', 'paused', '2026-09-03' from users;
    insert into habit_schedules (habit_id, user_id, mode, effective_from)
      select h.id, h.user_id, 'daily', '2026-09-01' from habits h where h.name = 'Read';
    insert into habit_schedules (habit_id, user_id, mode, days_of_week, effective_from)
      select h.id, h.user_id, 'days', '{1,3,5}', '2026-10-01' from habits h where h.name = 'Read';
    insert into habit_schedules (habit_id, user_id, mode, times_per_week, effective_from)
      select h.id, h.user_id, 'times', 3, '2026-09-03' from habits h where h.name = 'Run';
    insert into habit_completions (habit_id, user_id, done_on)
      select h.id, h.user_id, '2026-10-05' from habits h;`);
}

/** md5 per row over the columns each table had BEFORE the step — the frozen shape. */
async function fingerprints(db: PGlite, columns: Record<string, string[]>) {
  const out: Record<string, string[]> = {};
  for (const [table, cols] of Object.entries(columns)) {
    const { rows } = await db.query<{ h: string }>(
      `select md5(row(${cols.map((c) => `"${c}"`).join(",")})::text) as h from ${table} order by h`);
    out[table] = rows.map((r) => r.h);
  }
  return out;
}
async function columnsOf(db: PGlite, tables: string[]) {
  const out: Record<string, string[]> = {};
  for (const t of tables) {
    out[t] = (await db.query<{ c: string }>(
      `select column_name as c from information_schema.columns
        where table_schema = 'public' and table_name = $1 order by ordinal_position`, [t])).rows.map((r) => r.c);
  }
  return out;
}

describe("the flexible-repetition migration (step 22)", () => {
  it("adds exactly its own objects, leaves every existing row byte-identical, and is idempotent", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    const before = await structure(db);
    const frozen = await columnsOf(db, ["habits", "habit_schedules", "habit_completions", "users"]);
    const dataBefore = await fingerprints(db, frozen);

    const first = await migrateFlexibleRepetition(clientFor(db), () => {});
    expect(first).toBe(3 + 6 + 8);
    const after = await structure(db);
    expect(after.filter((l) => !before.includes(l)).every(isThisSteps)).toBe(true);
    // The only line that goes away is freq_mode's old, shorter value list.
    expect(before.filter((l) => !after.includes(l))).toEqual(["enum:freq_mode:daily,days,times"]);
    expect(after).toContain("enum:freq_mode:daily,days,times,every_n_days,month_times,month_days");
    expect(await fingerprints(db, frozen)).toEqual(dataBefore);
    // The existing rows read as they did: nothing was backfilled into them.
    const [n] = (await db.query<any>(`select count(*)::int as n from habit_schedules
      where interval_days is not null or anchor_date is not null or times_per_month is not null
         or days_of_month is not null`)).rows;
    expect(n.n).toBe(0);

    expect(await migrateFlexibleRepetition(clientFor(db), () => {})).toBe(0);
    expect(await structure(db)).toEqual(after);
  });

  it("runs inside one transaction, as the runner calls it, and the new modes are usable after commit", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    await db.transaction(async (tx) => { await migrateFlexibleRepetition(clientFor(tx), () => {}); });
    await db.query(`insert into habit_schedules (habit_id, user_id, mode, interval_days, anchor_date, effective_from)
      select h.id, h.user_id, 'every_n_days', 3, '2026-10-02', '2026-10-20' from habits h where h.name = 'Read'`);
    const [r] = (await db.query<any>(`select mode::text as mode, interval_days from habit_schedules
      where effective_from = '2026-10-20'`)).rows;
    expect(r).toEqual({ mode: "every_n_days", interval_days: 3 });
  });

  it("equals a fresh install", async () => {
    const migrated = await fresh(EXISTING_SCHEMA);
    await migrateFlexibleRepetition(clientFor(migrated), () => {});
    const installed = await fresh(FULL_SCHEMA);
    expect(await structure(migrated)).toEqual(await structure(installed));
  });

  it("mirrors db/schema.sql statement for statement", () => {
    const block = FULL_SCHEMA.slice(at(START), at(END));
    const squash = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
    for (const statement of FLEXIBLE_REPETITION_STATEMENTS) expect(squash(block)).toContain(squash(statement));
    for (const check of FLEXIBLE_REPETITION_CHECKS) {
      expect(squash(block)).toContain(squash(checkStatement(check as [string, string, string])));
    }
  });

  it("accepts each new shape and refuses an incomplete or out-of-range one", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    await migrateFlexibleRepetition(clientFor(db), () => {});
    const [h] = (await db.query<any>(`select id, user_id from habits where name = 'Read'`)).rows;
    let day = 10;
    const put = (cols: string, vals: string) => db.query(
      `insert into habit_schedules (habit_id, user_id, effective_from, ${cols})
       values ($1, $2, $3, ${vals})`, [h.id, h.user_id, `2026-11-${String(day++).padStart(2, "0")}`]);

    await put("mode, interval_days, anchor_date", "'every_n_days', 3, '2026-11-01'");
    await put("mode, times_per_month", "'month_times', 4");
    await put("mode, days_of_month", "'month_days', '{1,15,31}'");
    await expect(put("mode, interval_days", "'every_n_days', 3")).rejects.toThrow(/every_n_days_valid/);
    await expect(put("mode, interval_days, anchor_date", "'every_n_days', 1, '2026-11-01'")).rejects.toThrow(/interval_days_range/);
    await expect(put("mode", "'month_times'")).rejects.toThrow(/month_times_valid/);
    await expect(put("mode, times_per_month", "'month_times', 32")).rejects.toThrow(/times_per_month_range/);
    await expect(put("mode, days_of_month", "'month_days', '{}'")).rejects.toThrow(/month_days_valid/);
    await expect(put("mode, days_of_month", "'month_days', '{0}'")).rejects.toThrow(/days_of_month_range/);
    await expect(put("mode, days_of_month", "'month_days', '{32}'")).rejects.toThrow(/days_of_month_range/);

    await db.query(`update habits set rotation = 'franklin_virtues', rotation_start = '2026-10-18' where id = $1`, [h.id]);
    await expect(db.query(`update habits set rotation = 'stoics' where id = $1`, [h.id])).rejects.toThrow(/rotation_known/);
    await expect(db.query(`update habits set rotation_start = null where id = $1`, [h.id])).rejects.toThrow(/rotation_has_start/);
  });

  it("leaves the deployed code's own statements working unchanged", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    await migrateFlexibleRepetition(clientFor(db), () => {});
    const [h] = (await db.query<any>(`select id, user_id from habits where name = 'Read'`)).rows;
    // saveHabit's schedule write as it is in production (27d60cc), verbatim.
    await db.query(
      `insert into habit_schedules (habit_id, user_id, mode, days_of_week, times_per_week, effective_from)
       values ($1,$2,$3::freq_mode,$4,$5, current_date)
       on conflict (habit_id, effective_from) do update set
         mode = excluded.mode, days_of_week = excluded.days_of_week,
         times_per_week = excluded.times_per_week
       where habit_schedules.user_id = $2`, [h.id, h.user_id, "times", [0, 1, 2, 3, 4, 5, 6], 2]);
    // And its read: `select *` simply carries the new, empty columns along.
    const rows = (await db.query<any>(
      "select * from habit_schedules where user_id = $1 order by effective_from desc", [h.user_id])).rows;
    expect(rows[0]).toMatchObject({ mode: "times", times_per_week: 2, interval_days: null, days_of_month: null });
  });
});
