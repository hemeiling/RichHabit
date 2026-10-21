import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  NOTIFICATIONS_STATEMENTS, NOTIFICATION_INDEXES, NOTIFICATION_TABLES, migrateNotifications,
} from "../scripts/migrations/notifications.mjs";

/**
 * The Unified Notifications migration (step 23), run for real (PGlite).
 * "Existing" is db/schema.sql without its step-23 block — the schema production
 * runs today. Proves the step only adds (three tables, one index on
 * together_task_assignees), that every existing row comes through byte-identical,
 * that it is idempotent, that it works inside one transaction as the runner
 * calls it, and that it equals a fresh install.
 */

const FULL_SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const START = "-- ---- Unified notifications (step 23) ----";
const END = "-- ---- end unified notifications ----";
const at = (marker: string) => {
  const i = FULL_SCHEMA.indexOf(marker);
  if (i < 0) throw new Error(`marker missing: ${marker}`);
  return i;
};
const EXISTING_SCHEMA = FULL_SCHEMA.slice(0, at(START)) + FULL_SCHEMA.slice(FULL_SCHEMA.indexOf("\n", at(END)) + 1);

const clientFor = (db: { query: PGlite["query"] }) => ({
  async query(sql: string, params?: unknown[]) { return { rows: (await db.query(sql, params as any[])).rows as any[] }; },
});

async function structure(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ line: string }>(`select line from (
      select 'col:'||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as line
        from information_schema.columns where table_schema = 'public'
      union all select 'idx:'||tablename||'.'||indexname||':'||indexdef from pg_indexes where schemaname = 'public'
      union all select 'con:'||conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid)
        from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> 0
    ) s order by line`);
  return rows.map((r) => r.line);
}
/** Every row of every pre-existing table, hashed — the step must not touch one. */
async function rowsHash(db: PGlite, tables: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of tables) {
    const { rows } = await db.query<{ h: string | null }>(`select md5(string_agg(md5(x::text), '' order by md5(x::text))) as h from ${t} x`);
    out[t] = rows[0].h ?? "";
  }
  return out;
}

let open: PGlite[] = [];
const fresh = async (schema: string) => { const db = await PGlite.create(); open.push(db); await db.exec(schema); return db; };
afterEach(async () => { for (const d of open) await d.close(); open = []; });

async function seed(db: PGlite) {
  await db.exec(`
    insert into users (email, username, password_hash, created_via) values ('a@example.com','ada','scrypt$aa$bb','self_signup');
    insert into users (email, username, password_hash, created_via) values ('b@example.com','bo','scrypt$aa$bb','self_signup');
    insert into habits (user_id, name, category, status, start_date) select id, 'Read', 'morning', 'active', '2026-09-01' from users where username = 'ada';
    insert into together_boards (name, created_by) select 'Headband', id from users where username = 'ada';
    insert into together_members (board_id, user_id, role, added_by) select b.id, u.id, 'owner', u.id from together_boards b, users u where u.username = 'ada';
    insert into together_members (board_id, user_id, role, added_by) select b.id, u.id, 'member', b.created_by from together_boards b, users u where u.username = 'bo';
    insert into together_tasks (board_id, title, stage, due_on, created_by) select id, 'Order fabric', 'todo', '2026-10-22', created_by from together_boards;
    insert into together_task_assignees (task_id, board_id, user_id) select t.id, t.board_id, u.id from together_tasks t, users u where u.username = 'bo';
    insert into important_dates (user_id, title, starts_on, ends_on) select id, 'Dentist', '2026-10-23', '2026-10-23' from users where username = 'ada';
    insert into priorities (user_id, body, category, created_on, planned_on) select id, 'Call bank', 'urgent_important', '2026-10-20', '2026-10-21' from users where username = 'ada';
  `);
}
const SEEDED = ["users", "habits", "together_boards", "together_members", "together_tasks", "together_task_assignees", "important_dates", "priorities"];

describe("migration step 23 — Unified Notifications", () => {
  it("adds exactly three tables and one index, leaves every existing row byte-identical, and equals a fresh install", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    const before = await structure(db);
    const rowsBefore = await rowsHash(db, SEEDED);
    const logged: string[] = [];
    expect(await migrateNotifications(clientFor(db), (l) => logged.push(l))).toBe(6);
    expect(logged).toEqual([...NOTIFICATION_TABLES.map((t) => `  created table ${t}`), ...NOTIFICATION_INDEXES.map((i) => `  created index ${i}`)]);
    const after = await structure(db);
    // Only additions: every line that existed is still there, unchanged.
    expect(before.filter((l) => !after.includes(l))).toEqual([]);
    const added = after.filter((l) => !before.includes(l));
    expect(added.every((l) => /notifications|notification_preferences|habit_reminders|together_task_assignees_user/.test(l))).toBe(true);
    expect(await rowsHash(db, SEEDED)).toEqual(rowsBefore);
    for (const t of NOTIFICATION_TABLES) expect((await db.query<{ n: number }>(`select count(*)::int n from ${t}`)).rows[0].n).toBe(0);
    // Same structure as a fresh install of the full schema.
    expect(after).toEqual(await structure(await fresh(FULL_SCHEMA)));
  });

  it("is idempotent, and runs inside one transaction as the runner calls it", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await db.transaction(async (tx) => {
      expect(await migrateNotifications(clientFor(tx as unknown as PGlite))).toBe(6);
      expect(await migrateNotifications(clientFor(tx as unknown as PGlite))).toBe(0);
    });
    expect(await migrateNotifications(clientFor(db))).toBe(0);
    // And on a fresh install it has nothing to do.
    expect(await migrateNotifications(clientFor(await fresh(FULL_SCHEMA)))).toBe(0);
  });

  it("refuses duplicates by key, never stores words, and cascades with the account and the space", async () => {
    const db = await fresh(FULL_SCHEMA);
    await seed(db);
    const { rows: [u] } = await db.query<{ id: string }>(`select id from users where username = 'bo'`);
    const { rows: [t] } = await db.query<{ id: string; board_id: string }>(`select id, board_id from together_tasks`);
    const insert = () => db.query(
      `insert into notifications (user_id, category, kind, source_type, source_id, board_id, dedupe_key, notify_at)
       values ($1, 'activity', 'task_assigned', 'together_task', $2, $3, $4, now()) on conflict (user_id, dedupe_key) do nothing`,
      [u.id, t.id, t.board_id, `assign:${t.id}`]);
    await insert(); await insert();
    expect((await db.query<{ n: number }>(`select count(*)::int n from notifications`)).rows[0].n).toBe(1);
    const cols = (await db.query<{ c: string }>(`select column_name c from information_schema.columns where table_name = 'notifications'`)).rows.map((r) => r.c);
    expect(cols.some((c) => /title|text|name|body/.test(c))).toBe(false);
    await expect(db.query(`insert into notification_preferences (user_id, important_date_lead) values ($1, 2)`, [u.id])).rejects.toThrow();
    await db.query(`delete from together_boards`);
    expect((await db.query<{ n: number }>(`select count(*)::int n from notifications`)).rows[0].n).toBe(0);
    expect(NOTIFICATIONS_STATEMENTS.every((s) => /^create (table|index) if not exists/.test(s))).toBe(true);
  });
});
