import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  TOGETHER_V1A_STATEMENTS, TOGETHER_V1A_TABLES, TOGETHER_V1A_TRIGGER, migrateTogetherV1A,
} from "../scripts/migrations/together-v1a.mjs";

/**
 * Migration step 15 — Together V1A — run for real (PGlite).
 *
 * "Existing" is db/schema.sql without its Together V1A block: the schema
 * production runs today. These prove the step only adds (three tables, their
 * indexes, one function and one trigger), that every existing table and row
 * comes through unchanged, that it is idempotent, that it produces exactly what
 * a fresh install does, and that the one thing it attaches to an existing table
 * — the delete trigger on users — changes nothing for an account without
 * Together data.
 */

// Steps 16 and 17 build on these tables and have their own tests
// (together-v1b-migration, together-task-rank-migration); here the schema is
// taken as of step 15.
const FULL_SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const without = (schema: string, start: string, end: string) =>
  schema.slice(0, schema.indexOf(start)) + schema.slice(schema.indexOf(end) + end.length);
const SCHEMA = without(
  without(FULL_SCHEMA, "-- ---- Together: task ordering (rank) ----", "-- ---- end Together task ordering ----"),
  "-- ---- Together V1B: groups, tasks, assignees ----", "-- ---- end Together V1B ----");
const START = "-- ---- Together V1A: boards, membership, invitations ----";
const END = "-- ---- end Together V1A ----";
const EXISTING_SCHEMA = SCHEMA.slice(0, SCHEMA.indexOf(START)) + SCHEMA.slice(SCHEMA.indexOf(END) + END.length);

const clientFor = (db: PGlite) => ({
  async query(sql: string, params?: unknown[]) {
    return { rows: (await db.query(sql, params as any[])).rows as any[] };
  },
});

async function structure(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ line: string }>(`select line from (
      select 'col:'||table_name||'.'||column_name||':'||ordinal_position||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as line
        from information_schema.columns where table_schema = 'public'
      union all select 'idx:'||tablename||'.'||indexname||':'||indexdef from pg_indexes where schemaname = 'public'
      union all select 'con:'||conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid)
        from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> 0
      union all select 'trg:'||tgrelid::regclass::text||'.'||tgname||':'||pg_get_triggerdef(oid)
        from pg_trigger where not tgisinternal
      union all select 'fn:'||p.proname||':'||md5(p.prosrc)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    ) s order by line`);
  return rows.map((r) => r.line);
}
const isTogether = (line: string) => /together_/.test(line);

async function everyRow(db: PGlite): Promise<string> {
  const tables = (await db.query<{ t: string }>(
    `select table_name t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'
      and table_name not like 'together\\_%' order by 1`)).rows.map((r) => r.t);
  const out: Record<string, unknown[]> = {};
  for (const t of tables) out[t] = (await db.query(`select * from "${t}" order by 1`)).rows;
  return JSON.stringify(out);
}

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
  await db.query(`insert into profiles (id, first_name) values ($1,'Ada'), ($2,'Bea'), ($3,'Cy')`, ids);
  await db.query(`insert into user_preferences (user_id, theme, locale) values ($1,'dark','zh'), ($2,'light','both'), ($3,'light','en')`, ids);
  return ids as string[];
}

describe("the Together V1A migration", () => {
  it("only adds: three tables with their indexes, one function, one trigger", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    const before = await structure(db);
    expect(before.some(isTogether)).toBe(false);
    const log: string[] = [];
    expect(await migrateTogetherV1A(clientFor(db), (l) => log.push(l.trim()))).toBe(5);
    expect(log).toEqual([
      "created together_boards", "created together_members", "created together_invitations",
      "created together_before_user_delete()", "created trigger together_before_user_delete on users",
    ]);
    const after = await structure(db);
    // Everything that was there is still there, unchanged; everything new is Together's.
    expect(after.filter((l) => !isTogether(l))).toEqual(before);
    expect(after.filter(isTogether).length).toBeGreaterThan(0);
  });

  it("leaves every existing row in every existing table exactly as it was", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    const before = await everyRow(db);
    await migrateTogetherV1A(clientFor(db), () => {});
    expect(await everyRow(db)).toBe(before);
  });

  it("is idempotent", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    expect(await migrateTogetherV1A(clientFor(db), () => {})).toBe(5);
    const after = await structure(db);
    expect(await migrateTogetherV1A(clientFor(db), () => {})).toBe(0);
    expect(await structure(db)).toEqual(after);
  });

  it("produces exactly what a fresh install has", async () => {
    const migrated = await fresh(EXISTING_SCHEMA);
    await migrateTogetherV1A(clientFor(migrated), () => {});
    const installed = await fresh(SCHEMA);
    expect(await structure(migrated)).toEqual(await structure(installed));
    expect(await migrateTogetherV1A(clientFor(installed), () => {})).toBe(0);
  });

  it("does nothing on a database without users", async () => {
    const db = await PGlite.create();
    open.push(db);
    expect(await migrateTogetherV1A(clientFor(db), () => {})).toBe(0);
  });

  it("changes nothing about deleting an account that has no Together data", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    const [a, b] = await seed(db);
    await migrateTogetherV1A(clientFor(db), () => {});
    await db.query("delete from users where id = $1", [a]);
    await db.query("delete from users where id = any($1::uuid[])", [[b]]);
    expect((await db.query<any>("select count(*)::int n from users")).rows[0].n).toBe(1);
    expect((await db.query<any>("select count(*)::int n from profiles")).rows[0].n).toBe(1);
  });

  it("locks the departing account's memberships before reading what it owns (Gate A, af3888c)", () => {
    // Without this, a concurrent deletion that promotes this account to owner is
    // invisible to it, and the cascade deletes the new owner's row: a board with
    // members and no owner. Proven on real PostgreSQL by the Gate A suite; PGlite
    // has one connection, so this pins the statement order instead.
    const [functionDef] = TOGETHER_V1A_STATEMENTS.filter((s) => /create or replace function/.test(s));
    const body = functionDef.replace(/--.*$/gm, "");
    const squashed = body.replace(/\s+/g, " ");
    const lock = squashed.indexOf("perform 1 from together_members where user_id = old.id or added_by = old.id order by board_id, user_id for update;");
    expect(squashed.indexOf("perform 1 from together_invitations where invited_by = old.id or invitee_id = old.id or accepted_by = old.id order by id for update;")).toBeGreaterThan(lock);
    const owned = squashed.indexOf("for owned in");
    expect(lock).toBeGreaterThan(0);
    expect(owned).toBeGreaterThan(lock);
    // One lock order for every deletion: its own rows, and its owned boards, by board.
    expect(body).toMatch(/where user_id = old\.id and role = 'owner' order by board_id for update/);
    // …and the heir's row is locked too, so an heir being deleted meanwhile is skipped.
    expect(body).toMatch(/order by m\.joined_at, m\.user_id\s+limit 1\s+for update of m;/);
  });

  it("writes no data, and the trigger writes only Together's own tables", () => {
    const [functionDef] = TOGETHER_V1A_STATEMENTS.filter((s) => /create or replace function/.test(s));
    const ddl = TOGETHER_V1A_STATEMENTS.filter((s) => s !== functionDef).join("\n") + "\n" + TOGETHER_V1A_TRIGGER;
    for (const w of [/\bdrop\b/i, /\bdelete\b/i, /\btruncate\b/i, /\bupdate\b/i, /\binsert\b/i, /\balter\b/i]) {
      const clauses = /on\s+delete\s+(cascade|set\s+null)|before\s+delete\s+on\s+users/gi;
      expect(ddl.replace(/--.*$/gm, "").replace(clauses, ""), String(w)).not.toMatch(w);
    }
    const body = functionDef.replace(/--.*$/gm, "");
    expect(body).not.toMatch(/\b(drop|truncate|insert|alter)\b/i);
    for (const m of body.matchAll(/\b(delete\s+from|(?<!for\s)update)\s+(\w+)/gi)) {
      expect(m[2], m[0]).toMatch(/^together_(boards|members)$/);
    }
    expect(TOGETHER_V1A_TABLES).toEqual(["together_boards", "together_members", "together_invitations"]);
  });

  it("is wired into the runner after What's New, and mirrored in db/schema.sql", () => {
    const runner = fs.readFileSync(path.resolve(__dirname, "..", "scripts", "migrate.mjs"), "utf8");
    expect(runner).toContain("await migrateTogetherV1A(client, console.log)");
    expect(runner.indexOf("migrateTogetherV1A(client")).toBeGreaterThan(runner.indexOf("migrateWhatsNew(client"));
    const block = SCHEMA.slice(SCHEMA.indexOf(START), SCHEMA.indexOf(END));
    const squash = (s: string) => s.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim();
    for (const s of [...TOGETHER_V1A_STATEMENTS, TOGETHER_V1A_TRIGGER]) expect(squash(block)).toContain(squash(s));
  });
});
