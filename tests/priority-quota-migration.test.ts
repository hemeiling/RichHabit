import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  PRIORITY_QUOTA_TABLES, migratePriorityQuota,
} from "../scripts/migrations/priority-quota-usage.mjs";

/**
 * Migration step 12, run for real against Postgres (PGlite, in process).
 *
 * "Existing" is db/schema.sql without its quota table — the schema production
 * runs today, 38 tables including `user_plans`. These prove the step only adds,
 * leaves every existing table's structure and every existing row exactly as they
 * were, is idempotent, and produces the same structure as a fresh install.
 *
 * Unlike `user_plans` there is no trigger to reconcile: the row carries no
 * `updated_at`, because its only fact is a count.
 */

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
/* The quota block sits between these two comments in the schema. Removing it
   yields the pre-Phase-5 schema without needing a section marker of its own. */
const BLOCK_START = "-- How many new priorities an account has created on one of its own calendar";
const NEXT_SECTION = "-- A reflection on a whole month, written from the Insights review.";
const EXISTING_SCHEMA = SCHEMA.slice(0, SCHEMA.indexOf(BLOCK_START))
  + SCHEMA.slice(SCHEMA.indexOf(NEXT_SECTION));

const clientFor = (db: PGlite) => ({
  async query(sql: string, params?: unknown[]) {
    const result = await db.query(sql, params as any[]);
    return { rows: result.rows as any[] };
  },
});

/** A fingerprint of everything that is not the new table. */
async function structureWithout(db: PGlite): Promise<string> {
  const { rows } = await db.query<{ s: string }>(`select coalesce(string_agg(line, E'\\n' order by line), '') as s from (
      select 'col:'||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as line
        from information_schema.columns where table_schema = 'public' and table_name <> 'priority_quota_usage'
      union all
      select 'idx:'||tablename||'.'||indexname||':'||indexdef
        from pg_indexes where schemaname = 'public' and tablename <> 'priority_quota_usage'
      union all
      select 'con:'||conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid)
        from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> 0
          and conrelid::regclass::text <> 'priority_quota_usage'
      union all
      select 'trg:'||tgrelid::regclass::text||'.'||tgname from pg_trigger
       where not tgisinternal and tgrelid::regclass::text <> 'priority_quota_usage'
    ) s`);
  return rows[0].s;
}

/** Columns, indexes, constraints and triggers of the new table. */
const fingerprintOfNewTable = async (db: PGlite) => {
  const { rows } = await db.query<{ s: string }>(`select coalesce(string_agg(line, E'\\n' order by line), '') as s from (
      select 'col:'||column_name||':'||data_type||':'||is_nullable as line
        from information_schema.columns
        where table_schema='public' and table_name='priority_quota_usage'
      union all
      select 'idx:'||indexname||':'||indexdef from pg_indexes
        where schemaname='public' and tablename='priority_quota_usage'
      union all
      select 'con:'||conname||':'||pg_get_constraintdef(oid) from pg_constraint
        where conrelid = 'priority_quota_usage'::regclass
      union all
      select 'trg:'||tgname from pg_trigger
        where tgrelid = 'priority_quota_usage'::regclass and not tgisinternal
    ) s`);
  return rows[0].s;
};

let open: PGlite[] = [];
const fresh = async (schema: string) => {
  const db = await PGlite.create();
  open.push(db);
  await db.exec(schema);
  return db;
};
const account = async (db: PGlite, email: string) =>
  (await db.query<any>(
    `insert into users (email, password_hash) values ($1, 'x') returning id`, [email])).rows[0].id as string;

afterEach(async () => { for (const db of open) await db.close(); open = []; });

describe("the priority_quota_usage migration", () => {
  it("removing the block really did produce a schema without the table", async () => {
    // Otherwise every test below would be comparing the table against itself.
    expect(EXISTING_SCHEMA).not.toContain("priority_quota_usage");
    expect(SCHEMA).toContain("create table priority_quota_usage");
    // And the surgery kept everything else, user_plans included.
    expect(EXISTING_SCHEMA).toContain("create table user_plans");
    expect(EXISTING_SCHEMA).toContain("create table priorities");
  });

  it("adds exactly one table, and nothing else moves", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    // A database with real data in it, as production has.
    const id = await account(db, "a@example.com");
    await db.query(`insert into habits (user_id, name, category) values ($1, 'Read', 'morning')`, [id]);
    await db.query(`insert into priorities (user_id, body, created_on) values ($1, 'Write', current_date)`, [id]);
    await db.query(`insert into user_plans (user_id, plan, source) values ($1, 'pro', 'grandfathered')`, [id]);

    const structureBefore = await structureWithout(db);
    const rowsBefore = JSON.stringify((await db.query(`select * from users`)).rows)
      + JSON.stringify((await db.query(`select * from habits`)).rows)
      + JSON.stringify((await db.query(`select * from priorities`)).rows)
      + JSON.stringify((await db.query(`select * from user_plans`)).rows);

    const changed = await migratePriorityQuota(clientFor(db), () => {});
    expect(changed).toBe(1);

    expect(await structureWithout(db)).toBe(structureBefore);
    const rowsAfter = JSON.stringify((await db.query(`select * from users`)).rows)
      + JSON.stringify((await db.query(`select * from habits`)).rows)
      + JSON.stringify((await db.query(`select * from priorities`)).rows)
      + JSON.stringify((await db.query(`select * from user_plans`)).rows);
    expect(rowsAfter).toBe(rowsBefore);
    // Created empty: nobody has used anything, and no row says so.
    expect((await db.query(`select * from priority_quota_usage`)).rows).toEqual([]);
  });

  it("leaves the 8-row style Grandfathered Pro grants completely alone", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push(await account(db, `pro${i}@example.com`));
    for (const id of ids) {
      await db.query(
        `insert into user_plans (user_id, plan, source) values ($1, 'pro', 'grandfathered')`, [id]);
    }
    const before = JSON.stringify((await db.query(`select * from user_plans order by user_id`)).rows);
    await migratePriorityQuota(clientFor(db), () => {});
    expect(JSON.stringify((await db.query(`select * from user_plans order by user_id`)).rows)).toBe(before);
    expect((await db.query<any>(
      `select count(*)::int n from user_plans where plan='pro' and source='grandfathered'`)).rows[0].n)
      .toBe(8);
  });

  it("is idempotent: a second run reports nothing and changes nothing", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    expect(await migratePriorityQuota(clientFor(db), () => {})).toBe(1);
    const after = await fingerprintOfNewTable(db);
    expect(await migratePriorityQuota(clientFor(db), () => {})).toBe(0);
    expect(await fingerprintOfNewTable(db)).toBe(after);
  });

  it("produces the same table a fresh install does", async () => {
    const migrated = await fresh(EXISTING_SCHEMA);
    await migratePriorityQuota(clientFor(migrated), () => {});
    const installed = await fresh(SCHEMA);
    expect(await fingerprintOfNewTable(migrated)).toBe(await fingerprintOfNewTable(installed));
  });

  it("needs no trigger, unlike user_plans — the row has no updated_at", async () => {
    const db = await fresh(SCHEMA);
    expect(await fingerprintOfNewTable(db)).not.toContain("trg:");
    const cols = (await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='priority_quota_usage'`)).rows
      .map((r) => r.column_name).sort();
    expect(cols).toEqual(["created", "local_day", "user_id"]);
  });

  it("does nothing at all on a database with no users table", async () => {
    const db = await PGlite.create();
    open.push(db);
    expect(await migratePriorityQuota(clientFor(db), () => {})).toBe(0);
    const { rows } = await db.query(
      `select 1 from information_schema.tables where table_name = 'priority_quota_usage'`);
    expect(rows).toEqual([]);
  });

  it("names the one table it creates", () => {
    expect(PRIORITY_QUOTA_TABLES).toEqual(["priority_quota_usage"]);
  });
});

describe("what the table itself refuses", () => {
  it("holds one row per account per day", async () => {
    const db = await fresh(SCHEMA);
    const id = await account(db, "b@example.com");
    await db.query(
      `insert into priority_quota_usage (user_id, local_day, created) values ($1, '2026-09-20', 1)`, [id]);
    await expect(db.query(
      `insert into priority_quota_usage (user_id, local_day, created) values ($1, '2026-09-20', 2)`, [id]))
      .rejects.toThrow();
    // A different day is a different key, which is why no reset job exists.
    await expect(db.query(
      `insert into priority_quota_usage (user_id, local_day, created) values ($1, '2026-09-21', 1)`, [id]))
      .resolves.toBeTruthy();
  });

  it("refuses a negative count", async () => {
    const db = await fresh(SCHEMA);
    const id = await account(db, "c@example.com");
    await expect(db.query(
      `insert into priority_quota_usage (user_id, local_day, created) values ($1, current_date, -1)`, [id]))
      .rejects.toThrow();
  });

  it("disappears with its account", async () => {
    const db = await fresh(SCHEMA);
    const id = await account(db, "d@example.com");
    await db.query(
      `insert into priority_quota_usage (user_id, local_day, created) values ($1, current_date, 3)`, [id]);
    await db.query(`delete from users where id = $1`, [id]);
    expect((await db.query(`select * from priority_quota_usage`)).rows).toEqual([]);
  });

  it("carries no billing, price or provider column", async () => {
    const db = await fresh(SCHEMA);
    const cols = (await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='priority_quota_usage'`)).rows
      .map((r) => r.column_name);
    for (const banned of ["price", "amount", "customer_id", "subscription_id", "invoice"]) {
      expect(cols).not.toContain(banned);
    }
  });
});
