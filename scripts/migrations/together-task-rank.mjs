/**
 * ---- 17. Together: task ordering (rank) ------------------------------------
 *
 * One nullable column, one index, and a one-time backfill of that column only.
 * Nothing that exists is dropped, renamed or rewritten: no V1A table, function
 * or trigger is touched, and no other column of any row changes.
 *
 *   together_tasks.rank   the task's place within its list — one space's
 *                         Backlog or one of its four board stages. Sparse
 *                         integers, 1024 apart, assigned only by the server
 *                         (src/lib/together/work.ts) under a per-list lock: a
 *                         drop between two tasks takes the midpoint, and when
 *                         no integer is left between them that one list is
 *                         renumbered. Lists order by `rank asc nulls first,
 *                         moved_at desc, id desc`. Null only for a task written
 *                         by code older than this step; it sorts first ("new on
 *                         top", as before) and the next renumber of its list
 *                         gives it a rank.
 *
 * `moved_at` keeps its meaning — when the task entered its current stage —
 * and remains what Done's 24 hours and History are measured from.
 *
 * The backfill gives every task without a rank one, 1024 apart, above the
 * list's current top (below its smallest rank, or 0), in today's order (`moved_at
 * desc, id desc`) — deleted tasks included so a restore returns them to their
 * place. On the first run that is every task; on a later run only tasks written
 * meanwhile by older code, which therefore stay "new on top". It writes `rank`
 * only (no updated_at) and only where rank is null, so a second run changes
 * nothing.
 *
 * db/schema.sql carries the same statements for fresh installs;
 * tests/together-task-rank-migration.test.ts proves both match.
 */

export const TOGETHER_RANK_STATEMENTS = [
  `alter table together_tasks add column if not exists rank bigint`,
  `create index if not exists together_tasks_rank
  on together_tasks (board_id, stage, rank, id) where deleted_at is null`,
];

export const TOGETHER_RANK_BACKFILL = `update together_tasks t set rank = b.base - r.n * 1024
  from (select id, board_id, stage, row_number() over (partition by board_id, stage order by moved_at asc, id asc) as n
          from together_tasks where rank is null) r
  join (select board_id, stage, coalesce(min(rank), 0) as base from together_tasks group by board_id, stage) b
    on b.board_id = r.board_id and b.stage = r.stage
 where t.id = r.id and t.rank is null`;

async function columnExists(client) {
  const { rows } = await client.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'together_tasks' and column_name = 'rank'`);
  return rows.length > 0;
}

async function tableExists(client, table) {
  const { rows } = await client.query(
    `select 1 from information_schema.tables where table_schema = 'public' and table_name = $1`, [table]);
  return rows.length > 0;
}

/** Runs after step 16, which it depends on. */
export async function migrateTogetherTaskRank(client, log = () => {}) {
  if (!(await tableExists(client, "together_tasks"))) return 0;
  let changed = 0;
  if (!(await columnExists(client))) { log("  added together_tasks.rank"); changed++; }
  const { rows: idx } = await client.query(
    `select 1 from pg_indexes where schemaname = 'public' and indexname = 'together_tasks_rank'`);
  for (const statement of TOGETHER_RANK_STATEMENTS) await client.query(statement);
  if (!idx.length) { log("  created index together_tasks_rank"); changed++; }
  const result = await client.query(`${TOGETHER_RANK_BACKFILL} returning t.id`);
  const n = result.rows.length;
  if (n) { log(`  ranked ${n} existing task(s) in their current order`); changed++; }
  return changed;
}
