import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateTogetherInviteEmail } from "../scripts/migrations/together-invite-email.mjs";

/**
 * Migration step 18 — the index that finds open email invitations by address —
 * run for real (PGlite). "Existing" is db/schema.sql without its step 18
 * block: the schema production runs after step 17. These prove the step adds
 * exactly one index and nothing else, leaves every row untouched, is
 * idempotent, matches a fresh install, and does nothing before Together exists.
 */

const FULL_SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const START = "-- ---- Together: email invitations by address (step 18) ----";
const END = "-- ---- end Together email invitations by address ----";
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
      union all select 'trg:'||tgrelid::regclass::text||'.'||tgname||':'||pg_get_triggerdef(oid) from pg_trigger where not tgisinternal
      union all select 'fn:'||p.proname||':'||md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    ) s order by line`);
  return rows.map((r) => r.line);
}
const isNew = (l: string) => /together_invitations_email_open/.test(l);

let open: PGlite[] = [];
const fresh = async (schema: string) => { const db = await PGlite.create(); open.push(db); await db.exec(schema); return db; };
afterEach(async () => { for (const d of open) await d.close(); open = []; });

/** An account, a board, and one invitation of each kind. */
async function seed(db: PGlite) {
  await db.exec(`insert into users (email, username, password_hash) values ('a@example.com','ada','x'), ('b@example.com','bea','x');`);
  const [a, b] = (await db.query<any>("select id from users order by email")).rows.map((r) => r.id);
  const [{ id: board }] = (await db.query<any>(
    `insert into together_boards (name, created_by) values ('Headband', $1) returning id`, [a])).rows;
  await db.query(`insert into together_members (board_id, user_id, role, added_by) values ($1,$2,'owner',$2)`, [board, a]);
  await db.query(`insert into together_invitations (board_id, email_normalized, token_hash, invited_by, sent_at, expires_at)
    values ($1, 'c@example.com', 'hash', $2, now(), now() + interval '14 days')`, [board, a]);
  await db.query(`insert into together_invitations (board_id, invitee_id, invited_by, sent_at, expires_at)
    values ($1, $2, $3, now(), now() + interval '14 days')`, [board, b, a]);
}

async function everyRow(db: PGlite): Promise<string> {
  const tables = (await db.query<{ t: string }>(
    `select table_name t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`))
    .rows.map((r) => r.t);
  const out: Record<string, unknown[]> = {};
  for (const t of tables) out[t] = (await db.query(`select * from "${t}" order by 1`)).rows;
  return JSON.stringify(out);
}

describe("the Together email-invitation index migration (step 18)", () => {
  it("adds exactly one index and nothing else, leaving every row untouched", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    const before = await structure(db);
    const rows = await everyRow(db);
    expect(before.some(isNew)).toBe(false);
    const log: string[] = [];
    expect(await migrateTogetherInviteEmail(clientFor(db), (l) => log.push(l.trim()))).toBe(1);
    expect(log).toEqual(["created index together_invitations_email_open"]);
    const after = await structure(db);
    expect(after.filter((l) => !isNew(l))).toEqual(before);
    expect(after.filter(isNew)).toHaveLength(1);
    expect(await everyRow(db)).toBe(rows);
  });

  it("is idempotent", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    expect(await migrateTogetherInviteEmail(clientFor(db), () => {})).toBe(1);
    const after = await structure(db);
    expect(await migrateTogetherInviteEmail(clientFor(db), () => {})).toBe(0);
    expect(await structure(db)).toEqual(after);
  });

  it("produces exactly what a fresh install has", async () => {
    const migrated = await fresh(EXISTING_SCHEMA);
    await migrateTogetherInviteEmail(clientFor(migrated), () => {});
    const installed = await fresh(FULL_SCHEMA);
    expect(await structure(migrated)).toEqual(await structure(installed));
    expect(await migrateTogetherInviteEmail(clientFor(installed), () => {})).toBe(0);
  });

  it("does nothing on a database without Together", async () => {
    const db = await PGlite.create();
    open.push(db);
    expect(await migrateTogetherInviteEmail(clientFor(db), () => {})).toBe(0);
  });
});
