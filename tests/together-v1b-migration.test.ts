import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  TOGETHER_V1B_STATEMENTS, TOGETHER_V1B_TABLES, migrateTogetherV1B,
} from "../scripts/migrations/together-v1b.mjs";

/**
 * Migration step 16 — Together V1B — run for real (PGlite).
 *
 * "Existing" is db/schema.sql without its Together V1B block: the schema
 * production runs today (V1A included, with data in it). These prove the step
 * only adds three tables and their indexes; that every existing table — V1A's
 * three included — and every existing row comes through unchanged; that it is
 * idempotent and matches a fresh install; and that the database itself keeps a
 * space's work inside that space.
 */

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const START = "-- ---- Together V1B: groups, tasks, assignees ----";
const END = "-- ---- end Together V1B ----";
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
const isV1B = (line: string) => /together_(groups|tasks|task_assignees)/.test(line);

async function everyRow(db: PGlite): Promise<string> {
  const tables = (await db.query<{ t: string }>(
    `select table_name t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'
      order by 1`)).rows.map((r) => r.t).filter((t) => !TOGETHER_V1B_TABLES.includes(t));
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

/** Accounts, and a V1A space with an owner, a member and an accepted invitation — production's shape. */
async function seed(db: PGlite) {
  await db.exec(`insert into users (email, username, password_hash) values
    ('a@example.com','ada','x'), ('b@example.com','bea','x'), ('c@example.com','cy','x');`);
  const ids = (await db.query<any>("select id from users order by email")).rows.map((r) => r.id) as string[];
  await db.query(`insert into profiles (id, first_name) values ($1,'Ada'), ($2,'Bea'), ($3,'Cy')`, ids);
  const [{ id: board }] = (await db.query<any>(
    `insert into together_boards (name, created_by) values ('Headband', $1) returning id`, [ids[0]])).rows;
  await db.query(`insert into together_members (board_id, user_id, role, added_by) values
    ($1, $2, 'owner', $2), ($1, $3, 'member', $2)`, [board, ids[0], ids[1]]);
  await db.query(`insert into together_invitations (board_id, email_normalized, token_hash, invited_by, sent_at, expires_at, accepted_at, accepted_by)
    values ($1, 'b@example.com', 'h', $2, now(), now() + interval '14 days', now(), $3)`, [board, ids[0], ids[1]]);
  return { ids, board: board as string };
}

describe("the Together V1B migration", () => {
  it("only adds: three tables and their indexes, after V1A", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    const before = await structure(db);
    expect(before.some(isV1B)).toBe(false);
    const log: string[] = [];
    expect(await migrateTogetherV1B(clientFor(db), (l) => log.push(l.trim()))).toBe(3);
    expect(log).toEqual(["created together_groups", "created together_tasks", "created together_task_assignees"]);
    const after = await structure(db);
    // Everything that was there — V1A's tables, function and trigger included — is unchanged.
    expect(after.filter((l) => !isV1B(l))).toEqual(before);
    expect(after.filter(isV1B).length).toBeGreaterThan(0);
  });

  it("leaves every existing row in every existing table — V1A's included — exactly as it was", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    const before = await everyRow(db);
    await migrateTogetherV1B(clientFor(db), () => {});
    expect(await everyRow(db)).toBe(before);
    for (const t of TOGETHER_V1B_TABLES) {
      expect((await db.query<any>(`select count(*)::int n from ${t}`)).rows[0].n, t).toBe(0);
    }
  });

  it("is idempotent", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    expect(await migrateTogetherV1B(clientFor(db), () => {})).toBe(3);
    const after = await structure(db);
    expect(await migrateTogetherV1B(clientFor(db), () => {})).toBe(0);
    expect(await structure(db)).toEqual(after);
  });

  it("produces exactly what a fresh install has", async () => {
    const migrated = await fresh(EXISTING_SCHEMA);
    await migrateTogetherV1B(clientFor(migrated), () => {});
    const installed = await fresh(SCHEMA);
    expect(await structure(migrated)).toEqual(await structure(installed));
    expect(await migrateTogetherV1B(clientFor(installed), () => {})).toBe(0);
  });

  it("does nothing on a database without Together V1A", async () => {
    const db = await PGlite.create();
    open.push(db);
    await db.exec("create table users (id uuid primary key)");
    expect(await migrateTogetherV1B(clientFor(db), () => {})).toBe(0);
  });

  it("is DDL only: no drop, alter, delete, update, insert or truncate", () => {
    const ddl = TOGETHER_V1B_STATEMENTS.join("\n").replace(/on\s+delete\s+(cascade|set\s+null(\s*\(\w+\))?)/gi, "");
    for (const w of [/\bdrop\b/i, /\balter\b/i, /\bdelete\b/i, /\bupdate\b/i, /\binsert\b/i, /\btruncate\b/i]) {
      expect(ddl, String(w)).not.toMatch(w);
    }
    for (const s of TOGETHER_V1B_STATEMENTS) expect(s).toMatch(/^create (unique )?(table|index) if not exists /);
  });

  it("is wired into the runner after V1A, and mirrored in db/schema.sql", () => {
    const runner = fs.readFileSync(path.resolve(__dirname, "..", "scripts", "migrate.mjs"), "utf8");
    expect(runner).toContain("await migrateTogetherV1B(client, console.log)");
    expect(runner.indexOf("migrateTogetherV1B(client")).toBeGreaterThan(runner.indexOf("migrateTogetherV1A(client"));
    const block = SCHEMA.slice(SCHEMA.indexOf(START), SCHEMA.indexOf(END));
    const squash = (s: string) => s.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim();
    for (const s of TOGETHER_V1B_STATEMENTS) expect(squash(block)).toContain(squash(s));
    expect(SCHEMA.indexOf(START)).toBeGreaterThan(SCHEMA.indexOf("-- ---- end Together V1A ----"));
  });
});

describe("what the database itself guarantees", () => {
  async function space() {
    const db = await fresh(SCHEMA);
    const { ids, board } = await seed(db);
    const [{ id: other }] = (await db.query<any>(
      `insert into together_boards (name, created_by) values ('Other', $1) returning id`, [ids[2]])).rows;
    await db.query(`insert into together_members (board_id, user_id, role, added_by) values ($1, $2, 'owner', $2)`, [other, ids[2]]);
    const q = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p as any[])).rows;
    const task = async (b = board, extra = "") => (await q(
      `insert into together_tasks (board_id, title, stage, created_by${extra ? ", group_id" : ""})
       values ($1, 'Request supplier quotes', 'todo', $2${extra ? ", $3" : ""}) returning id`,
      extra ? [b, ids[0], extra] : [b, ids[0]]))[0].id as string;
    return { db, q, ids, board, other, task };
  }
  const fails = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };

  it("keeps a task's group inside the task's space", async () => {
    const { q, board, other, task } = await space();
    const [{ id: theirs }] = await q(`insert into together_groups (board_id, name) values ($1, 'Sourcing') returning id`, [other]);
    expect(await fails(task(board, theirs))).toBe(true);
    const [{ id: ours }] = await q(`insert into together_groups (board_id, name) values ($1, 'Sourcing') returning id`, [board]);
    expect(await fails(task(board, ours))).toBe(false);
  });

  it("allows an assignee only if they are a member of the task's own space", async () => {
    const { q, ids, board, task } = await space();
    const t = await task();
    // ids[2] is a member of the other space only.
    expect(await fails(q(`insert into together_task_assignees (task_id, board_id, user_id) values ($1, $2, $3)`, [t, board, ids[2]]))).toBe(true);
    expect(await fails(q(`insert into together_task_assignees (task_id, board_id, user_id) values ($1, $2, $3)`, [t, board, ids[1]]))).toBe(false);
  });

  it("clears assignments when a member leaves, and keeps the task", async () => {
    const { q, ids, board, task } = await space();
    const t = await task();
    await q(`insert into together_task_assignees (task_id, board_id, user_id) values ($1, $2, $3), ($1, $2, $4)`, [t, board, ids[0], ids[1]]);
    await q(`delete from together_members where board_id = $1 and user_id = $2`, [board, ids[1]]);
    expect((await q(`select user_id from together_task_assignees where task_id = $1`, [t])).map((r) => r.user_id)).toEqual([ids[0]]);
    expect((await q(`select count(*)::int n from together_tasks where id = $1`, [t]))[0].n).toBe(1);
  });

  it("keeps shared work when its creator's account is deleted, and forgets only the person", async () => {
    const { q, ids, board, task } = await space();
    const t = await task();
    await q(`update together_tasks set updated_by = $2, deleted_by = $2 where id = $1`, [t, ids[0]]);
    await q(`insert into together_groups (board_id, name, created_by) values ($1, 'Product', $2)`, [board, ids[0]]);
    await q(`insert into together_task_assignees (task_id, board_id, user_id) values ($1, $2, $3), ($1, $2, $4)`, [t, board, ids[0], ids[1]]);
    // ids[0] owns the space; the V1A trigger hands it to ids[1], and the work stays.
    await q(`delete from users where id = $1`, [ids[0]]);
    const [row] = await q(`select board_id, created_by, updated_by, deleted_by from together_tasks where id = $1`, [t]);
    expect(row).toEqual({ board_id: board, created_by: null, updated_by: null, deleted_by: null });
    expect((await q(`select user_id from together_task_assignees where task_id = $1`, [t])).map((r) => r.user_id)).toEqual([ids[1]]);
    expect((await q(`select created_by from together_groups where board_id = $1`, [board]))[0].created_by).toBeNull();
    expect((await q(`select user_id from together_members where board_id = $1 and role = 'owner'`, [board]))[0].user_id).toBe(ids[1]);
  });

  it("deletes a space's work only with the space itself", async () => {
    const { q, ids, board, task } = await space();
    await task();
    // The last member goes: V1A deletes the space, and its work goes with it.
    await q(`delete from users where id = any($1::uuid[])`, [[ids[0], ids[1]]]);
    expect((await q(`select count(*)::int n from together_boards where id = $1`, [board]))[0].n).toBe(0);
    expect((await q(`select count(*)::int n from together_tasks where board_id = $1`, [board]))[0].n).toBe(0);
  });

  it("deleting a group keeps its tasks and clears their group", async () => {
    const { q, board, task } = await space();
    const [{ id: g }] = await q(`insert into together_groups (board_id, name) values ($1, 'Sourcing') returning id`, [board]);
    const t = await task(board, g);
    await q(`delete from together_groups where id = $1`, [g]);
    expect((await q(`select board_id, group_id from together_tasks where id = $1`, [t]))[0]).toEqual({ board_id: board, group_id: null });
  });

  it("refuses a second group with the same name in a space, ignoring case — and allows it in another", async () => {
    const { q, board, other } = await space();
    await q(`insert into together_groups (board_id, name) values ($1, 'Sourcing')`, [board]);
    expect(await fails(q(`insert into together_groups (board_id, name) values ($1, 'sourcing')`, [board]))).toBe(true);
    expect(await fails(q(`insert into together_groups (board_id, name) values ($1, 'sourcing')`, [other]))).toBe(false);
  });

  it("accepts only the five stages, a 1–99 effort and a sane date", async () => {
    const { q, board } = await space();
    const ins = (cols: string, vals: unknown[]) =>
      q(`insert into together_tasks (board_id, title, stage${cols}) values ($1, 'x', ${vals.map((_, i) => `$${i + 2}`).join(", ")})`, [board, ...vals]);
    expect(await fails(ins("", ["later"]))).toBe(true);
    for (const s of ["backlog", "todo", "doing", "waiting", "done"]) expect(await fails(ins("", [s])), s).toBe(false);
    expect(await fails(ins(", effort", ["todo", 0]))).toBe(true);
    expect(await fails(ins(", effort", ["todo", 100]))).toBe(true);
    expect(await fails(ins(", effort", ["todo", 13]))).toBe(false);
    expect(await fails(ins(", due_on", ["todo", "1999-12-31"]))).toBe(true);
    expect(await fails(ins(", due_on", ["todo", "2026-10-09"]))).toBe(false);
    expect(await fails(q(`insert into together_tasks (board_id, title, stage) values ($1, '   ', 'todo')`, [board]))).toBe(true);
  });
});
