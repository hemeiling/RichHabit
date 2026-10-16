import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateTogetherConnections } from "../scripts/migrations/together-connections.mjs";

/**
 * Migration step 19 — global collaborators — run for real (PGlite). Proves
 * the step only adds its two tables, every existing row comes through
 * byte-identical, it is idempotent and equals a fresh install, that no
 * membership is converted into a connection, and that account deletion
 * cascades connections and requests away while boards stay governed by their
 * own rules.
 */

const FULL_SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const START = "-- ---- Together: global collaborators (step 19) ----";
const END = "-- ---- end Together global collaborators ----";
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
const isNew = (l: string) => /together_connection/.test(l);

let open: PGlite[] = [];
const fresh = async (schema: string) => { const db = await PGlite.create(); open.push(db); await db.exec(schema); return db; };
afterEach(async () => { for (const d of open) await d.close(); open = []; });

async function seed(db: PGlite) {
  await db.exec(`insert into users (email, username, password_hash) values
    ('a@example.com','ada','x'), ('b@example.com','bea','x'), ('c@example.com','cy','x');`);
  const [a, b, c] = (await db.query<any>("select id from users order by email")).rows.map((r) => r.id);
  const [{ id: board }] = (await db.query<any>(
    `insert into together_boards (name, created_by) values ('Headband', $1) returning id`, [a])).rows;
  await db.query(`insert into together_members (board_id, user_id, role, added_by)
    values ($1,$2,'owner',$2), ($1,$3,'member',$2)`, [board, a, b]);
  return { a, b, c, board };
}

describe("the Together connections migration", () => {
  it("only adds its two tables; every existing row is untouched; no membership becomes a connection", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    const before = await structure(db);
    const rows = JSON.stringify({
      members: (await db.query("select * from together_members order by user_id")).rows,
      boards: (await db.query("select * from together_boards order by id")).rows,
    });
    expect(before.some(isNew)).toBe(false);

    const log: string[] = [];
    expect(await migrateTogetherConnections(clientFor(db), (l) => log.push(l.trim()))).toBe(2);
    expect(log).toEqual(["created together_connections", "created together_connection_invitations"]);

    const after = await structure(db);
    expect(after.filter((l) => !isNew(l))).toEqual(before);
    expect(JSON.stringify({
      members: (await db.query("select * from together_members order by user_id")).rows,
      boards: (await db.query("select * from together_boards order by id")).rows,
    })).toBe(rows);
    // The two people who share a board are NOT connected by the migration.
    expect((await db.query<any>("select count(*)::int n from together_connections")).rows[0].n).toBe(0);

    expect(await migrateTogetherConnections(clientFor(db), () => {})).toBe(0);
    expect(await structure(db)).toEqual(after);
  });

  it("produces exactly what a fresh install has", async () => {
    const migrated = await fresh(EXISTING_SCHEMA);
    await migrateTogetherConnections(clientFor(migrated), () => {});
    const installed = await fresh(FULL_SCHEMA);
    expect(await structure(migrated)).toEqual(await structure(installed));
    expect(await migrateTogetherConnections(clientFor(installed), () => {})).toBe(0);
  });

  it("does nothing before Together exists", async () => {
    const db = await PGlite.create();
    open.push(db);
    expect(await migrateTogetherConnections(clientFor(db), () => {})).toBe(0);
  });

  it("deleting an account takes its connections and requests, and nothing of anyone else's", async () => {
    const db = await fresh(FULL_SCHEMA);
    const { a, b, c } = await seed(db);
    const pair = (x: string, y: string) => (x < y ? [x, y] : [y, x]);
    for (const [x, y] of [pair(a, b), pair(b, c)]) {
      await db.query("insert into together_connections (user_low, user_high) values ($1, $2)", [x, y]);
    }
    await db.query(`insert into together_connection_invitations (invited_by, invitee_id, sent_at, expires_at)
      values ($1, $2, now(), now() + interval '14 days')`, [a, c]);
    await db.query("delete from users where id = $1", [b]);
    const left = (await db.query<any>("select user_low, user_high from together_connections")).rows;
    expect(left).toHaveLength(0);   // both of b's connections went with b
    // a's request to c is a's and c's; it survives b entirely.
    expect((await db.query<any>("select count(*)::int n from together_connection_invitations")).rows[0].n).toBe(1);
  });

  it("the database refuses a self-connection and a duplicated pair", async () => {
    const db = await fresh(FULL_SCHEMA);
    const { a, b } = await seed(db);
    const [low, high] = a < b ? [a, b] : [b, a];
    await expect(db.query("insert into together_connections (user_low, user_high) values ($1, $1)", [a]))
      .rejects.toThrow();
    await expect(db.query("insert into together_connections (user_low, user_high) values ($1, $2)", [high, low]))
      .rejects.toThrow();   // wrong order violates the low < high CHECK
    await db.query("insert into together_connections (user_low, user_high) values ($1, $2)", [low, high]);
    await expect(db.query("insert into together_connections (user_low, user_high) values ($1, $2)", [low, high]))
      .rejects.toThrow();   // once
  });
});
