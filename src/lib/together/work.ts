import { query } from "@/lib/db/pool";
import { isUuid } from "@/lib/http";
import { DISPLAY_NAME, TogetherError, mayInvite, requireBoard, type BoardRole, type PersonView } from "@/lib/together/access";
import { isDueDate } from "@/lib/together/due";
import { EFFORT_CHOICES, isStage, type Stage } from "@/lib/together/stages";
import { togetherTransaction as transaction } from "@/lib/together/tx";

/**
 * Together — a space's shared work: the Board ("we will"), the Backlog ("we
 * might") and History ("we did").
 *
 * ## The model
 *
 * A task lives in one stage: `backlog`, or one of the board's four fixed
 * stages. `moved_at` is when it entered that stage — set only when the stage
 * changes, never by an edit or a reorder within the stage.
 *
 * **Lists and order.** Each of a space's five stages is a list. Within a list the
 * order is `rank asc nulls first, moved_at desc, id desc`. `rank` is a sparse
 * integer (1024 apart) assigned only here, inside that list's lock: the client
 * says what it means — top, bottom, up, down, or before/after a task it sees —
 * and never a number. A drop between two tasks takes the midpoint of their
 * ranks; when no integer is left between them, that one list is renumbered
 * (every row of it, deleted and History rows included, so a restore still lands
 * in its place). A null rank only comes from code older than step 17 and sorts
 * first ("new on top").
 *
 * **Done and History.** Done shows a task for exactly 24 elapsed hours after it
 * most recently entered Done (`moved_at`), measured on the database's clock.
 * After that the same row shows in History, newest finished first. History is
 * not a stage and nothing moves anything: it is this query. Reopening is a move
 * back to an active stage, which starts a fresh `moved_at`.
 *
 * `created_by` is written once, from the session, and never by anything else:
 * it is the audit fact of who added the task. Assignees are separate — current
 * responsibility — and may be nobody, one person or several, on one task.
 *
 * Deletion is soft: a deleted task leaves every view except Recently deleted and
 * can be restored by any member, because in a shared space one person's mis-tap
 * must not silently erase another's work. Nothing is ever purged by age.
 *
 * ## The rules every function keeps
 *
 * - Every read and write starts at `requireBoard`: a non-member — and a space
 *   that does not exist — gets the same 404. Writes pass `write: true`, so an
 *   archived space is read-only for everything here.
 * - Every task and group is looked up with its space (`id = $task and
 *   board_id = $space`), and the schema's composite keys hold the same line in
 *   the database: no task points at another space's group or person.
 * - Assignees must be current members of the task's space, checked under lock;
 *   removal, leaving and account deletion clear assignments by cascade.
 * - Writes lock in one order: the space's row, then the accounts involved, then
 *   their memberships (all `for key share`, by id), then the lists a write
 *   reorders (advisory, sorted by stage), then the task. The space
 *   first is the order V1A's membership changes take (they lock it `for update`
 *   before deleting a membership), so removing someone and their own write queue
 *   rather than cross. Key share, not share: account deletion sets the space's
 *   `created_by` to null, and a stronger lock here would cross with that. So an
 *   archive does not wait for a write already past its check; that write was
 *   decided before the archive, and every later one is refused. Accounts before
 *   memberships is the order account deletion takes. Proven on real PostgreSQL
 *   (.pgdata-deploy/gate-v1b.pgtest.ts).
 * - Small fields are last-write-wins per field: a move and a group change made
 *   at the same moment both land. Title and description carry `text_version`:
 *   an edit made from an older version is refused (`textConflict`), so nobody's
 *   words are silently overwritten.
 * - Nothing here reads private RichHabit data, and nothing here logs content.
 */

export { BOARD_STAGES, EFFORT_CHOICES, STAGES, isStage, type Stage } from "@/lib/together/stages";

export const MAX_TITLE = 200;
export const MAX_DESCRIPTION = 10_000;
export const MAX_GROUP_NAME = 40;
export const MAX_GROUPS = 30;
export const MAX_ASSIGNEES = 20;
/**
 * Open work (not done, not deleted) per space — a soft guard against runaway
 * creation, far above real use. Not serialized: simultaneous creates can pass it
 * by a few, which is harmless for a guard of this size.
 */
export const MAX_OPEN_TASKS = 1_000;
/** Done shows a task for this long after it most recently entered Done; after that it is History. */
export const DONE_HOURS = 24;
export const HISTORY_PAGE = 20;
export const DELETED_LIST_MAX = 100;
/** The space between neighbouring ranks after a renumber, and above/below the ends of a list. */
export const RANK_GAP = 1024n;

type Q = typeof query;

/** A task as the board and the backlog show it. */
export interface TaskSummary {
  id: string;
  title: string;
  stage: Stage;
  /** When it entered its stage, exact to the microsecond (UTC): Done's 24 hours, History's order and cursor. */
  movedAt: string;
  /** Its place in its list, as decimal text (a bigint); null only for tasks written before step 17. */
  rank: string | null;
  groupId: string | null;
  effort: number | null;
  /** A calendar date, YYYY-MM-DD. */
  dueOn: string | null;
  assignees: string[];
  hasDescription: boolean;
  textVersion: number;
}

/** Someone the task names — its creator, last editor or deleter — while they are still a member. */
export interface Named { id: string; name: string }

/** A task as its sheet shows it. A null person is a former member (or a deleted account). */
export interface TaskDetail extends TaskSummary {
  description: string;
  createdBy: Named | null;
  createdAt: string;
  updatedBy: Named | null;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: Named | null;
}

export interface GroupView { id: string; name: string }

export interface WorkView {
  /** `canInvite`: the same rule the invitation routes enforce (full access, space not archived) — the header only shows or hides its Invite action by it. */
  space: { id: string; name: string; role: BoardRole; archived: boolean; canInvite: boolean };
  /** Current members: who can be assigned, and whose names the board shows. */
  members: PersonView[];
  groups: GroupView[];
  /** The Board (Done only for its 24 hours) and the Backlog, each list in its order. */
  tasks: TaskSummary[];
  /** History's first page, newest finished first, and how many History holds. */
  history: { tasks: TaskSummary[]; more: boolean; total: number };
  /** The database's clock when this was read — what Done's 24 hours are measured against. */
  serverNow: string;
}

export interface DeletedTask { id: string; title: string; stage: Stage; deletedAt: string; deletedBy: Named | null }

/* ------------------------------- validation -------------------------------- */

/** One line: surrounding space trimmed and runs of whitespace (newlines included) collapsed. */
export function cleanTitle(raw: unknown): string {
  const title = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!title) throw new TogetherError("titleRequired");
  if (title.length > MAX_TITLE) throw new TogetherError("titleTooLong");
  return title;
}

/** Kept as written, line breaks and all; trailing space trimmed. Empty means none. */
export function cleanDescription(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new TogetherError("descriptionTooLong");
  const text = raw.replace(/\s+$/, "");
  if (text.length > MAX_DESCRIPTION) throw new TogetherError("descriptionTooLong");
  return text.trim() ? text : null;
}

export function cleanGroupName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!name) throw new TogetherError("groupNameRequired");
  if (name.length > MAX_GROUP_NAME) throw new TogetherError("groupNameTooLong");
  return name;
}

export function cleanEffort(raw: unknown): number | null {
  if (raw === null) return null;
  if (!(EFFORT_CHOICES as readonly unknown[]).includes(raw)) throw new TogetherError("effortInvalid");
  return raw as number;
}

export function cleanDue(raw: unknown): string | null {
  if (raw === null) return null;
  if (!isDueDate(raw)) throw new TogetherError("dueInvalid");
  return raw;
}

export function cleanAssignees(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new TogetherError("notAMember");
  const ids = [...new Set(raw.map((v) => (typeof v === "string" ? v.toLowerCase() : v)))];
  if (!ids.every(isUuid)) throw new TogetherError("notAMember");
  if (ids.length > MAX_ASSIGNEES) throw new TogetherError("tooManyAssignees");
  return ids as string[];
}

/* --------------------------------- SQL ------------------------------------- */

/** `moved_at` exactly, as UTC text with microseconds: a lossless cursor (a JS Date keeps only milliseconds). */
const MOVED = `to_char(t.moved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const SUMMARY = `t.id::text as id, t.title, t.stage, ${MOVED} as "movedAt", t.rank::text as rank,
  t.group_id::text as "groupId", t.effort, t.due_on::text as "dueOn",
  coalesce((select json_agg(a.user_id::text order by a.assigned_at, a.user_id)
              from together_task_assignees a where a.task_id = t.id), '[]'::json) as assignees,
  (t.description is not null) as "hasDescription", t.text_version as "textVersion"`;

/** A person a task names, while they are still a member of its space — else null ("Former member"). */
const named = (column: string) => `(select json_build_object('id', u.id::text, 'name', ${DISPLAY_NAME})
    from together_members m join users u on u.id = m.user_id left join profiles p on p.id = u.id
   where m.board_id = t.board_id and m.user_id = ${column})`;

/** Order within a list. */
const LIST_ORDER = "t.rank asc nulls first, t.moved_at desc, t.id desc";
/** History's order: newest finished first. */
const HISTORY_ORDER = "t.moved_at desc, t.id desc";
/** A Done task still on the Board (`t`): it entered Done less than DONE_HOURS ago, by the database's clock. */
const FRESH = `t.moved_at > now() - make_interval(hours => ${DONE_HOURS})`;
/** A task in History. */
const IN_HISTORY = `t.stage = 'done' and not (${FRESH})`;

/* --------------------------------- reads ----------------------------------- */

export async function loadWork(userId: string, boardId: unknown): Promise<WorkView> {
  // One transaction, so one now(): a card crossing its 24 hours mid-read is in Done or in History, never both.
  return transaction((q) => readWork(q, userId, boardId));
}

async function readWork(query: Q, userId: string, boardId: unknown): Promise<WorkView> {
  const access = await requireBoard(query, userId, boardId);
  const id = access.boardId;
  const [space] = await query<{ name: string }>(`select name from together_boards where id = $1`, [id]);
  const members = await query<PersonView>(
    `select u.id::text as id, ${DISPLAY_NAME} as name
       from together_members m join users u on u.id = m.user_id left join profiles p on p.id = u.id
      where m.board_id = $1 order by m.joined_at, m.user_id`, [id]);
  const groups = await query<GroupView>(
    `select id::text as id, name from together_groups where board_id = $1 order by lower(name), name, id`, [id]);
  const tasks = await query<TaskSummary>(
    `select ${SUMMARY} from together_tasks t
      where t.board_id = $1 and t.deleted_at is null and not (${IN_HISTORY})
      order by t.stage, ${LIST_ORDER}`, [id]);
  const [{ total, now }] = await query<{ total: number; now: string }>(
    `select count(*)::int as total, to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as now
       from together_tasks t where t.board_id = $1 and t.deleted_at is null and ${IN_HISTORY}`, [id]);
  const first = await historyRows(query, id, null);
  return {
    space: { id, name: space.name, role: access.role, archived: access.archived, canInvite: mayInvite(userId, access.archived) },
    members, groups, tasks,
    history: { ...first, total },
    serverNow: now,
  };
}

async function historyRows(q: Q, boardId: string, cursor: { at: string; id: string } | null) {
  const rows = await q<TaskSummary>(
    `select ${SUMMARY} from together_tasks t
      where t.board_id = $1 and t.deleted_at is null and ${IN_HISTORY}
        ${cursor ? "and (t.moved_at, t.id) < ($3::timestamptz, $4::uuid)" : ""}
      order by ${HISTORY_ORDER} limit $2`,
    cursor ? [boardId, HISTORY_PAGE + 1, cursor.at, cursor.id] : [boardId, HISTORY_PAGE + 1]);
  return { tasks: rows.slice(0, HISTORY_PAGE), more: rows.length > HISTORY_PAGE };
}

const parseCursor = (raw: unknown): { at: string; id: string } | null => {
  if (typeof raw !== "string" || !raw) return null;
  const [at, id] = raw.split("|");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(at ?? "") || !isUuid(id)) return null;
  return { at, id };
};
export const cursorOf = (t: Pick<TaskSummary, "movedAt" | "id">) => `${t.movedAt}|${t.id}`;

/**
 * History after `cursor` (the last task already on screen), newest finished
 * first. Without a cursor, from the top. Nothing in History is ever removed for
 * its age.
 */
export async function historyPage(userId: string, boardId: unknown, rawCursor: unknown): Promise<{ tasks: TaskSummary[]; more: boolean }> {
  const access = await requireBoard(query, userId, boardId);
  return historyRows(query, access.boardId, parseCursor(rawCursor));
}

export async function loadTask(userId: string, boardId: unknown, taskId: unknown): Promise<TaskDetail> {
  const access = await requireBoard(query, userId, boardId);
  if (!isUuid(taskId)) throw new TogetherError("taskMissing", 404);
  const [task] = await query<TaskDetail>(
    `select ${SUMMARY}, coalesce(t.description, '') as description,
            ${named("t.created_by")} as "createdBy", t.created_at as "createdAt",
            ${named("t.updated_by")} as "updatedBy", t.updated_at as "updatedAt",
            t.deleted_at as "deletedAt", ${named("t.deleted_by")} as "deletedBy"
       from together_tasks t where t.id = $1 and t.board_id = $2`, [taskId, access.boardId]);
  if (!task) throw new TogetherError("taskMissing", 404);
  return task;
}

export async function deletedTasks(userId: string, boardId: unknown): Promise<DeletedTask[]> {
  const access = await requireBoard(query, userId, boardId);
  return query<DeletedTask>(
    `select t.id::text as id, t.title, t.stage, t.deleted_at as "deletedAt", ${named("t.deleted_by")} as "deletedBy"
       from together_tasks t where t.board_id = $1 and t.deleted_at is not null
      order by t.deleted_at desc, t.id desc limit $2`, [access.boardId, DELETED_LIST_MAX]);
}

/* -------------------------------- writes ----------------------------------- */

/**
 * The write gate. The space's row first (`for key share`: writers share it;
 * V1A's membership changes, which lock it `for update`, wait for them), then
 * membership and archive (`requireBoard`, read after the lock), then the accounts
 * involved (the writer, and anyone being assigned) and their memberships of this
 * space — `for key share` too, which other writers share and a removal or
 * deletion waits for. Returns who of `people` is a member right now; the writer
 * must still be one.
 */
async function gate(q: Q, userId: string, boardId: unknown, people: string[] = []) {
  // Locking a row reveals nothing: whether the caller may write is decided next.
  if (isUuid(boardId)) await q(`select 1 from together_boards where id = $1 for key share`, [boardId]);
  const access = await requireBoard(q, userId, boardId, { write: true });
  const ids = [...new Set([userId, ...people])];
  await q(`select 1 from users where id = any($1::uuid[]) order by id for key share`, [ids]);
  const rows = await q<{ id: string }>(
    `select user_id::text as id from together_members where board_id = $1 and user_id = any($2::uuid[])
      order by user_id for key share`, [access.boardId, ids]);
  const present = new Set(rows.map((r) => r.id));
  if (!present.has(userId)) throw new TogetherError("notFound", 404);
  return { boardId: access.boardId, present };
}

async function summary(q: Q, boardId: string, taskId: string): Promise<TaskSummary> {
  const [task] = await q<TaskSummary>(`select ${SUMMARY} from together_tasks t where t.id = $1 and t.board_id = $2`, [taskId, boardId]);
  return task;
}

async function guardOpenCount(q: Q, boardId: string) {
  const [{ n }] = await q<{ n: number }>(
    `select count(*)::int n from together_tasks where board_id = $1 and deleted_at is null and stage <> 'done'`, [boardId]);
  if (n >= MAX_OPEN_TASKS) throw new TogetherError("tooManyTasks", 409);
}

/* ------------------------------ ordering ---------------------------------- */

/**
 * Takes the lists a write reorders, in one fixed order (by stage name), so two
 * writes touching the same lists queue instead of crossing. Transaction-scoped:
 * released at commit or rollback. Always after the write gate and before any
 * task row, so a renumber (which updates the list's rows) never waits for a row
 * held by a writer that is itself waiting for this list.
 */
async function lockLists(q: Q, boardId: string, stages: Stage[]) {
  for (const stage of [...new Set(stages)].sort()) {
    await q(`select pg_advisory_xact_lock(hashtextextended('together-list:' || $1::text || ':' || $2, 0))`, [boardId, stage]);
  }
}

/** A thrown error that `togetherTransaction` retries from the start, like a serialization failure. */
const retry = () => Object.assign(new Error("together: retry"), { code: "40001" });

interface ListRow { id: string; rank: bigint | null }

/**
 * The list as members see it, in order: live tasks only, and for Done only its
 * 24 hours — never a deleted task, never a History task. `excluding` is the task
 * being placed. Only these rows are ever neighbours.
 */
async function visibleList(q: Q, boardId: string, stage: Stage, excluding?: string): Promise<ListRow[]> {
  const rows = await q<{ id: string; rank: string | null }>(
    `select t.id::text as id, t.rank::text as rank from together_tasks t
      where t.board_id = $1 and t.stage = $2 and t.deleted_at is null
        ${stage === "done" ? `and ${FRESH}` : ""} ${excluding ? "and t.id <> $3" : ""}
      order by ${LIST_ORDER}`, excluding ? [boardId, stage, excluding] : [boardId, stage]);
  return rows.map((r) => ({ id: r.id, rank: r.rank === null ? null : BigInt(r.rank) }));
}

/**
 * Renumbers one list, 1024 apart, keeping its order exactly. The list's deleted
 * tasks take part too, so each keeps its place and a restore returns it where it
 * was; for Done, only its 24 hours do (History is ordered by `moved_at` and
 * never needs a rank — reopening assigns a fresh one), so the work stays bounded.
 * Writes `rank` only. Rare: only when no integer is left between two
 * neighbours, i.e. after about ten drops into the same gap.
 *
 * It never waits for a row: it takes the list's rows with NOWAIT first, and if
 * anything else holds one — an editor, or an account deletion setting
 * `created_by` to null — it gives way and the whole move is retried
 * (`togetherTransaction`). So a renumber can never be part of a deadlock cycle.
 */
async function renumber(q: Q, boardId: string, stage: Stage) {
  const scope = `board_id = $1 and stage = $2${stage === "done" ? ` and ${FRESH.replace(/t\./g, "")}` : ""}`;
  try {
    await q(`select id from together_tasks where ${scope} order by id for update nowait`, [boardId, stage]);
  } catch (e) {
    if ((e as { code?: unknown })?.code === "55P03") throw retry();   // lock not available: give way, retry
    throw e;
  }
  await q(`update together_tasks t set rank = r.n * ${RANK_GAP}
    from (select id, row_number() over (order by ${LIST_ORDER.replace(/t\./g, "")}) as n
            from together_tasks where ${scope}) r
   where t.id = r.id and t.rank is distinct from r.n * ${RANK_GAP}`, [boardId, stage]);
}

export type Placement = { place: "top" | "bottom" } | { before: string } | { after: string };

/** The rank strictly between two neighbours, or null when there is none (they are adjacent, or tied). */
const between = (lo: bigint, hi: bigint): bigint | null => (hi - lo > 1n ? lo + (hi - lo) / 2n : null);

/**
 * Where a task goes in `stage`'s list, as a rank. A neighbour that is not in the
 * visible list — moved meanwhile, deleted, in History, another space's — is
 * ignored and the task goes to the top. Renumbers the list once if the visible
 * list has an unranked task or no room at the chosen spot; the second attempt
 * always has room.
 */
async function placeRank(q: Q, boardId: string, stage: Stage, taskId: string | undefined, at: Placement): Promise<bigint> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const list = await visibleList(q, boardId, stage, taskId);
    if (attempt === 0 && list.some((r) => r.rank === null)) { await renumber(q, boardId, stage); continue; }
    const ranks = list.map((r) => r.rank as bigint);
    const top = () => (ranks.length ? ranks[0] - RANK_GAP : 0n);
    let rank: bigint | null;
    if ("place" in at) rank = at.place === "bottom" ? (ranks.length ? ranks[ranks.length - 1] + RANK_GAP : 0n) : top();
    else {
      const i = list.findIndex((r) => r.id === ("before" in at ? at.before : at.after));
      if (i < 0) rank = top();
      else if ("before" in at) rank = i === 0 ? ranks[0] - RANK_GAP : between(ranks[i - 1], ranks[i]);
      else rank = i === list.length - 1 ? ranks[i] + RANK_GAP : between(ranks[i], ranks[i + 1]);
    }
    if (rank !== null) return rank;
    await renumber(q, boardId, stage);
  }
  throw new Error("together: no room after renumbering");   // unreachable: a renumber leaves 1024 between neighbours
}

/** Quick capture: a title, in a stage (Backlog or a board stage; To do by default). Lands at the top. */
export async function createTask(userId: string, boardId: unknown, raw: { title?: unknown; stage?: unknown }): Promise<TaskSummary> {
  const title = cleanTitle(raw.title);
  const stage = raw.stage === undefined ? "todo" : raw.stage;
  if (!isStage(stage)) throw new TogetherError("stageInvalid");
  return transaction(async (q) => {
    const { boardId: id } = await gate(q, userId, boardId);
    if (stage !== "done") await guardOpenCount(q, id);
    await lockLists(q, id, [stage]);
    const rank = await placeRank(q, id, stage, undefined, { place: "top" });
    const [row] = await q<{ id: string }>(
      `insert into together_tasks (board_id, title, stage, rank, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $5) returning id::text as id`, [id, title, stage, rank.toString(), userId]);
    return summary(q, id, row.id);
  });
}

export interface TaskPatch {
  title?: unknown; description?: unknown; textVersion?: unknown;
  stage?: unknown; groupId?: unknown; effort?: unknown; dueOn?: unknown; assignees?: unknown;
}

export interface UpdateResult {
  task: TaskSummary;
  /** What actually changed — for content-free analytics. */
  moved: { from: Stage; to: Stage } | null;
  assigneesChanged: boolean;
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Changes any subset of a task's fields. Only fields present in `patch` are
 * touched. A field set to its current value is not a change. Moving to a new
 * stage brings the task to the top of it.
 */
export async function updateTask(userId: string, boardId: unknown, taskId: unknown, patch: TaskPatch): Promise<UpdateResult> {
  if (!isUuid(taskId)) throw new TogetherError("taskMissing", 404);
  // Validate everything before taking a lock.
  const title = has(patch, "title") ? cleanTitle(patch.title) : undefined;
  const description = has(patch, "description") ? cleanDescription(patch.description) : undefined;
  const textEdit = title !== undefined || description !== undefined;
  if (textEdit && (typeof patch.textVersion !== "number" || !Number.isInteger(patch.textVersion))) {
    throw new TogetherError("textConflict", 409);
  }
  const stage = has(patch, "stage") ? patch.stage : undefined;
  if (stage !== undefined && !isStage(stage)) throw new TogetherError("stageInvalid");
  const groupId = has(patch, "groupId") ? patch.groupId : undefined;
  if (groupId !== undefined && groupId !== null && !isUuid(groupId)) throw new TogetherError("groupMissing", 409);
  const effort = has(patch, "effort") ? cleanEffort(patch.effort) : undefined;
  const dueOn = has(patch, "dueOn") ? cleanDue(patch.dueOn) : undefined;
  const assignees = has(patch, "assignees") ? cleanAssignees(patch.assignees) : undefined;

  return transaction(async (q) => {
    const { boardId: id, present } = await gate(q, userId, boardId, assignees);
    if (assignees && !assignees.every((a) => present.has(a))) throw new TogetherError("notAMember");
    // A stage change reorders two lists: take them before the task's row.
    let lockedFrom: Stage | null = null;
    if (stage !== undefined) {
      const [peek] = await q<{ stage: Stage }>(`select stage from together_tasks where id = $1 and board_id = $2`, [taskId, id]);
      if (!peek) throw new TogetherError("taskMissing", 404);
      if (peek.stage !== stage) { lockedFrom = peek.stage; await lockLists(q, id, [peek.stage, stage as Stage]); }
    }
    const [current] = await q<{
      title: string; description: string | null; stage: Stage; group_id: string | null;
      effort: number | null; due_on: string | null; text_version: number; deleted: boolean;
    }>(
      `select title, description, stage, group_id::text as group_id, effort, due_on::text as due_on,
              text_version, deleted_at is not null as deleted
         from together_tasks where id = $1 and board_id = $2 for update`, [taskId, id]);
    if (!current) throw new TogetherError("taskMissing", 404);
    if (current.deleted) throw new TogetherError("taskDeleted", 410);

    const sets: string[] = [];
    const params: unknown[] = [taskId, id];
    const set = (column: string, value: unknown) => { params.push(value); sets.push(`${column} = $${params.length}`); };

    const titleChanged = title !== undefined && title !== current.title;
    const descriptionChanged = description !== undefined && description !== current.description;
    if (titleChanged || descriptionChanged) {
      if (patch.textVersion !== current.text_version) throw new TogetherError("textConflict", 409);
      if (titleChanged) set("title", title);
      if (descriptionChanged) set("description", description);
      sets.push("text_version = text_version + 1");
    }
    let moved: UpdateResult["moved"] = null;
    if (stage !== undefined && stage !== current.stage) {
      // It moved between our look and our lock: start again with the right lists.
      if (lockedFrom !== current.stage) throw retry();
      if (current.stage === "done" && stage !== "done") await guardOpenCount(q, id);
      set("stage", stage);
      set("rank", (await placeRank(q, id, stage, taskId as string, { place: "top" })).toString());
      sets.push("moved_at = now()");
      moved = { from: current.stage, to: stage };
    }
    if (groupId !== undefined && groupId !== current.group_id) {
      if (groupId !== null) {
        const [g] = await q(`select 1 from together_groups where id = $1 and board_id = $2 for key share`, [groupId, id]);
        if (!g) throw new TogetherError("groupMissing", 409);
      }
      set("group_id", groupId);
    }
    if (effort !== undefined && effort !== current.effort) set("effort", effort);
    if (dueOn !== undefined && dueOn !== current.due_on) set("due_on", dueOn);

    let assigneesChanged = false;
    if (assignees) {
      const removed = await q(
        `delete from together_task_assignees where task_id = $1 and board_id = $2 and not (user_id = any($3::uuid[]))
         returning user_id`, [taskId, id, assignees]);
      const added = await q(
        `insert into together_task_assignees (task_id, board_id, user_id)
         select $1, $2, u from unnest($3::uuid[]) as u
         on conflict (task_id, user_id) do nothing returning user_id`, [taskId, id, assignees]);
      assigneesChanged = removed.length > 0 || added.length > 0;
    }

    if (sets.length || assigneesChanged) {
      set("updated_by", userId);
      sets.push("updated_at = now()");
      await q(`update together_tasks set ${sets.join(", ")} where id = $1 and board_id = $2`, params);
    }
    return { task: await summary(q, id, taskId as string), moved, assigneesChanged };
  });
}

/** Soft delete: out of every view but Recently deleted. Repeating it changes nothing (and says so). */
export async function deleteTask(userId: string, boardId: unknown, taskId: unknown): Promise<boolean> {
  if (!isUuid(taskId)) throw new TogetherError("taskMissing", 404);
  return transaction(async (q) => {
    const { boardId: id } = await gate(q, userId, boardId);
    const [row] = await q<{ deleted: boolean }>(
      `select deleted_at is not null as deleted from together_tasks where id = $1 and board_id = $2 for update`, [taskId, id]);
    if (!row) throw new TogetherError("taskMissing", 404);
    if (row.deleted) return false;
    await q(`update together_tasks set deleted_at = now(), deleted_by = $3 where id = $1 and board_id = $2`, [taskId, id, userId]);
    return true;
  });
}

/**
 * Back where it was — same stage, same place: its `moved_at` and `rank` are
 * untouched (a Done task past its 24 hours returns to History). One rule keeps
 * the order unambiguous: if a visible task now holds the very same rank (it was
 * placed into the gap this task left), or the task has no rank, the restored
 * task goes directly above that task (or to the top). Repeating it changes
 * nothing.
 */
export async function restoreTask(userId: string, boardId: unknown, taskId: unknown): Promise<TaskSummary> {
  if (!isUuid(taskId)) throw new TogetherError("taskMissing", 404);
  return transaction(async (q) => {
    const { boardId: id } = await gate(q, userId, boardId);
    const [peek] = await q<{ stage: Stage }>(`select stage from together_tasks where id = $1 and board_id = $2`, [taskId, id]);
    if (!peek) throw new TogetherError("taskMissing", 404);
    await lockLists(q, id, [peek.stage]);
    const [row] = await q<{ deleted: boolean; stage: Stage; rank: string | null; fresh: boolean }>(
      `select deleted_at is not null as deleted, stage, rank::text as rank, (stage <> 'done' or ${FRESH}) as fresh
         from together_tasks t where id = $1 and board_id = $2 for update`, [taskId, id]);
    if (!row) throw new TogetherError("taskMissing", 404);
    if (row.stage !== peek.stage) throw retry();
    if (row.deleted) {
      if (row.stage !== "done") await guardOpenCount(q, id);
      let rank = row.rank;
      if (row.fresh) {
        const list = await visibleList(q, id, row.stage, taskId as string);
        const holder = list.find((r) => r.rank !== null && r.rank.toString() === row.rank);
        if (row.rank === null) rank = (await placeRank(q, id, row.stage, taskId as string, { place: "top" })).toString();
        else if (holder) rank = (await placeRank(q, id, row.stage, taskId as string, { before: holder.id })).toString();
      }
      await q(`update together_tasks set deleted_at = null, deleted_by = null, rank = $3 where id = $1 and board_id = $2`, [taskId, id, rank]);
    }
    return summary(q, id, taskId as string);
  });
}

export interface MoveIntent { stage?: unknown; place?: unknown; before?: unknown; after?: unknown }
export interface MoveResult {
  task: TaskSummary;
  from: Stage;
  to: Stage;
  /** Moved within its own list. */
  reordered: boolean;
  /** Brought back from History. */
  reopened: boolean;
  /** Nothing to do (already first and asked "up", and so on). */
  unchanged: boolean;
}

const PLACES = ["top", "bottom", "up", "down"] as const;
type Place = (typeof PLACES)[number];

/**
 * Moves a task to a place in a list: drag-and-drop, Move to…, Position (top,
 * up, down, bottom) and Reopen are all this. The client states intent — a stage,
 * and a place or a neighbour it sees — and the server decides the rank.
 *
 * - Changing stage sets `moved_at` (so entering Done starts its 24 hours, and
 *   leaving and re-entering starts them again). Reordering within a list never
 *   touches it.
 * - A History task can only be reopened — moved to To do, In progress, Waiting
 *   or the Backlog; it cannot be reordered in Done or dropped back into it.
 * - Words are never touched: `text_version` is not involved.
 */
export async function moveTask(userId: string, boardId: unknown, taskId: unknown, raw: MoveIntent): Promise<MoveResult> {
  if (!isUuid(taskId)) throw new TogetherError("taskMissing", 404);
  if (raw.stage !== undefined && !isStage(raw.stage)) throw new TogetherError("stageInvalid");
  const place = raw.place === undefined ? undefined : raw.place;
  if (place !== undefined && !(PLACES as readonly unknown[]).includes(place)) throw new TogetherError("stageInvalid");
  const before = raw.before === undefined || raw.before === null ? undefined : raw.before;
  const after = raw.after === undefined || raw.after === null ? undefined : raw.after;
  if ((before !== undefined && !isUuid(before)) || (after !== undefined && !isUuid(after))) throw new TogetherError("taskMissing", 404);

  return transaction(async (q) => {
    const { boardId: id } = await gate(q, userId, boardId);
    const [peek] = await q<{ stage: Stage }>(`select stage from together_tasks where id = $1 and board_id = $2`, [taskId, id]);
    if (!peek) throw new TogetherError("taskMissing", 404);
    const to = (raw.stage ?? peek.stage) as Stage;
    await lockLists(q, id, [peek.stage, to]);
    const [current] = await q<{ stage: Stage; deleted: boolean; history: boolean }>(
      `select stage, deleted_at is not null as deleted, (${IN_HISTORY}) as history
         from together_tasks t where id = $1 and board_id = $2 for update`, [taskId, id]);
    if (!current) throw new TogetherError("taskMissing", 404);
    if (current.stage !== peek.stage) throw retry();
    if (current.deleted) throw new TogetherError("taskDeleted", 410);
    if (current.history && to === "done") throw new TogetherError("stageInvalid");
    const sameList = to === current.stage;
    if (!sameList && current.stage === "done") await guardOpenCount(q, id);

    // Intent → placement. Up/down are relative to the task's own place in its list.
    const unchanged = async (): Promise<MoveResult> =>
      ({ task: await summary(q, id, taskId as string), from: current.stage, to, reordered: true, reopened: false, unchanged: true });
    const own = sameList ? await visibleList(q, id, to) : [];
    const i = own.findIndex((r) => r.id === taskId);
    let at: Placement;
    if (before !== undefined) at = { before: before as string };
    else if (after !== undefined) at = { after: after as string };
    else if (place === "up" || place === "down") {
      if (!sameList) at = { place: "top" };
      else {
        const j = place === "up" ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= own.length) return unchanged();
        at = place === "up" ? { before: own[j].id } : { after: own[j].id };
      }
    } else at = { place: (place as "top" | "bottom" | undefined) ?? "top" };
    // A drop or a choice that leaves the task exactly where it is writes nothing:
    // no new rank, and no "edited" stamp on a task nobody changed.
    if (sameList && i >= 0) {
      const prev = own[i - 1]?.id, next = own[i + 1]?.id;
      const stays = "place" in at ? (at.place === "top" ? i === 0 : i === own.length - 1)
        : "before" in at ? at.before === taskId || at.before === next
        : at.after === taskId || at.after === prev;
      if (stays) return unchanged();
    }

    const rank = await placeRank(q, id, to, taskId as string, at);
    await q(`update together_tasks set rank = $3, updated_by = $4, updated_at = now()
               ${sameList ? "" : ", stage = $5, moved_at = now()"}
             where id = $1 and board_id = $2`, sameList ? [taskId, id, rank.toString(), userId] : [taskId, id, rank.toString(), userId, to]);
    return {
      task: await summary(q, id, taskId as string), from: current.stage, to,
      reordered: sameList, reopened: current.history && !sameList, unchanged: false,
    };
  });
}

/* -------------------------------- groups ----------------------------------- */

const isUniqueViolation = (e: unknown) => (e as { code?: unknown })?.code === "23505";

/**
 * A group by name: the existing one if the space already has it (ignoring
 * case) — so "Create 'sourcing'" in the task sheet simply picks Sourcing — else
 * a new one. Serialized per space so the limit holds exactly.
 */
export async function ensureGroup(userId: string, boardId: unknown, rawName: unknown): Promise<GroupView & { created: boolean }> {
  const name = cleanGroupName(rawName);
  return transaction(async (q) => {
    const { boardId: id } = await gate(q, userId, boardId);
    await q(`select pg_advisory_xact_lock(hashtextextended('together-groups:' || $1::text, 0))`, [id]);
    const [existing] = await q<GroupView>(
      `select id::text as id, name from together_groups where board_id = $1 and lower(name) = lower($2)`, [id, name]);
    if (existing) return { ...existing, created: false };
    const [{ n }] = await q<{ n: number }>(`select count(*)::int n from together_groups where board_id = $1`, [id]);
    if (n >= MAX_GROUPS) throw new TogetherError("tooManyGroups", 409);
    // The per-space lock serializes creating and renaming; a name taken anyway
    // (by a statement outside them) is still a conflict, never a raw error.
    try {
      const [group] = await q<GroupView>(
        `insert into together_groups (board_id, name, created_by) values ($1, $2, $3) returning id::text as id, name`,
        [id, name, userId]);
      return { ...group, created: true };
    } catch (e) {
      if (isUniqueViolation(e)) throw new TogetherError("groupExists", 409);
      throw e;
    }
  });
}

export async function renameGroup(userId: string, boardId: unknown, groupId: unknown, rawName: unknown): Promise<GroupView> {
  if (!isUuid(groupId)) throw new TogetherError("groupMissing", 409);
  const name = cleanGroupName(rawName);
  return transaction(async (q) => {
    const { boardId: id } = await gate(q, userId, boardId);
    await q(`select pg_advisory_xact_lock(hashtextextended('together-groups:' || $1::text, 0))`, [id]);
    const [clash] = await q(
      `select 1 from together_groups where board_id = $1 and lower(name) = lower($2) and id <> $3`, [id, name, groupId]);
    if (clash) throw new TogetherError("groupExists", 409);
    try {
      const [group] = await q<GroupView>(
        `update together_groups set name = $3 where id = $1 and board_id = $2 returning id::text as id, name`,
        [groupId, id, name]);
      if (!group) throw new TogetherError("groupMissing", 409);
      return group;
    } catch (e) {
      // Someone else took the name at the same moment.
      if (isUniqueViolation(e)) throw new TogetherError("groupExists", 409);
      throw e;
    }
  });
}

/** Deletes the label; its tasks stay, without a group (the schema clears them). */
export async function deleteGroup(userId: string, boardId: unknown, groupId: unknown): Promise<void> {
  if (!isUuid(groupId)) throw new TogetherError("groupMissing", 409);
  await transaction(async (q) => {
    const { boardId: id } = await gate(q, userId, boardId);
    await q(`delete from together_groups where id = $1 and board_id = $2`, [groupId, id]);
  });
}
