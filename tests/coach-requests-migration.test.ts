import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  COACH_REQUEST_TABLES, migrateCoachRequests,
} from "../scripts/migrations/coach-requests.mjs";

/**
 * Migration step 10, run for real against Postgres (PGlite, in process).
 *
 * "Existing" is db/schema.sql without its coach_requests section — the schema
 * production has today. These prove the step only adds, leaves every existing
 * table's structure and every existing row exactly as they were, is idempotent,
 * and produces the same structure as a fresh install.
 */

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const MARKER = "-- ---------------------------- AI coach requests ---";
/* Only this section is removed — everything after it, the AI Workspace tables
   included, stays, so "existing" really is the schema production runs today. */
const NEXT_SECTION = "-- ---- AI workspace, admin only";
const EXISTING_SCHEMA = SCHEMA.slice(0, SCHEMA.indexOf(MARKER))
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
        from information_schema.columns where table_schema = 'public' and table_name <> 'coach_requests'
      union all
      select 'idx:'||tablename||'.'||indexname||':'||indexdef
        from pg_indexes where schemaname = 'public' and tablename <> 'coach_requests'
      union all
      select 'con:'||conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid)
        from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> 0
          and conrelid::regclass::text <> 'coach_requests'
    ) s`);
  return rows[0].s;
}
const fingerprintOfNewTable = async (db: PGlite) => {
  const { rows } = await db.query<{ s: string }>(`select coalesce(string_agg(line, E'\\n' order by line), '') as s from (
      select 'col:'||column_name||':'||data_type||':'||is_nullable as line
        from information_schema.columns where table_schema='public' and table_name='coach_requests'
      union all
      select 'idx:'||indexname||':'||indexdef from pg_indexes
        where schemaname='public' and tablename='coach_requests'
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
afterEach(async () => { for (const db of open) await db.close(); open = []; });

describe("the coach_requests migration", () => {
  it("adds exactly one table, and nothing else moves", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    // A database with real data in it, as production has.
    await db.exec(`insert into users (email, username, password_hash) values ('a@example.com','ada','x');`);
    const [{ id }] = (await db.query<any>(`select id from users limit 1`)).rows;
    await db.query(`insert into habits (user_id, name, category) values ($1, 'Read', 'morning')`, [id]);
    await db.query(`insert into priorities (user_id, body, created_on) values ($1, 'Write', current_date)`, [id]);

    const structureBefore = await structureWithout(db);
    const rowsBefore = JSON.stringify((await db.query(`select * from users`)).rows)
      + JSON.stringify((await db.query(`select * from habits`)).rows)
      + JSON.stringify((await db.query(`select * from priorities`)).rows);

    const changed = await migrateCoachRequests(clientFor(db), () => {});
    expect(changed).toBe(1);

    expect(await structureWithout(db)).toBe(structureBefore);
    const rowsAfter = JSON.stringify((await db.query(`select * from users`)).rows)
      + JSON.stringify((await db.query(`select * from habits`)).rows)
      + JSON.stringify((await db.query(`select * from priorities`)).rows);
    expect(rowsAfter).toBe(rowsBefore);
    // Created empty: nobody starts with allowance already spent.
    expect((await db.query(`select * from coach_requests`)).rows).toEqual([]);
  });

  it("is idempotent: a second run reports nothing and changes nothing", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    expect(await migrateCoachRequests(clientFor(db), () => {})).toBe(1);
    const after = await fingerprintOfNewTable(db);
    expect(await migrateCoachRequests(clientFor(db), () => {})).toBe(0);
    expect(await fingerprintOfNewTable(db)).toBe(after);
  });

  it("produces the same table a fresh install does", async () => {
    const migrated = await fresh(EXISTING_SCHEMA);
    await migrateCoachRequests(clientFor(migrated), () => {});
    const installed = await fresh(SCHEMA);
    expect(await fingerprintOfNewTable(migrated)).toBe(await fingerprintOfNewTable(installed));
  });

  it("does nothing at all on a database with no users table", async () => {
    const db = await PGlite.create();
    open.push(db);
    expect(await migrateCoachRequests(clientFor(db), () => {})).toBe(0);
    const { rows } = await db.query(
      `select 1 from information_schema.tables where table_name = 'coach_requests'`);
    expect(rows).toEqual([]);
  });

  it("names the one table it creates", () => {
    expect(COACH_REQUEST_TABLES).toEqual(["coach_requests"]);
  });

  it("records nothing about the question itself — only that one happened", async () => {
    const db = await fresh(SCHEMA);
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'coach_requests'`);
    // A cost guard, not a transcript and not a token ledger. If this list ever
    // grows, that is a privacy decision and it should be made deliberately.
    expect(rows.map((r) => r.column_name).sort()).toEqual(["id", "occurred_at", "user_id"]);
  });

  it("deletes an account's requests with the account, and never the reverse", async () => {
    const db = await fresh(SCHEMA);
    await db.exec(`insert into users (email, username, password_hash) values ('b@example.com','bea','x');`);
    const [{ id }] = (await db.query<any>(`select id from users limit 1`)).rows;
    await db.query(`insert into coach_requests (user_id) values ($1)`, [id]);
    await db.query(`delete from users where id = $1`, [id]);
    expect((await db.query(`select * from coach_requests`)).rows).toEqual([]);
  });
});
