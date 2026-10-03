import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  IMPORTANT_DATES_V2_COLUMNS, IMPORTANT_DATES_V2_CONSTRAINTS, migrateImportantDatesV2,
} from "../scripts/migrations/important-dates-v2.mjs";

/**
 * Migration step 13 — optional times and repeating events on important_dates —
 * run for real against Postgres (PGlite, in process).
 *
 * "Existing" is db/schema.sql without its V2 block: the schema production runs
 * today. The table already holds people's dates, so these prove the step only
 * adds, that every existing row comes through byte-for-byte (by checksum and by
 * full comparison), that every existing row reads as all day and once, that it
 * is idempotent, and that it produces exactly what a fresh install does.
 */

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const START = "-- ---- important dates: optional times, and repeating events ----";
const END = "-- ---- end important dates: optional times, and repeating events ----";
const EXISTING_SCHEMA = SCHEMA.slice(0, SCHEMA.indexOf(START))
  + SCHEMA.slice(SCHEMA.indexOf(END) + END.length);

const clientFor = (db: PGlite) => ({
  async query(sql: string, params?: unknown[]) {
    const result = await db.query(sql, params as any[]);
    return { rows: result.rows as any[] };
  },
});

/** Every column, index and constraint in the database — the whole structure. */
async function structure(db: PGlite, { except }: { except?: "v2" } = {}): Promise<string> {
  const { rows } = await db.query<{ s: string }>(`select coalesce(string_agg(line, E'\\n' order by line), '') as s from (
      select 'col:'||table_name||'.'||column_name||':'||ordinal_position||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as line
        from information_schema.columns where table_schema = 'public'
      union all
      select 'idx:'||tablename||'.'||indexname||':'||indexdef
        from pg_indexes where schemaname = 'public'
      union all
      select 'con:'||conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid)
        from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> 0
    ) s`);
  if (except !== "v2") return rows[0].s;
  const v2 = [...IMPORTANT_DATES_V2_COLUMNS.map(([c]) => `col:important_dates.${c}:`),
    // Postgres 18 lists a column's NOT NULL as a constraint of its own.
    ...IMPORTANT_DATES_V2_COLUMNS.map(([c]) => `con:important_dates.important_dates_${c}_not_null:`),
    ...IMPORTANT_DATES_V2_CONSTRAINTS.map(([c]) => `con:important_dates.${c}:`)];
  return rows[0].s.split("\n").filter((l) => !v2.some((p) => l.startsWith(p))).join("\n");
}

const ORIGINAL_COLUMNS = "id, user_id, title, starts_on, ends_on, note, color, kind, created_at, updated_at";
/** A checksum over every original column of every row, in id order. */
const checksum = async (db: PGlite) => (await db.query<{ md5: string; n: number }>(
  `select md5(coalesce(string_agg(row_to_json(r)::text, '|' order by r.id), '')) md5, count(*)::int n
     from (select ${ORIGINAL_COLUMNS} from important_dates) r`)).rows[0];

let open: PGlite[] = [];
const fresh = async (schema: string) => {
  const db = await PGlite.create();
  open.push(db);
  await db.exec(schema);
  return db;
};
afterEach(async () => { for (const db of open) await db.close(); open = []; });

/** Production-shaped data: two accounts, single-day and multi-day events, a long note. */
async function seed(db: PGlite) {
  await db.exec(`insert into users (email, username, password_hash) values
    ('a@example.com','ada','x'), ('b@example.com','bea','x');`);
  const ids = (await db.query<any>(`select id from users order by email`)).rows.map((r) => r.id);
  await db.query(`insert into important_dates (user_id, title, starts_on, ends_on, note, color, kind) values
    ($1, 'Battery Show — Detroit', '2026-09-09', '2026-09-11', 'Booth 412', 'teal', 'travel'),
    ($1, '妈妈的生日', '2026-10-12', '2026-10-12', null, 'rose', 'none'),
    ($1, 'Quarter close', '2026-12-31', '2026-12-31', $3, '#3E76C4', 'deadline'),
    ($2, 'Trip', '2026-12-30', '2027-01-02', 'Line one\nLine two', 'blue', 'personal')`,
  [ids[0], ids[1], "x".repeat(9_999)]);
  return ids;
}

describe("the important_dates V2 migration", () => {
  it("adds seven columns and seven constraints, and nothing else moves", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    const before = await structure(db);
    const changed = await migrateImportantDatesV2(clientFor(db), () => {});
    expect(changed).toBe(IMPORTANT_DATES_V2_COLUMNS.length + IMPORTANT_DATES_V2_CONSTRAINTS.length);
    expect(changed).toBe(14);
    // With the new columns and constraints set aside, the structure is identical:
    // no column, index or constraint anywhere in the database was changed.
    expect(await structure(db, { except: "v2" })).toBe(before);
  });

  it("leaves every existing row byte-for-byte as it was, ids included", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    const sumBefore = await checksum(db);
    const rowsBefore = (await db.query(`select ${ORIGINAL_COLUMNS} from important_dates order by id`)).rows;
    expect(sumBefore.n).toBe(4);

    await migrateImportantDatesV2(clientFor(db), () => {});

    expect(await checksum(db)).toEqual(sumBefore);
    expect((await db.query(`select ${ORIGINAL_COLUMNS} from important_dates order by id`)).rows).toEqual(rowsBefore);
  });

  it("reads every existing event as all day and not repeating", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    await migrateImportantDatesV2(clientFor(db), () => {});
    const { rows } = await db.query<any>(
      `select start_time, end_time, time_zone, repeat_unit, repeat_interval, repeat_until,
              cardinality(excluded_on) excluded from important_dates`);
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r).toEqual({ start_time: null, end_time: null, time_zone: null, repeat_unit: null,
        repeat_interval: 1, repeat_until: null, excluded: 0 });
    }
  });

  it("is idempotent: a second run reports nothing and changes nothing", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    await migrateImportantDatesV2(clientFor(db), () => {});
    const after = await structure(db);
    const sum = await checksum(db);
    expect(await migrateImportantDatesV2(clientFor(db), () => {})).toBe(0);
    expect(await structure(db)).toBe(after);
    expect(await checksum(db)).toEqual(sum);
  });

  it("produces exactly the structure a fresh install does, column order included", async () => {
    const migrated = await fresh(EXISTING_SCHEMA);
    await migrateImportantDatesV2(clientFor(migrated), () => {});
    const installed = await fresh(SCHEMA);
    expect(await structure(migrated)).toBe(await structure(installed));
  });

  it("is a no-op on a fresh install, which already has it", async () => {
    const db = await fresh(SCHEMA);
    expect(await migrateImportantDatesV2(clientFor(db), () => {})).toBe(0);
  });

  it("does nothing at all on a database with no important_dates table", async () => {
    const db = await PGlite.create();
    open.push(db);
    expect(await migrateImportantDatesV2(clientFor(db), () => {})).toBe(0);
  });

  it("contains no destructive statement", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", "scripts", "migrations", "important-dates-v2.mjs"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const word of [/\bdrop\b/i, /\bdelete\b/i, /\btruncate\b/i, /\bupdate\b/i, /\binsert\b/i, /\brename\b/i]) {
      expect(code, String(word)).not.toMatch(word);
    }
  });

  it("is wired into the migration runner", () => {
    const runner = fs.readFileSync(path.resolve(__dirname, "..", "scripts", "migrate.mjs"), "utf8");
    expect(runner).toContain("await migrateImportantDatesV2(client, console.log)");
  });
});

describe("the V2 constraints", () => {
  const insert = async (db: PGlite, cols: string, vals: string) => {
    const [{ id }] = (await db.query<any>(`select id from users limit 1`)).rows;
    return db.query(`insert into important_dates (user_id, title, starts_on, ends_on, ${cols})
                     values ('${id}', 'x', '2026-10-12', '2026-10-12', ${vals})`);
  };
  const setup = async () => {
    const db = await fresh(SCHEMA);
    await db.exec(`insert into users (email, username, password_hash) values ('c@example.com','cy','x');`);
    return db;
  };

  it("accept what the app writes", async () => {
    const db = await setup();
    await insert(db, "start_time, end_time, time_zone", "'19:00', '20:00', 'America/Chicago'");
    await insert(db, "start_time", "'19:00'");                                   // floating, open-ended
    await insert(db, "repeat_unit, repeat_interval, repeat_until", "'year', 1, '2030-10-12'");
    await insert(db, "repeat_unit, excluded_on", "'week', '{2026-10-19}'");
  });

  it("refuse what the app would never write", async () => {
    const db = await setup();
    const refuses = (cols: string, vals: string, name: string) =>
      expect(insert(db, cols, vals)).rejects.toMatchObject({ code: "23514", constraint: name });
    await refuses("repeat_unit", "'day'", "important_dates_repeat_unit_check");
    await refuses("repeat_interval", "0", "important_dates_repeat_interval_check");
    await refuses("repeat_interval", "100", "important_dates_repeat_interval_check");
    await refuses("repeat_until", "'2026-10-11'", "important_dates_repeat_until_check");
    await refuses("end_time", "'20:00'", "important_dates_time_check");
    await refuses("time_zone", "'America/Chicago'", "important_dates_time_check");
    await refuses("start_time, end_time", "'20:00', '19:00'", "important_dates_time_order_check");
    await refuses("start_time, time_zone", "'20:00', ''", "important_dates_time_zone_check");
    await refuses("excluded_on",
      `(select array_agg(d::date) from generate_series('2026-01-01'::date, '2027-12-31'::date, interval '1 day') d)`,
      "important_dates_excluded_on_check");
  });
});
