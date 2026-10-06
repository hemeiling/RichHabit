import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  TOGETHER_RANK_BACKFILL, TOGETHER_RANK_STATEMENTS, migrateTogetherTaskRank,
} from "../scripts/migrations/together-task-rank.mjs";

/**
 * Migration step 17 — task ordering (`together_tasks.rank`) — run for real
 * (PGlite). "Existing" is db/schema.sql without its rank block: the schema
 * production runs after V1B. These prove the step adds one column and one
 * index only; that its backfill reproduces today's order (`moved_at desc,
 * id desc`) within every list, deleted tasks included; that it writes `rank` and
 * nothing else; that it is idempotent; and that it matches a fresh install.
 */

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const START = "-- ---- Together: task ordering (rank) ----";
const END = "-- ---- end Together task ordering ----";
const EXISTING_SCHEMA = SCHEMA.slice(0, SCHEMA.indexOf(START)) + SCHEMA.slice(SCHEMA.indexOf(END) + END.length);

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
const isRank = (l: string) => /together_tasks\.rank|together_tasks_rank/.test(l);

let open: PGlite[] = [];
const fresh = async (schema: string) => { const db = await PGlite.create(); open.push(db); await db.exec(schema); return db; };
afterEach(async () => { for (const d of open) await d.close(); open = []; });

/** Accounts, a space, and V1B tasks in several lists — some deleted — with distinct and tied moved_at. */
async function seed(db: PGlite) {
  await db.exec(`insert into users (email, username, password_hash) values ('a@example.com','ada','x'), ('b@example.com','bea','x');`);
  const [a, b] = (await db.query<any>("select id from users order by email")).rows.map((r) => r.id);
  const [{ id: board }] = (await db.query<any>(`insert into together_boards (name, created_by) values ('Headband', $1) returning id`, [a])).rows;
  await db.query(`insert into together_members (board_id, user_id, role, added_by) values ($1,$2,'owner',$2), ($1,$3,'member',$2)`, [board, a, b]);
  const [{ id: other }] = (await db.query<any>(`insert into together_boards (name, created_by) values ('Other', $1) returning id`, [b])).rows;
  const add = async (space: string, stage: string, title: string, minutesAgo: number, deleted = false) => (await db.query<any>(
    `insert into together_tasks (board_id, title, stage, moved_at, created_by, deleted_at)
     values ($1, $2, $3, now() - make_interval(mins => $4), $5, ${deleted ? "now()" : "null"}) returning id`,
    [space, title, stage, minutesAgo, a])).rows[0].id as string;
  await add(board, "todo", "t1", 30); await add(board, "todo", "t2", 10); await add(board, "todo", "t3", 20, true);
  await add(board, "todo", "tie-a", 5); await add(board, "todo", "tie-b", 5);
  await add(board, "backlog", "b1", 3); await add(board, "backlog", "b2", 7);
  await add(board, "done", "d1", 60 * 30); await add(board, "doing", "x1", 1);
  await add(other, "todo", "o1", 1); await add(other, "todo", "o2", 2);
  return { board, other };
}

describe("migration step 17: task ordering", () => {
  it("only adds one column and one index", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    const before = await structure(db);
    const log: string[] = [];
    expect(await migrateTogetherTaskRank(clientFor(db), (l) => log.push(l.trim()))).toBe(3);
    expect(log).toEqual(["added together_tasks.rank", "created index together_tasks_rank", "ranked 11 existing task(s) in their current order"]);
    const after = await structure(db);
    expect(after.filter((l) => !isRank(l))).toEqual(before);
    expect(after.filter(isRank)).toEqual([
      "col:together_tasks.rank:17:bigint:YES:",
      "idx:together_tasks.together_tasks_rank:CREATE INDEX together_tasks_rank ON public.together_tasks USING btree (board_id, stage, rank, id) WHERE (deleted_at IS NULL)",
    ]);
  });

  it("ranks every list in exactly today's order — deleted tasks included — 1024 apart", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    const { board, other } = await seed(db);
    const order = async (space: string, stage: string, by: string) => (await db.query<any>(
      `select title from together_tasks where board_id = $1 and stage = $2 order by ${by}`, [space, stage])).rows.map((r) => r.title);
    const today: Record<string, string[]> = {};
    for (const [s, st] of [[board, "todo"], [board, "backlog"], [board, "done"], [board, "doing"], [other, "todo"]]) {
      today[`${s}:${st}`] = await order(s, st, "moved_at desc, id desc");
    }
    await migrateTogetherTaskRank(clientFor(db), () => {});
    for (const [key, titles] of Object.entries(today)) {
      const [s, st] = key.split(":");
      expect(await order(s, st, "rank asc, id desc"), key).toEqual(titles);
      const ranks = (await db.query<any>(`select rank from together_tasks where board_id = $1 and stage = $2 order by rank`, [s, st])).rows.map((r) => Number(r.rank));
      expect(ranks.slice(1).map((r, i) => r - ranks[i]), key).toEqual(ranks.slice(1).map(() => 1024));
    }
  });

  it("writes rank and nothing else — no other column of any row changes", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    await seed(db);
    const every = async () => {
      const tables = (await db.query<any>(`select table_name t from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`)).rows.map((r) => r.t);
      const out: Record<string, unknown> = {};
      for (const t of tables) {
        const cols = (await db.query<any>(`select column_name c from information_schema.columns where table_schema='public' and table_name=$1 and column_name <> 'rank' order by ordinal_position`, [t])).rows.map((r) => `"${r.c}"`);
        out[t] = (await db.query(`select ${cols.join(", ")} from "${t}" order by 1`)).rows;
      }
      return JSON.stringify(out);
    };
    const before = await every();
    await migrateTogetherTaskRank(clientFor(db), () => {});
    expect(await every()).toBe(before);
  });

  it("is idempotent, and never re-ranks a task that already has a rank", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    const { board } = await seed(db);
    expect(await migrateTogetherTaskRank(clientFor(db), () => {})).toBe(3);
    await db.query(`update together_tasks set rank = 5 where board_id = $1 and title = 't1'`, [board]);
    const after = await structure(db);
    const ranks = JSON.stringify((await db.query(`select id, rank from together_tasks order by id`)).rows);
    expect(await migrateTogetherTaskRank(clientFor(db), () => {})).toBe(0);
    expect(await structure(db)).toEqual(after);
    expect(JSON.stringify((await db.query(`select id, rank from together_tasks order by id`)).rows)).toBe(ranks);
  });

  it("ranks a task written later by older code (rank null) on the next run — only that one, and on top", async () => {
    const db = await fresh(EXISTING_SCHEMA);
    const { board } = await seed(db);
    await migrateTogetherTaskRank(clientFor(db), () => {});
    // Server placements push the top below zero; a late task must still land above everything.
    await db.query(`update together_tasks set rank = rank - 100000 where board_id = $1 and stage = 'todo' and title = 'tie-b'`, [board]);
    await db.query(`insert into together_tasks (board_id, title, stage) values ($1, 'late', 'todo')`, [board]);
    const log: string[] = [];
    expect(await migrateTogetherTaskRank(clientFor(db), (l) => log.push(l.trim()))).toBe(1);
    expect(log).toEqual(["ranked 1 existing task(s) in their current order"]);
    const first = (await db.query<any>(`select title from together_tasks where board_id = $1 and stage = 'todo' order by rank limit 1`, [board])).rows[0].title;
    expect(first).toBe("late");
  });

  it("produces exactly what a fresh install has", async () => {
    const migrated = await fresh(EXISTING_SCHEMA);
    await migrateTogetherTaskRank(clientFor(migrated), () => {});
    const installed = await fresh(SCHEMA);
    expect(await structure(migrated)).toEqual(await structure(installed));
    expect(await migrateTogetherTaskRank(clientFor(installed), () => {})).toBe(0);
  });

  it("is DDL plus one update of rank only, and is wired after step 16", () => {
    const ddl = TOGETHER_RANK_STATEMENTS.join("\n");
    for (const w of [/\bdrop\b/i, /\bdelete\b/i, /\btruncate\b/i, /\brename\b/i, /\binsert\b/i]) expect(ddl + TOGETHER_RANK_BACKFILL).not.toMatch(w);
    expect(TOGETHER_RANK_BACKFILL).toMatch(/^update together_tasks t set rank = b\.base - r\.n \* 1024\b/);
    expect(TOGETHER_RANK_BACKFILL).toMatch(/and t\.rank is null$/);
    const runner = fs.readFileSync(path.resolve(__dirname, "..", "scripts", "migrate.mjs"), "utf8");
    expect(runner.indexOf("migrateTogetherTaskRank(client")).toBeGreaterThan(runner.indexOf("migrateTogetherV1B(client"));
    const block = SCHEMA.slice(SCHEMA.indexOf(START), SCHEMA.indexOf(END));
    const squash = (s: string) => s.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim();
    for (const s of TOGETHER_RANK_STATEMENTS) expect(squash(block)).toContain(squash(s));
  });
});
