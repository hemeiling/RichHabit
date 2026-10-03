import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { WHATS_NEW_COLUMN, migrateWhatsNew } from "../scripts/migrations/whats-new.mjs";

/**
 * Migration step 14 — What's New's seen mark — run for real (PGlite).
 *
 * "Existing" is db/schema.sql without its What's New block: the schema
 * production runs today. Every account has a user_preferences row, so these
 * prove the step adds one nullable column and nothing else, that every existing
 * row comes through byte-for-byte, that it is idempotent, and that it produces
 * exactly what a fresh install does.
 */

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const START = "-- ---- What's New: a per-account seen mark ----";
const END = "-- ---- end What's New ----";
const EXISTING_SCHEMA = SCHEMA.slice(0, SCHEMA.indexOf(START)) + SCHEMA.slice(SCHEMA.indexOf(END) + END.length);

const clientFor = (db: PGlite) => ({
  async query(sql: string, params?: unknown[]) {
    return { rows: (await db.query(sql, params as any[])).rows as any[] };
  },
});

async function structure(db: PGlite, { withoutNew = false } = {}): Promise<string> {
  const { rows } = await db.query<{ s: string }>(`select coalesce(string_agg(line, E'\\n' order by line), '') as s from (
      select 'col:'||table_name||'.'||column_name||':'||ordinal_position||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as line
        from information_schema.columns where table_schema = 'public'
      union all select 'idx:'||tablename||'.'||indexname||':'||indexdef from pg_indexes where schemaname = 'public'
      union all select 'con:'||conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid)
        from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> 0
    ) s`);
  const lines = rows[0].s.split("\n");
  return (withoutNew ? lines.filter((l) => !l.startsWith("col:user_preferences.whats_new_seen_at:")) : lines).join("\n");
}
const PREFS = "user_id, theme, weighted_score, goal_weight, locale, week_starts_on, community_visible, updated_at";
const prefsRows = async (db: PGlite) =>
  JSON.stringify((await db.query(`select ${PREFS} from user_preferences order by user_id`)).rows);

let open: PGlite[] = [];
const fresh = async (schema: string) => {
  const db = await PGlite.create();
  open.push(db);
  await db.exec(schema);
  return db;
};
afterEach(async () => { for (const d of open) await d.close(); open = []; });

async function seed(db: PGlite) {
  await db.exec(`insert into users (email, username, password_hash) values
    ('a@example.com','ada','x'), ('b@example.com','bea','x'), ('c@example.com','cy','x');`);
  const ids = (await db.query<any>("select id from users order by email")).rows.map((r) => r.id);
  await db.query(`insert into user_preferences (user_id, theme, locale, goal_weight, community_visible) values
    ($1,'dark','zh',2.5,false), ($2,'light','both',null,true), ($3,'light','en',null,true)`, ids);
}

describe("the What's New migration", () => {
  it("adds one nullable column and nothing else moves", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    const before = await structure(db);
    expect(await migrateWhatsNew(clientFor(db), () => {})).toBe(1);
    expect(await structure(db, { withoutNew: true })).toBe(before);
    const { rows } = await db.query<any>(`select data_type, is_nullable, column_default from information_schema.columns
      where table_name = 'user_preferences' and column_name = 'whats_new_seen_at'`);
    expect(rows).toEqual([{ data_type: "timestamp with time zone", is_nullable: "YES", column_default: null }]);
  });

  it("leaves every existing preferences row exactly as it was, and reads null for all of them", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    const before = await prefsRows(db);
    await migrateWhatsNew(clientFor(db), () => {});
    expect(await prefsRows(db)).toBe(before);
    const { rows } = await db.query<any>("select count(*)::int n, count(whats_new_seen_at)::int marked from user_preferences");
    expect(rows[0]).toEqual({ n: 3, marked: 0 });
  });

  it("is idempotent", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    expect(await migrateWhatsNew(clientFor(db), () => {})).toBe(1);
    const after = await structure(db);
    expect(await migrateWhatsNew(clientFor(db), () => {})).toBe(0);
    expect(await structure(db)).toBe(after);
  });

  it("produces exactly what a fresh install has, column order included", async () => {
    const migrated = await fresh(EXISTING_SCHEMA);
    await migrateWhatsNew(clientFor(migrated), () => {});
    const installed = await fresh(SCHEMA);
    expect(await structure(migrated)).toBe(await structure(installed));
    expect(await migrateWhatsNew(clientFor(installed), () => {})).toBe(0);
  });

  it("does nothing on a database without user_preferences", async () => {
    const db = await PGlite.create();
    open.push(db);
    expect(await migrateWhatsNew(clientFor(db), () => {})).toBe(0);
  });

  it("contains no destructive or data-writing statement, and is wired into the runner", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "..", "scripts", "migrations", "whats-new.mjs"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const w of [/\bdrop\b/i, /\bdelete\b/i, /\btruncate\b/i, /\bupdate\b/i, /\binsert\b/i, /\bdefault\b/i]) {
      expect(src, String(w)).not.toMatch(w);
    }
    expect(WHATS_NEW_COLUMN).toEqual(["user_preferences", "whats_new_seen_at", "timestamptz"]);
    const runner = fs.readFileSync(path.resolve(__dirname, "..", "scripts", "migrate.mjs"), "utf8");
    expect(runner).toContain("await migrateWhatsNew(client, console.log)");
  });

  it("is never written by the general preferences save", () => {
    const queries = fs.readFileSync(path.resolve(__dirname, "..", "src", "lib", "db", "queries.ts"), "utf8");
    const save = queries.slice(queries.indexOf("export async function savePrefs"), queries.indexOf("export async function markWhatsNewSeen"));
    expect(save).not.toContain("whats_new_seen_at");
  });
});
