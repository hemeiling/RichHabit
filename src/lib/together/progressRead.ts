import type { query } from "@/lib/db/pool";
import type { Locale } from "@/lib/i18n";
import { DISPLAY_NAME, TogetherError, requireBoard, type BoardRole, type PersonView } from "@/lib/together/access";
import {
  buildReport, contextOf, filterParam, isPeriodKind, matchesGroup, matchesMember, resolvePeriod, standing,
  type GroupFilter, type MemberFilter, type ProjectContext, type ProgressReport, type ProgressTask, type ReportFilters,
} from "@/lib/together/progress";
import { progressWorkbook } from "@/lib/together/progressWorkbook";
import type { Stage } from "@/lib/together/stages";
import { togetherTransaction as transaction } from "@/lib/together/tx";
import { IN_HISTORY, type GroupView } from "@/lib/together/work";
import { canonicalZone, instantToZoned } from "@/lib/zonedTime";

/**
 * Reading a space for Progress — the dashboard and the Excel export. Members
 * only (`requireBoard`: anyone else gets the same 404 as a space that does not
 * exist), archived spaces included, since reading is all this does.
 *
 * One transaction, so one `now()`: what is in History, today's date and the
 * tasks all come from the same moment. Timestamps become calendar days here, in
 * the reader's zone, and nowhere else — the calculations in `progress.ts` only
 * ever see days.
 *
 * What leaves: the dashboard gets numbers, and the names of the space's groups
 * and current members (display names, never an address). Task titles leave only
 * in the export a member asks for — the same words they can already read on the
 * Board.
 */

type Q = typeof query;

/** What arrives in the address. Anything missing or unreadable falls back to All Time, all groups, everyone, UTC. */
export interface ProgressParams {
  period?: unknown; from?: unknown; to?: unknown; group?: unknown; member?: unknown; tz?: unknown;
}

export interface SpaceInfo { id: string; name: string; role: BoardRole; archived: boolean }

/** A task for the export: what Progress counts, and the words a spreadsheet shows. */
export interface ExportTask extends ProgressTask { title: string }

export interface Snapshot {
  space: SpaceInfo;
  /** Current members, in the order they joined — never by how much they did. */
  members: PersonView[];
  groups: GroupView[];
  tasks: ExportTask[];
  today: string;
  timeZone: string;
  /** The database's clock. */
  nowMs: number;
}

/** The space as Progress reads it. Task titles only when an export will show them; the dashboard never sends them. */
async function readSpace(q: Q, userId: string, boardId: unknown, rawZone: unknown, titles: boolean): Promise<Snapshot> {
  const access = await requireBoard(q, userId, boardId);
  const id = access.boardId;
  const timeZone = canonicalZone(rawZone) ?? "UTC";
  const [space] = await q<{ name: string; now: number }>(
    `select name, (extract(epoch from now()) * 1000)::float8 as now from together_boards where id = $1`, [id]);
  const members = await q<PersonView>(
    `select u.id::text as id, ${DISPLAY_NAME} as name
       from together_members m join users u on u.id = m.user_id left join profiles p on p.id = u.id
      where m.board_id = $1 order by m.joined_at, m.user_id`, [id]);
  const groups = await q<GroupView>(
    `select id::text as id, name from together_groups where board_id = $1 order by lower(name), name, id`, [id]);
  const rows = await q<{ id: string; title: string; stage: Stage; groupId: string | null; effort: number | null;
    dueOn: string | null; created: number; moved: number; inHistory: boolean }>(
    `select t.id::text as id, ${titles ? "t.title" : "''"} as title, t.stage, t.group_id::text as "groupId", t.effort::float8 as effort,
            t.due_on::text as "dueOn", (extract(epoch from t.created_at) * 1000)::float8 as created,
            (extract(epoch from t.moved_at) * 1000)::float8 as moved, (${IN_HISTORY}) as "inHistory"
       from together_tasks t where t.board_id = $1 and t.deleted_at is null
      order by t.created_at, t.id`, [id]);
  const assigned = await q<{ taskId: string; userId: string }>(
    `select task_id::text as "taskId", user_id::text as "userId" from together_task_assignees
      where board_id = $1 order by assigned_at, user_id`, [id]);
  const byTask = new Map<string, string[]>();
  for (const a of assigned) byTask.set(a.taskId, [...(byTask.get(a.taskId) ?? []), a.userId]);
  const day = (ms: number) => instantToZoned(ms, timeZone).date;
  return {
    space: { id, name: space.name, role: access.role, archived: access.archived },
    members, groups, timeZone, nowMs: space.now, today: day(space.now),
    tasks: rows.map((r) => ({
      id: r.id, title: r.title, stage: r.stage, groupId: r.groupId, effort: r.effort, dueOn: r.dueOn,
      assignees: byTask.get(r.id) ?? [],
      createdOn: day(r.created),
      // The only completion date there is: when it most recently entered Done, and only while it is there.
      completedOn: r.stage === "done" ? day(r.moved) : null,
      inHistory: r.inHistory,
    })),
  };
}

export interface Dropped { group: boolean; member: boolean }

/**
 * The filters an address asks for, checked against the space. A group or a
 * member that is no longer there — a group deleted, someone who left — is
 * dropped and said so (`dropped`), widening the view rather than emptying it.
 * A custom range that is not two real dates is refused.
 */
export function filtersFor(snap: Pick<Snapshot, "today" | "groups" | "members">, raw: ProgressParams): { filters: ReportFilters; dropped: Dropped } {
  const period = resolvePeriod(isPeriodKind(raw.period) ? raw.period : "all", snap.today, raw.from, raw.to);
  if (!period) throw new TogetherError("periodInvalid");
  const dropped: Dropped = { group: false, member: false };
  let group: GroupFilter = filterParam(raw.group);
  if (group !== "all" && group !== "none" && !snap.groups.some((g) => g.id === group)) { group = "all"; dropped.group = true; }
  let member: MemberFilter = filterParam(raw.member);
  if (member !== "all" && member !== "none" && !snap.members.some((m) => m.id === member)) { member = "all"; dropped.member = true; }
  return { filters: { period, group, member }, dropped };
}

export interface ProgressView {
  space: SpaceInfo;
  members: PersonView[];
  groups: GroupView[];
  /** The filters as applied — after any stale group or member was dropped. */
  filters: ReportFilters;
  dropped: Dropped;
  today: string;
  timeZone: string;
  /** Live tasks in the whole space, whatever the filters — so "no work yet" is told apart from "none here". */
  spaceTasks: number;
  /** When the space's work began, the selection's last completion, and completions this month. */
  context: ProjectContext;
  report: ProgressReport;
}

export async function loadProgress(userId: string, boardId: unknown, raw: ProgressParams): Promise<ProgressView> {
  return transaction(async (q) => {
    const snap = await readSpace(q, userId, boardId, raw.tz, false);
    const { filters, dropped } = filtersFor(snap, raw);
    const report = buildReport(snap.tasks, filters, snap.today, snap.members.map((m) => m.id), snap.groups.map((g) => g.id));
    const selected = snap.tasks.filter((x) => matchesGroup(x, filters.group) && matchesMember(x, filters.member));
    return { space: snap.space, members: snap.members, groups: snap.groups, filters, dropped,
      today: snap.today, timeZone: snap.timeZone, spaceTasks: snap.tasks.length,
      context: contextOf(snap.tasks, selected, snap.today), report };
  });
}

/** One task in a drill-down: what a member (or nobody) is assigned, as the dashboard counts it. */
export interface DrillTask {
  id: string;
  title: string;
  groupId: string | null;
  stage: Stage;
  inHistory: boolean;
  effort: number | null;
  dueOn: string | null;
  completedOn: string | null;
  /** How the task counts in the period: completed, or still open at its end. */
  standing: "completed" | "open";
  /** Others are assigned too. */
  shared: boolean;
}

/**
 * The committed tasks behind one row of Individual contributions — a member's
 * (`who` = their id) or the unassigned work (`who` = "none") — for exactly the
 * dashboard's other filters, open work first, then the most recently finished.
 * Members only; a `who` that is not a current member of this space is answered
 * with nothing (never another space's data). Titles leave here because the
 * member asked to see the tasks, as they could on the Board.
 */
export async function loadProgressTasks(userId: string, boardId: unknown,
  raw: ProgressParams & { who?: unknown }): Promise<{ tasks: DrillTask[]; dropped: boolean }> {
  return transaction(async (q) => {
    const snap = await readSpace(q, userId, boardId, raw.tz, true);
    const { filters } = filtersFor(snap, { ...raw, member: undefined });
    const who = filterParam(raw.who);
    if (who === "all" || (who !== "none" && !snap.members.some((m) => m.id === who))) return { tasks: [], dropped: true };
    const known = new Set(snap.members.map((m) => m.id));
    const tasks: DrillTask[] = [];
    for (const t of snap.tasks) {
      if (!matchesGroup(t, filters.group)) continue;
      const people = t.assignees.filter((id) => known.has(id));
      if (who === "none" ? people.length > 0 : !people.includes(who)) continue;
      const s = standing(t, filters.period);
      if (s !== "completed" && s !== "open") continue;
      tasks.push({ id: t.id, title: t.title, groupId: t.groupId, stage: t.stage, inHistory: t.inHistory, effort: t.effort,
        dueOn: t.dueOn, completedOn: t.completedOn, standing: s, shared: people.length > 1 });
    }
    tasks.sort((a, b) => (a.standing === b.standing
      ? (a.standing === "completed" ? (b.completedOn ?? "").localeCompare(a.completedOn ?? "") : 0)
      : a.standing === "open" ? -1 : 1));
    return { tasks, dropped: false };
  });
}

export type ExportScope = "view" | "all";

export interface ExportFile {
  body: Buffer;
  /** The file's name, which may hold the space's own words, and a plain-ASCII one for old browsers. */
  filename: string;
  asciiName: string;
  scope: ExportScope;
  /** How many tasks the workbook lists — for the audit event, which carries counts only. */
  tasks: number;
}

/**
 * The Excel workbook: the current view (exactly the dashboard's filters) or the
 * entire project (All Time, all groups, everyone). The space is read in one
 * transaction; the workbook is built after it, so compressing a large file never
 * holds a database connection.
 */
export async function exportProgress(userId: string, boardId: unknown, raw: ProgressParams & { scope?: unknown },
  locale: Locale): Promise<ExportFile> {
  const scope: ExportScope = raw.scope === "all" ? "all" : "view";
  const { snap, filters } = await transaction(async (q) => {
    const read = await readSpace(q, userId, boardId, raw.tz, true);
    return {
      snap: read,
      filters: scope === "all"
        ? { period: { kind: "all", from: null, to: null }, group: "all", member: "all" } as ReportFilters
        : filtersFor(read, raw).filters,
    };
  });
  return { scope, ...progressWorkbook(snap, filters, scope, locale) };
}
