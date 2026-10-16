import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { migratePriorityDetails } from "../scripts/migrations/priority-details.mjs";

/**
 * The priority-details migration, run for real (PGlite). "Existing" is
 * db/schema.sql without its details block: the schema production runs today.
 * These prove the step only adds (two defaulted columns, one table, its
 * indexes), that every existing row comes through byte-identical, that it is
 * idempotent and equals a fresh install — and that the retention policy is
 * the schema itself: deleting a priority or an account cascades its
 * attachments' bytes away in the same statement.
 */

const FULL_SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const START = "-- ---- Priority details: description, links, attachments ----";
const END = "-- ---- end Priority details ----";
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
/* The two columns bring their CHECKs and (in Postgres 18's catalog) their
   NOT NULL constraints too; all of them are this migration's. */
const isNew = (l: string) =>
  /priority_attachments|col:priorities\.(description|links)|priorities\.priorities_(description|links)/.test(l);

let open: PGlite[] = [];
const fresh = async (schema: string) => { const db = await PGlite.create(); open.push(db); await db.exec(schema); return db; };
afterEach(async () => { for (const d of open) await d.close(); open = []; });

async function seed(db: PGlite) {
  await db.exec(`insert into users (email, username, password_hash) values ('a@example.com','ada','x'), ('b@example.com','bea','x');`);
  const [a, b] = (await db.query<any>("select id from users order by email")).rows.map((r) => r.id);
  const add = async (user: string, body: string) => (await db.query<any>(
    `insert into priorities (user_id, body, created_on, category) values ($1, $2, current_date, 'urgent_important') returning id`,
    [user, body])).rows[0].id as string;
  return { a, b, p1: await add(a, "Keep me"), p2: await add(a, "Delete me"), pb: await add(b, "Bea's line") };
}

const attach = (db: PGlite, user: string, priority: string, name = "note.txt") => db.query(
  `insert into priority_attachments (user_id, priority_id, original_filename, kind, mime_type, byte_size, sha256, content)
   values ($1, $2, $3, 'text', 'text/plain', 5, repeat('ab', 32), 'hello'::bytea)`,
  [user, priority, name]);

describe("the priority-details migration", () => {
  it("only adds, leaves every priority byte-identical, and is idempotent", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    const { } = await seed(db);
    const before = await structure(db);
    expect(before.some(isNew)).toBe(false);
    const rows = JSON.stringify((await db.query("select * from priorities order by id")).rows);

    const log: string[] = [];
    expect(await migratePriorityDetails(clientFor(db), (l) => log.push(l.trim()))).toBe(3);
    expect(log).toEqual(["added priorities.description", "added priorities.links", "created priority_attachments"]);

    const after = await structure(db);
    expect(after.filter((l) => !isNew(l))).toEqual(before);
    // The new columns carry their defaults; everything else is identical.
    const again = (await db.query<any>("select * from priorities order by id")).rows;
    expect(JSON.stringify(again.map(({ description, links, ...rest }) => rest))).toBe(rows);
    expect(again.every((r: any) => r.description === "" && Array.isArray(r.links) && r.links.length === 0)).toBe(true);

    expect(await migratePriorityDetails(clientFor(db), () => {})).toBe(0);
    expect(await structure(db)).toEqual(after);
  });

  it("produces exactly what a fresh install has", async () => {
    const migrated = await fresh(EXISTING_SCHEMA);
    await migratePriorityDetails(clientFor(migrated), () => {});
    const installed = await fresh(FULL_SCHEMA);
    expect(await structure(migrated)).toEqual(await structure(installed));
    expect(await migratePriorityDetails(clientFor(installed), () => {})).toBe(0);
  });

  it("does nothing on a database without priorities", async () => {
    const db = await PGlite.create();
    open.push(db);
    expect(await migratePriorityDetails(clientFor(db), () => {})).toBe(0);
  });

  it("retention is the schema: deleting the priority or the account takes the bytes with it", async () => {
    const db = await fresh(FULL_SCHEMA);
    const { a, b, p1, p2, pb } = await seed(db);
    await attach(db, a, p1); await attach(db, a, p2); await attach(db, b, pb);
    const count = async () => (await db.query<any>("select count(*)::int n from priority_attachments")).rows[0].n;
    expect(await count()).toBe(3);

    await db.query("delete from priorities where id = $1", [p2]);
    expect(await count()).toBe(2);

    await db.query("delete from users where id = $1", [b]);
    expect(await count()).toBe(1);
    // The survivor is untouched.
    const [left] = (await db.query<any>("select priority_id from priority_attachments")).rows;
    expect(left.priority_id).toBe(p1);
  });

  it("refuses the wrong shapes at the database, whatever the application does", async () => {
    const db = await fresh(FULL_SCHEMA);
    const { a, p1 } = await seed(db);
    // Links must be a list of at most ten.
    await expect(db.query(`update priorities set links = '{"not":"a list"}' where id = $1`, [p1])).rejects.toThrow();
    const eleven = JSON.stringify(Array.from({ length: 11 }, (_, i) => ({ url: `https://x/${i}`, label: "" })));
    await expect(db.query(`update priorities set links = $2::jsonb where id = $1`, [p1, eleven])).rejects.toThrow();
    // A size that does not match the bytes, an unknown type, an oversize claim.
    await expect(db.query(
      `insert into priority_attachments (user_id, priority_id, original_filename, kind, mime_type, byte_size, sha256, content)
       values ($1, $2, 'x', 'text', 'text/plain', 99, repeat('ab', 32), 'hello'::bytea)`, [a, p1])).rejects.toThrow();
    await expect(db.query(
      `insert into priority_attachments (user_id, priority_id, original_filename, kind, mime_type, byte_size, sha256, content)
       values ($1, $2, 'x', 'app', 'application/x-msdownload', 5, repeat('ab', 32), 'hello'::bytea)`, [a, p1])).rejects.toThrow();
  });
});
