import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AI_WORKSPACE_TABLES, migrateAiWorkspace } from "../scripts/migrations/ai-workspace.mjs";

/**
 * Migration step 8, run for real against Postgres (PGlite, in process).
 *
 * "Existing" is db/schema.sql without its AI workspace section, which is the
 * schema main and production have today; the boundaries test proves nothing
 * before that section mentions an ai_ object. These tests prove the step only
 * adds, leaves every existing table's structure and rows exactly as they were,
 * is idempotent, produces the same structure as a fresh install, and that the
 * database enforces ownership, lineage, attachments, tombstones and disclosure.
 */

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const MARKER = "-- ---- AI workspace, admin only";
const EXISTING_SCHEMA = SCHEMA.slice(0, SCHEMA.indexOf(MARKER));

const clientFor = (db: PGlite) => ({
  async query(sql: string, params?: unknown[]) {
    const result = await db.query(sql, params as any[]);
    return { rows: result.rows as any[] };
  },
});

async function structure(db: PGlite, ai: boolean): Promise<string> {
  const match = ai ? "like" : "not like";
  const { rows } = await db.query<{ s: string }>(`select coalesce(string_agg(line, E'\\n' order by line), '') as s from (
      select 'col:'||table_name||'.'||column_name||':'||data_type||':'||udt_name||':'||is_nullable||':'||coalesce(column_default,'') as line
        from information_schema.columns where table_schema = 'public' and table_name ${match} 'ai\\_%'
      union all
      select 'con:'||conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid)||':'||condeferrable::text||':'||condeferred::text
        from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> 0
         and conrelid::regclass::text ${match} 'ai\\_%'
      union all
      select 'idx:'||tablename||'.'||indexname||':'||indexdef
        from pg_indexes where schemaname = 'public' and tablename ${match} 'ai\\_%'
      union all
      select 'trg:'||tgrelid::regclass::text||'.'||tgname
        from pg_trigger where not tgisinternal and tgrelid::regclass::text ${match} 'ai\\_%'
      union all
      select 'fn:'||proname||'('||pg_get_function_identity_arguments(oid)||')'
        from pg_proc where pronamespace = 'public'::regnamespace and not ${ai}
      union all
      select 'view:'||table_name from information_schema.views where table_schema = 'public' and not ${ai}
    ) s`);
  return rows[0].s;
}

async function existingRows(db: PGlite): Promise<Record<string, string>> {
  const { rows: tables } = await db.query<{ t: string }>(
    `select table_name as t from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' and table_name not like 'ai\\_%' order by 1`);
  const out: Record<string, string> = {};
  for (const { t } of tables) {
    const { rows } = await db.query<{ n: number; h: string }>(
      `select count(*)::int as n, coalesce(md5(string_agg(h, '' order by h)), '') as h
         from (select md5(x::text) as h from "${t}" x) s`);
    out[t] = `${rows[0].n}:${rows[0].h}`;
  }
  return out;
}

let migrated: PGlite;
let fresh: PGlite;
let firstRun = -1;
let secondRun = -1;
let freshRun = -1;
let existingStructureBefore = "";
let existingRowsBefore: Record<string, string> = {};
const logged: string[] = [];

beforeAll(async () => {
  migrated = await PGlite.create();
  await migrated.exec(EXISTING_SCHEMA);
  // Representative existing data that must survive untouched.
  await migrated.query(`insert into users (email, password_hash) values ('owner@example.com', 'hash')`);
  await migrated.query(`insert into feedback (body) values ('Existing feedback stays exactly as it is')`);
  existingStructureBefore = await structure(migrated, false);
  existingRowsBefore = await existingRows(migrated);
  firstRun = await migrateAiWorkspace(clientFor(migrated), (line) => logged.push(line));
  secondRun = await migrateAiWorkspace(clientFor(migrated));

  fresh = await PGlite.create();
  await fresh.exec(SCHEMA);
  freshRun = await migrateAiWorkspace(clientFor(fresh));
});

afterAll(async () => {
  await migrated.close();
  await fresh.close();
});

describe("migration step 8 on an existing database", () => {
  it("creates the seven tables on the first run", () => {
    expect(firstRun).toBe(7);
    expect(logged).toEqual(AI_WORKSPACE_TABLES.map((t) => `  created ${t}`));
  });

  it("changes nothing on the second run", () => {
    expect(secondRun).toBe(0);
  });

  it("leaves every existing table, constraint, index, trigger, function and view exactly as it was", async () => {
    expect(await structure(migrated, false)).toBe(existingStructureBefore);
  });

  it("leaves every existing row exactly as it was", async () => {
    expect(await existingRows(migrated)).toEqual(existingRowsBefore);
  });

  it("produces the same structure as a fresh install from db/schema.sql", async () => {
    expect(freshRun).toBe(0);
    const fromMigration = await structure(migrated, true);
    expect(fromMigration.length).toBeGreaterThan(0);
    expect(fromMigration).toBe(await structure(fresh, true));
  });

  it("does nothing on a database without users", async () => {
    const empty = await PGlite.create();
    expect(await migrateAiWorkspace(clientFor(empty))).toBe(0);
    await empty.close();
  });
});

describe("constraints enforced by the database", () => {
  const one = async (sql: string, params: unknown[] = []) => (await migrated.query<any>(sql, params as any[])).rows[0];
  const refused = async (sql: string, params: unknown[], code: string) => {
    let caught: any = null;
    try { await migrated.query(sql, params as any[]); } catch (e) { caught = e; }
    expect(caught, "expected the database to refuse").not.toBeNull();
    expect(caught.code).toBe(code);
  };
  const hex = (s: string) => Buffer.from(s);
  const sha = (c: string) => c.repeat(64);

  let u1: string; let u2: string; let p1: string; let c1: string; let c2: string; let cOther: string;
  let m1: string; let mOther: string; let r1: string; let k1: string;
  let f1: string; let f2: string; let f3: string; let fForeign: string;
  const insertFile = (user: string, home: "project" | "conversation", homeId: string, name: string, body: string, hash: string) =>
    one(`insert into ai_files (user_id, ${home}_id, original_filename, kind, mime_type, byte_size, sha256, content)
         values ($1, $2, $3, 'text', 'text/plain', $4, $5, $6) returning id`,
    [user, homeId, name, Buffer.byteLength(body), hash, hex(body)]).then((r) => r.id as string);
  const attach = "insert into ai_message_files (message_id, file_id, user_id, position) values ($1, $2, $3, $4)";
  const assistant = `insert into ai_messages (conversation_id, user_id, role, reply_kind, reply_to_message_id,
    continuation_of_message_id, retry_of_message_id, status) values ($1, $2, 'assistant', $3, $4, $5, $6, $7) returning id`;

  beforeAll(async () => {
    u1 = (await one(`insert into users (email, password_hash) values ('a1@example.com', 'x') returning id`)).id;
    u2 = (await one(`insert into users (email, password_hash) values ('a2@example.com', 'x') returning id`)).id;
    p1 = (await one(`insert into ai_projects (user_id, name) values ($1, 'RichHabit Product') returning id`, [u1])).id;
    c1 = (await one(`insert into ai_conversations (user_id, project_id) values ($1, $2) returning id`, [u1, p1])).id;
    c2 = (await one(`insert into ai_conversations (user_id) values ($1) returning id`, [u1])).id;
    cOther = (await one(`insert into ai_conversations (user_id) values ($1) returning id`, [u2])).id;
    m1 = (await one(`insert into ai_messages (conversation_id, user_id, role, content) values ($1, $2, 'user', 'hi') returning id`, [c1, u1])).id;
    mOther = (await one(`insert into ai_messages (conversation_id, user_id, role, content) values ($1, $2, 'user', 'x') returning id`, [c2, u1])).id;
    f1 = await insertFile(u1, "project", p1, "roadmap.md", "abc", sha("a"));
    f2 = await insertFile(u1, "conversation", c1, "brief.txt", "def", sha("d"));
    f3 = await insertFile(u1, "conversation", c1, "notes.txt", "ghi", sha("e"));
    fForeign = await insertFile(u2, "conversation", cOther, "theirs.txt", "jkl", sha("f"));
  });

  it("keeps a conversation, message and file with their owner", async () => {
    await refused(`insert into ai_conversations (user_id, project_id) values ($1, $2)`, [u2, p1], "23503");
    await refused(`insert into ai_messages (conversation_id, user_id, role) values ($1, $2, 'user')`, [c1, u2], "23503");
    await refused(`insert into ai_files (user_id, project_id, original_filename, kind, mime_type, byte_size, sha256, content)
      values ($1, $2, 'x.txt', 'text', 'text/plain', 3, $3, $4)`, [u2, p1, sha("b"), hex("abc")], "23503");
  });

  it("gives every assistant message exactly one lineage kind, inside one conversation", async () => {
    await refused(`insert into ai_messages (conversation_id, user_id, role, reply_kind, reply_to_message_id)
      values ($1, $2, 'user', 'reply', $3)`, [c1, u1, m1], "23514");
    await refused(assistant, [c1, u1, "reply", null, null, null, "streaming"], "23514");
    r1 = (await one(assistant, [c1, u1, "reply", m1, null, null, "stopped"])).id;
    await refused(assistant, [c1, u1, "reply", mOther, null, null, "complete"], "23503");
    await refused(assistant, [c1, u1, "continuation", m1, null, null, "streaming"], "23514");
    await refused(assistant, [c1, u1, "retry", m1, r1, r1, "streaming"], "23514");
  });

  it("allows each reply to be continued once and retried once", async () => {
    k1 = (await one(assistant, [c1, u1, "continuation", m1, r1, null, "stopped"])).id;
    await refused(assistant, [c1, u1, "continuation", m1, r1, null, "streaming"], "23505");
    await one(assistant, [c1, u1, "retry", m1, null, k1, "failed"]);
    await refused(assistant, [c1, u1, "retry", m1, null, k1, "streaming"], "23505");
    await refused(assistant, [c1, u1, "retry", m1, null, mOther, "streaming"], "23503");
  });

  it("refuses a repeated client id", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    await migrated.query(`insert into ai_messages (conversation_id, user_id, role, client_id) values ($1, $2, 'user', $3)`, [c1, u1, id]);
    await refused(`insert into ai_messages (conversation_id, user_id, role, client_id) values ($1, $2, 'user', $3)`, [c1, u1, id], "23505");
  });

  it("gives a file exactly one home, honest size, and no duplicate bytes in one place", async () => {
    await refused(`insert into ai_files (user_id, original_filename, kind, mime_type, byte_size, sha256, content)
      values ($1, 'x.txt', 'text', 'text/plain', 3, $2, $3)`, [u1, sha("c"), hex("abc")], "23514");
    await refused(`insert into ai_files (user_id, conversation_id, original_filename, kind, mime_type, byte_size, sha256, content)
      values ($1, $2, 'x.txt', 'text', 'text/plain', 9, $3, $4)`, [u1, c2, sha("c"), hex("abc")], "23514");
    await refused(`insert into ai_files (user_id, project_id, original_filename, kind, mime_type, byte_size, sha256, content)
      values ($1, $2, 'copy.md', 'text', 'text/plain', 3, $3, $4)`, [u1, p1, sha("a"), hex("abc")], "23505");
  });

  it("keeps attachments ordered, owned, unique and pointing at real rows", async () => {
    await migrated.query(attach, [m1, f3, u1, 2]);
    await migrated.query(attach, [m1, f1, u1, 0]);
    await migrated.query(attach, [m1, f2, u1, 1]);
    const { rows } = await migrated.query<{ n: string }>(
      `select f.original_filename as n from ai_message_files mf join ai_files f on f.id = mf.file_id
        where mf.message_id = $1 order by mf.position`, [m1]);
    expect(rows.map((r) => r.n)).toEqual(["roadmap.md", "brief.txt", "notes.txt"]);
    await refused(attach, [m1, fForeign, u1, 3], "23503");
    await refused(attach, [m1, fForeign, u2, 3], "23503");
    await refused(attach, [m1, "22222222-2222-4222-8222-222222222222", u1, 3], "23503");
    await refused(attach, ["33333333-3333-4333-8333-333333333333", f1, u1, 3], "23503");
    await refused(attach, [m1, f1, u1, 5], "23505");
    await refused(attach, [m1, f3, u1, 1], "23505");
  });

  it("tombstones a file without breaking the messages that carried it", async () => {
    await refused(`update ai_files set deleted_at = now() where id = $1`, [f1], "23514");
    await migrated.query(`update ai_files set deleted_at = now(), content = null where id = $1`, [f1]);
    const { rows } = await migrated.query<{ position: number; removed: boolean }>(
      `select mf.position, f.deleted_at is not null as removed from ai_message_files mf join ai_files f on f.id = mf.file_id
        where mf.message_id = $1 order by mf.position`, [m1]);
    expect(rows).toEqual([{ position: 0, removed: true }, { position: 1, removed: false }, { position: 2, removed: false }]);
    await refused(`delete from ai_files where id = $1`, [f2], "23503");
    const used = await one(`select coalesce(sum(byte_size), 0)::int as n from ai_files where user_id = $1 and deleted_at is null`, [u1]);
    expect(used.n).toBe(6);
  });

  it("records provider copies as rows, with an id whenever uploaded", async () => {
    await refused(`insert into ai_file_provider_copies (file_id, provider, status) values ($1, 'anthropic', 'uploaded')`, [f2], "23514");
    await migrated.query(`insert into ai_file_provider_copies (file_id, provider, status, provider_file_id, uploaded_at)
      values ($1, 'anthropic', 'uploaded', 'file_placeholder', now())`, [f2]);
    await migrated.query(`insert into ai_file_provider_copies (file_id, provider) values ($1, 'google')`, [f2]);
    expect((await one(`select count(*)::int as n from ai_file_provider_copies where file_id = $1`, [f2])).n).toBe(2);
  });

  it("stores disclosure acceptance as a version with its time", async () => {
    await refused(`insert into ai_workspace_settings (user_id, upload_disclosure_version) values ($1, 1)`, [u1], "23514");
    await migrated.query(`insert into ai_workspace_settings (user_id, upload_disclosure_version, upload_disclosure_accepted_at)
      values ($1, 1, now())`, [u1]);
    expect((await one(`select upload_disclosure_version as v from ai_workspace_settings where user_id = $1`, [u1])).v).toBe(1);
  });

  it("deletes a project permanently with everything in it, and nothing else", async () => {
    await migrated.query(`delete from ai_projects where id = $1`, [p1]);
    const left = await one(`select
        (select count(*) from ai_conversations where id = $1)::int as conversations,
        (select count(*) from ai_messages where conversation_id = $1)::int as messages,
        (select count(*) from ai_files where project_id = $2 or conversation_id = $1)::int as files,
        (select count(*) from ai_message_files where message_id = $3)::int as attachments,
        (select count(*) from ai_file_provider_copies where file_id = $4)::int as copies`, [c1, p1, m1, f2]);
    expect(left).toEqual({ conversations: 0, messages: 0, files: 0, attachments: 0, copies: 0 });
    expect((await one(`select count(*)::int as n from ai_conversations where id = $1`, [c2])).n).toBe(1);
    expect((await one(`select count(*)::int as n from ai_files where id = $1`, [fForeign])).n).toBe(1);
  });
});
