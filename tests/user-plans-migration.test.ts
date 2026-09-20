import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { USER_PLAN_TABLES, migrateUserPlans } from "../scripts/migrations/user-plans.mjs";

/**
 * Migration step 11, run for real against Postgres (PGlite, in process).
 *
 * "Existing" is db/schema.sql without its plans section — the schema production
 * runs today. These prove the step only adds, leaves every existing table's
 * structure and every existing row exactly as they were, is idempotent, and
 * produces the same structure as a fresh install.
 *
 * The trigger is the part worth the most care. The schema applies
 * `touch_updated_at()` through a `do $$ … foreach …` loop that only runs on a
 * fresh install, so a migrated database would silently lack it — tests would
 * pass on the half that works. The migration therefore creates the trigger
 * itself, and the parity test below compares both paths.
 */

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const MARKER = "-- -------------------------------- plans ---";
/* Only this section is removed — everything after it, coach_requests and the AI
   Workspace tables included, stays. */
const NEXT_SECTION = "-- ---------------------------- AI coach requests ---";
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
        from information_schema.columns where table_schema = 'public' and table_name <> 'user_plans'
      union all
      select 'idx:'||tablename||'.'||indexname||':'||indexdef
        from pg_indexes where schemaname = 'public' and tablename <> 'user_plans'
      union all
      select 'con:'||conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid)
        from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> 0
          and conrelid::regclass::text <> 'user_plans'
      union all
      select 'trg:'||tgrelid::regclass::text||'.'||tgname from pg_trigger
       where not tgisinternal and tgrelid::regclass::text <> 'user_plans'
    ) s`);
  return rows[0].s;
}

/** Columns, indexes, constraints and triggers of the new table. */
const fingerprintOfNewTable = async (db: PGlite) => {
  const { rows } = await db.query<{ s: string }>(`select coalesce(string_agg(line, E'\\n' order by line), '') as s from (
      select 'col:'||column_name||':'||data_type||':'||is_nullable as line
        from information_schema.columns where table_schema='public' and table_name='user_plans'
      union all
      select 'idx:'||indexname||':'||indexdef from pg_indexes
        where schemaname='public' and tablename='user_plans'
      union all
      select 'con:'||conname||':'||pg_get_constraintdef(oid) from pg_constraint
        where conrelid = 'user_plans'::regclass
      union all
      select 'trg:'||tgname from pg_trigger
        where tgrelid = 'user_plans'::regclass and not tgisinternal
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

describe("the user_plans migration", () => {
  it("adds exactly one table, and nothing else moves", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    // A database with real data in it, as production has.
    const id = await account(db, "a@example.com");
    await db.query(`insert into habits (user_id, name, category) values ($1, 'Read', 'morning')`, [id]);
    await db.query(`insert into priorities (user_id, body, created_on) values ($1, 'Write', current_date)`, [id]);

    const structureBefore = await structureWithout(db);
    const rowsBefore = JSON.stringify((await db.query(`select * from users`)).rows)
      + JSON.stringify((await db.query(`select * from habits`)).rows)
      + JSON.stringify((await db.query(`select * from priorities`)).rows);

    const changed = await migrateUserPlans(clientFor(db), () => {});
    expect(changed).toBeGreaterThan(0);

    expect(await structureWithout(db)).toBe(structureBefore);
    const rowsAfter = JSON.stringify((await db.query(`select * from users`)).rows)
      + JSON.stringify((await db.query(`select * from habits`)).rows)
      + JSON.stringify((await db.query(`select * from priorities`)).rows);
    expect(rowsAfter).toBe(rowsBefore);
    // Created empty: every existing account is Free, and no row says so.
    expect((await db.query(`select * from user_plans`)).rows).toEqual([]);
  });

  it("is idempotent: a second run reports nothing and changes nothing", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    expect(await migrateUserPlans(clientFor(db), () => {})).toBeGreaterThan(0);
    const after = await fingerprintOfNewTable(db);
    expect(await migrateUserPlans(clientFor(db), () => {})).toBe(0);
    expect(await fingerprintOfNewTable(db)).toBe(after);
  });

  it("produces the same table a fresh install does — trigger included", async () => {
    const migrated = await fresh(EXISTING_SCHEMA);
    await migrateUserPlans(clientFor(migrated), () => {});
    const installed = await fresh(SCHEMA);
    expect(await fingerprintOfNewTable(migrated)).toBe(await fingerprintOfNewTable(installed));
    // The asymmetry this test exists for: the schema's trigger loop does not run
    // on an existing database, so the migration has to create it.
    expect(await fingerprintOfNewTable(migrated)).toContain("trg:user_plans_touch");
  });

  it("does nothing at all on a database with no users table", async () => {
    const db = await PGlite.create();
    open.push(db);
    expect(await migrateUserPlans(clientFor(db), () => {})).toBe(0);
    const { rows } = await db.query(
      `select 1 from information_schema.tables where table_name = 'user_plans'`);
    expect(rows).toEqual([]);
  });

  it("names the one table it creates", () => {
    expect(USER_PLAN_TABLES).toEqual(["user_plans"]);
  });
});

describe("what the table itself refuses", () => {
  it("requires a source for Pro, and allows one without for Free", async () => {
    const db = await fresh(SCHEMA);
    const id = await account(db, "b@example.com");
    await expect(db.query(
      `insert into user_plans (user_id, plan) values ($1, 'pro')`, [id])).rejects.toThrow();
    await expect(db.query(
      `insert into user_plans (user_id, plan) values ($1, 'free')`, [id])).resolves.toBeTruthy();
  });

  it("refuses an unknown plan or source", async () => {
    const db = await fresh(SCHEMA);
    const id = await account(db, "c@example.com");
    await expect(db.query(
      `insert into user_plans (user_id, plan, source) values ($1, 'enterprise', 'purchased')`, [id]))
      .rejects.toThrow();
    await expect(db.query(
      `insert into user_plans (user_id, plan, source) values ($1, 'pro', 'crypto')`, [id]))
      .rejects.toThrow();
  });

  it("accepts every source the product defines", async () => {
    const db = await fresh(SCHEMA);
    for (const source of ["grandfathered", "purchased", "gifted", "promotional", "trial", "support"]) {
      const id = await account(db, `${source}@example.com`);
      await expect(db.query(
        `insert into user_plans (user_id, plan, source) values ($1, 'pro', $2)`, [id, source]))
        .resolves.toBeTruthy();
    }
    expect((await db.query(`select count(*)::int n from user_plans`)).rows[0]).toEqual({ n: 6 });
  });

  it("holds one current row per account", async () => {
    const db = await fresh(SCHEMA);
    const id = await account(db, "d@example.com");
    await db.query(`insert into user_plans (user_id, plan, source) values ($1, 'pro', 'gifted')`, [id]);
    await expect(db.query(
      `insert into user_plans (user_id, plan, source) values ($1, 'pro', 'trial')`, [id]))
      .rejects.toThrow();
  });

  it("keeps updated_at current through the shared trigger", async () => {
    const db = await fresh(SCHEMA);
    const id = await account(db, "e@example.com");
    await db.query(
      `insert into user_plans (user_id, plan, source, updated_at)
       values ($1, 'pro', 'trial', now() - interval '3 days')`, [id]);
    const before = (await db.query<any>(`select updated_at from user_plans where user_id = $1`, [id])).rows[0].updated_at;
    await db.query(`update user_plans set note = 'extended' where user_id = $1`, [id]);
    const after = (await db.query<any>(`select updated_at from user_plans where user_id = $1`, [id])).rows[0].updated_at;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it("disappears with its account, and never the reverse", async () => {
    const db = await fresh(SCHEMA);
    const id = await account(db, "f@example.com");
    await db.query(`insert into user_plans (user_id, plan, source) values ($1, 'pro', 'grandfathered')`, [id]);
    await db.query(`delete from users where id = $1`, [id]);
    expect((await db.query(`select * from user_plans`)).rows).toEqual([]);
  });

  it("keeps a plan when the admin who granted it is deleted", async () => {
    const db = await fresh(SCHEMA);
    const holder = await account(db, "g@example.com");
    const granter = await account(db, "h@example.com");
    await db.query(
      `insert into user_plans (user_id, plan, source, granted_by) values ($1, 'pro', 'gifted', $2)`,
      [holder, granter]);
    await db.query(`delete from users where id = $1`, [granter]);
    const [row] = (await db.query<any>(`select plan, granted_by from user_plans where user_id = $1`, [holder])).rows;
    // The grant survives; only the attribution is lost. Revoking somebody's Pro
    // because an administrator left would be the wrong direction to fail.
    expect(row.plan).toBe("pro");
    expect(row.granted_by).toBeNull();
  });
});

describe("no billing anywhere near it", () => {
  it("has no provider, customer, subscription or price column", async () => {
    const db = await fresh(SCHEMA);
    const cols = (await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='user_plans'`)).rows.map((r) => r.column_name).sort();
    expect(cols).toEqual([
      "expires_at", "granted_at", "granted_by", "note", "plan", "source", "updated_at", "user_id",
    ]);
  });
});
