import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { GOOGLE_SIGNIN_STATEMENTS, migrateGoogleSignin } from "../scripts/migrations/google-signin.mjs";

/**
 * The Google sign-in migration (step 21), run for real (PGlite). "Existing" is
 * db/schema.sql without its Google block: the schema production runs today.
 * Proves the step only adds (two tables, the nullable password_hash, the wider
 * created_via CHECK), that every existing row comes through byte-identical,
 * that it is idempotent and equals a fresh install — and that a null hash and
 * the 'google' provenance are actually usable afterwards.
 */

const FULL_SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const START = "-- ---- Google sign-in (step 21) ----";
const END = "-- ---- end Google sign-in ----";
const EXISTING_SCHEMA = FULL_SCHEMA.slice(0, FULL_SCHEMA.indexOf(START))
  + FULL_SCHEMA.slice(FULL_SCHEMA.indexOf(END) + END.length);

const clientFor = (db: PGlite) => ({
  async query(sql: string, params?: unknown[]) { return { rows: (await db.query(sql, params as any[])).rows as any[] }; },
});

async function structure(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ line: string }>(`select line from (
      select 'col:'||table_name||'.'||column_name||':'||ordinal_position||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as line
        from information_schema.columns where table_schema = 'public'
      union all select 'idx:'||tablename||'.'||indexname||':'||indexdef from pg_indexes where schemaname = 'public'
      union all select 'con:'||conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid)
        from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> 0
    ) s order by line`);
  return rows.map((r) => r.line);
}
/* What this step owns: the two new tables, password_hash's nullability (its
   catalog NOT NULL line disappears), and the created_via CHECK's wording. */
const isThisSteps = (l: string) =>
  /auth_identities|google_pending|password_hash|users_created_via_check/.test(l);

let open: PGlite[] = [];
const fresh = async (schema: string) => { const db = await PGlite.create(); open.push(db); await db.exec(schema); return db; };
afterEach(async () => { for (const d of open) await d.close(); open = []; });

async function seed(db: PGlite) {
  await db.exec(`insert into users (email, username, password_hash, created_via)
    values ('a@example.com','ada','scrypt$aa$bb','self_signup'), ('b@example.com','bea','scrypt$cc$dd','admin');`);
  await db.exec(`insert into profiles (id) select id from users`);
}

const rowsOf = async (db: PGlite) =>
  (await db.query<any>(`select md5(t.*::text) as h from users t order by h`)).rows.map((r) => r.h);

describe("the Google sign-in migration", () => {
  it("adds exactly its own objects, leaves every existing row byte-identical, and is idempotent", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    const before = await structure(db);
    const dataBefore = await rowsOf(db);

    const first = await migrateGoogleSignin(clientFor(db), () => {});
    expect(first).toBe(4);
    const after = await structure(db);
    expect(after.filter((l) => !before.includes(l)).every(isThisSteps)).toBe(true);
    // Removed lines are password_hash's old NOT NULL shape and the old CHECK.
    expect(before.filter((l) => !after.includes(l)).every(isThisSteps)).toBe(true);
    expect(await rowsOf(db)).toEqual(dataBefore);

    expect(await migrateGoogleSignin(clientFor(db), () => {})).toBe(0);
    expect(await structure(db)).toEqual(after);
  });

  it("equals a fresh install", async () => {
    const migrated = await fresh(EXISTING_SCHEMA);
    await migrateGoogleSignin(clientFor(migrated), () => {});
    const installed = await fresh(FULL_SCHEMA);
    expect(await structure(migrated)).toEqual(await structure(installed));
  });

  it("mirrors db/schema.sql statement for statement", () => {
    const block = FULL_SCHEMA.slice(FULL_SCHEMA.indexOf(START), FULL_SCHEMA.indexOf(END));
    const squash = (s: string) =>
      s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
    for (const statement of GOOGLE_SIGNIN_STATEMENTS) {
      expect(squash(block)).toContain(squash(statement));
    }
    // The CHECK swap too, so a fresh install and a migrated one agree.
    expect(squash(block)).toContain(squash(
      `alter table users add constraint users_created_via_check
         check (created_via in ('self_signup', 'admin', 'test', 'google'))`));
  });

  it("makes a Google-only account storable, and 'google' a valid provenance — while garbage still is not", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    await migrateGoogleSignin(clientFor(db), () => {});
    await db.query(`insert into users (email, username, password_hash, created_via)
      values ('g@example.com', 'goo', null, 'google')`);
    const [u] = (await db.query<any>(`select id, password_hash from users where username = 'goo'`)).rows;
    expect(u.password_hash).toBeNull();
    await expect(db.query(`insert into users (email, username, password_hash, created_via)
      values ('x@example.com', 'xx', null, 'surprise')`)).rejects.toThrow(/created_via/);
    // One Google identity per account, one account per Google subject.
    await db.query(`insert into auth_identities (user_id, provider, provider_user_id) values ($1, 'google', 'sub-1')`, [u.id]);
    await expect(db.query(
      `insert into auth_identities (user_id, provider, provider_user_id) values ($1, 'google', 'sub-2')`, [u.id],
    )).rejects.toThrow();
    const [other] = (await db.query<any>(`select id from users where username = 'ada'`)).rows;
    await expect(db.query(
      `insert into auth_identities (user_id, provider, provider_user_id) values ($1, 'google', 'sub-1')`, [other.id],
    )).rejects.toThrow();
    // Deleting the account cascades its identity away — the retention policy.
    await db.query(`delete from users where id = $1`, [u.id]);
    expect((await db.query<any>(`select count(*)::int as n from auth_identities`)).rows[0].n).toBe(0);
  });
});
