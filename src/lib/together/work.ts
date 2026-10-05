import { query } from "@/lib/db/pool";
import { isUuid } from "@/lib/http";
import { DISPLAY_NAME, TogetherError, requireBoard, type BoardRole, type PersonView } from "@/lib/together/access";
import { isDueDate } from "@/lib/together/due";
import { EFFORT_CHOICES, isStage, type Stage } from "@/lib/together/stages";
import { togetherTransaction as transaction } from "@/lib/together/tx";

/**
 * Together V1B — a space's shared work: the Backlog ("we might") and the Board
 * ("we will").
 *
 * ## The model
 *
 * A task lives in one stage: `backlog`, or one of the board's four fixed
 * stages. Within a stage the order is `moved_at desc, id desc`. Creating a task
 * and moving it set `moved_at`, so new and moved work comes to the top; editing
 * never reorders. There is no position column: nothing here drags, and a later
 * drag-and-drop adds its own rank additively.
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
 *   their memberships (all `for key share`, by id), then the task. The space
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
/** Done shows what was finished in the last two weeks, at most twenty; the rest is behind "Show older". */
export const RECENT_DONE_DAYS = 14;
export const RECENT_DONE_MAX = 20;
export const DONE_PAGE = 20;
export const DELETED_LIST_MAX = 100;

type Q = typeof query;

/** A task as the board and the backlog show it. */
export interface TaskSummary {
  id: string;
  title: string;
  stage: Stage;
  /** When it entered its stage, exact to the microsecond (UTC): the order, and the cursor for older Done. */
  movedAt: string;
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
  space: { id: string; name: string; role: BoardRole; archived: boolean };
  /** Current members: who can be assigned, and whose names the board shows. */
  members: PersonView[];
  groups: GroupView[];
  /** Every live task except Done older than the recent window. */
  tasks: TaskSummary[];
  /** Done tasks not in `tasks`, behind "Show older". */
  doneOlder: number;
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

const SUMMARY = `t.id::text as id, t.title, t.stage, ${MOVED} as "movedAt",
  t.group_id::text as "groupId", t.effort, t.due_on::text as "dueOn",
  coalesce((select json_agg(a.user_id::text order by a.assigned_at, a.user_id)
              from together_task_assignees a where a.task_id = t.id), '[]'::json) as assignees,
  (t.description is not null) as "hasDescription", t.text_version as "textVersion"`;

/** A person a task names, while they are still a member of its space — else null ("Former member"). */
const named = (column: string) => `(select json_build_object('id', u.id::text, 'name', ${DISPLAY_NAME})
    from together_members m join users u on u.id = m.user_id left join profiles p on p.id = u.id
   where m.board_id = t.board_id and m.user_id = ${column})`;

const ORDER = "t.moved_at desc, t.id desc";

/* --------------------------------- reads ----------------------------------- */

export async function loadWork(userId: string, boardId: unknown): Promise<WorkView> {
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
    `with recent as (
       select t.id from together_tasks t
        where t.board_id = $1 and t.deleted_at is null and t.stage = 'done'
          and t.moved_at > now() - make_interval(days => $2)
        order by ${ORDER} limit $3)
     select ${SUMMARY} from together_tasks t
      where t.board_id = $1 and t.deleted_at is null
        and (t.stage <> 'done' or t.id in (select id from recent))
      order by t.stage, ${ORDER}`, [id, RECENT_DONE_DAYS, RECENT_DONE_MAX]);
  const [{ done }] = await query<{ done: number }>(
    `select count(*)::int as done from together_tasks where board_id = $1 and deleted_at is null and stage = 'done'`, [id]);
  return {
    space: { id, name: space.name, role: access.role, archived: access.archived },
    members, groups, tasks,
    doneOlder: done - tasks.filter((t) => t.stage === "done").length,
  };
}

const parseCursor = (raw: unknown): { at: string; id: string } | null => {
  if (typeof raw !== "string" || !raw) return null;
  const [at, id] = raw.split("|");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(at ?? "") || !isUuid(id)) return null;
  return { at, id };
};
export const cursorOf = (t: Pick<TaskSummary, "movedAt" | "id">) => `${t.movedAt}|${t.id}`;

/**
 * Done, older than what the board shows: the page after `cursor` (the last task
 * already on screen), newest first. Without a cursor, from the top.
 */
export async function olderDone(userId: string, boardId: unknown, rawCursor: unknown): Promise<{ tasks: TaskSummary[]; more: boolean }> {
  const access = await requireBoard(query, userId, boardId);
  const cursor = parseCursor(rawCursor);
  const rows = await query<TaskSummary>(
    `select ${SUMMARY} from together_tasks t
      where t.board_id = $1 and t.deleted_at is null and t.stage = 'done'
        ${cursor ? "and (t.moved_at, t.id) < ($3::timestamptz, $4::uuid)" : ""}
      order by ${ORDER} limit $2`,
    cursor ? [access.boardId, DONE_PAGE + 1, cursor.at, cursor.id] : [access.boardId, DONE_PAGE + 1]);
  return { tasks: rows.slice(0, DONE_PAGE), more: rows.length > DONE_PAGE };
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

/** Quick capture: a title, in a stage (Backlog or a board stage; To do by default). Lands at the top. */
export async function createTask(userId: string, boardId: unknown, raw: { title?: unknown; stage?: unknown }): Promise<TaskSummary> {
  const title = cleanTitle(raw.title);
  const stage = raw.stage === undefined ? "todo" : raw.stage;
  if (!isStage(stage)) throw new TogetherError("stageInvalid");
  return transaction(async (q) => {
    const { boardId: id } = await gate(q, userId, boardId);
    if (stage !== "done") await guardOpenCount(q, id);
    const [row] = await q<{ id: string }>(
      `insert into together_tasks (board_id, title, stage, created_by, updated_by)
       values ($1, $2, $3, $4, $4) returning id::text as id`, [id, title, stage, userId]);
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
      if (current.stage === "done" && stage !== "done") await guardOpenCount(q, id);
      set("stage", stage);
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

/** Back where it was — same stage, same place (its `moved_at` is untouched). Repeating it changes nothing. */
export async function restoreTask(userId: string, boardId: unknown, taskId: unknown): Promise<TaskSummary> {
  if (!isUuid(taskId)) throw new TogetherError("taskMissing", 404);
  return transaction(async (q) => {
    const { boardId: id } = await gate(q, userId, boardId);
    const [row] = await q<{ deleted: boolean; stage: Stage }>(
      `select deleted_at is not null as deleted, stage from together_tasks where id = $1 and board_id = $2 for update`, [taskId, id]);
    if (!row) throw new TogetherError("taskMissing", 404);
    if (row.deleted) {
      if (row.stage !== "done") await guardOpenCount(q, id);
      await q(`update together_tasks set deleted_at = null, deleted_by = null where id = $1 and board_id = $2`, [taskId, id]);
    }
    return summary(q, id, taskId as string);
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
