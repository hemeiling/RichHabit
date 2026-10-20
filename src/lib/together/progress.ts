import { addDays, addMonths, daysBetween, daysInMonth, monthFirst, monthOf, weekStart } from "@/lib/dates";
import { dueState, isDueDate } from "@/lib/together/due";
import type { Stage } from "@/lib/together/stages";

/**
 * Together — Project Progress & Contributions (项目进展与贡献): the numbers a
 * space's members see about their shared work. The dashboard and the Excel
 * export are both built from this one module, so they cannot disagree. It is
 * pure — no database, no clock, no time zone of its own — so the server and the
 * browser can share it, and every rule below is tested on plain data.
 *
 * ## What the data can honestly say
 *
 * A task keeps when it was created (`created_at`, never changed), its stage, and
 * when it entered that stage (`moved_at`). Nothing else about its past is
 * recorded, so nothing else is claimed:
 *
 * - **Completed** means in Done now — the Board's Done or History. Its completion
 *   date is when it most recently entered Done. A task reopened since is not
 *   completed; that it once was is not recorded anywhere, and is not guessed.
 * - **Committed** means anywhere but the Backlog. When a task left the Backlog is
 *   not recorded, so commitment is read from the stage it is in now.
 * - **Contributions are assigned work.** Who marked a task Done is not recorded,
 *   so a task counts for the people assigned to it now. Someone who has left the
 *   space took their assignments with them (the schema cascades), so their
 *   finished work shows under whoever else had it, or as unassigned.
 * - Deleted tasks (Recently deleted) count nowhere.
 *
 * ## Periods
 *
 * A period is a span of calendar days in the reader's time zone; the server
 * turns timestamps into those days before anything here sees them. A task is in
 * play during a period when it was created on or before the period's last day
 * and not completed before its first. Of those:
 *
 *   - completed within the period → **completed**;
 *   - in the Backlog              → **backlog** (shown apart, never in the rate);
 *   - everything else             → **open** at the period's end — still to do,
 *                                   or finished only after it.
 *
 * Committed = completed + open; the completion rate is completed ÷ committed.
 * All Time is the period without ends: every task. Trends count completions by
 * completion date. Open work by stage, due soon and overdue describe right now
 * whatever the period, because a past stage is exactly what is not recorded.
 *
 * ## Story points
 *
 * A task's `effort` is its estimate in story points. Without one it counts as 1
 * (DEFAULT_POINTS) — worked out here and never written back, so the stored value
 * stays exactly what someone chose and "not estimated" stays visible. `??`, not
 * `||`: an explicit 0, should one ever be allowed, stays 0.
 *
 * ## Counting once
 *
 * Project totals count each task and its points once, however many people share
 * it. Contributions credit each assignee with the whole task and mark it shared,
 * so people's figures overlap and are never added up into a team total.
 */

export const DEFAULT_POINTS = 1;

/** A task's story points: its estimate, or the default when it has none. */
export const effectivePoints = (effort: number | null | undefined): number => effort ?? DEFAULT_POINTS;

/** A task as Progress reads it: no words, only what the numbers need. */
export interface ProgressTask {
  id: string;
  stage: Stage;
  groupId: string | null;
  /** The stored estimate; null when nobody set one. */
  effort: number | null;
  /** The reader's calendar date it was created. */
  createdOn: string;
  /** The reader's calendar date it most recently entered Done; null unless it is in Done. */
  completedOn: string | null;
  /** A calendar date, YYYY-MM-DD. */
  dueOn: string | null;
  /** Current members assigned to it, in assignment order. */
  assignees: string[];
  /** Done for more than a day — what the space shows in History. */
  inHistory: boolean;
}

/* -------------------------------- periods ---------------------------------- */

export const PERIOD_KINDS = ["all", "month", "3m", "quarter", "year", "custom"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];
export const isPeriodKind = (v: unknown): v is PeriodKind => typeof v === "string" && (PERIOD_KINDS as readonly string[]).includes(v);

/** Inclusive calendar days; a null end is open (All Time has neither). */
export interface Period { kind: PeriodKind; from: string | null; to: string | null }

const monthEnd = (month: string) => `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
/** The same day `n` months back, clamped to the shorter month (May 31 → Feb 28). */
const monthsBack = (date: string, n: number) => {
  const month = addMonths(monthOf(date), -n);
  return `${month}-${String(Math.min(Number(date.slice(8, 10)), daysInMonth(month))).padStart(2, "0")}`;
};

/**
 * A period's days, from the reader's `today`. Calendar periods are whole
 * (This Month runs to the month's last day — nothing can be finished in its
 * future, so that changes no number); Last 3 Months is the three months up to
 * and including today. A custom range needs two real dates and is put in order;
 * anything else is null, for the caller to refuse.
 */
export function resolvePeriod(kind: PeriodKind, today: string, from?: unknown, to?: unknown): Period | null {
  const month = monthOf(today);
  const year = today.slice(0, 4);
  switch (kind) {
    case "all": return { kind, from: null, to: null };
    case "month": return { kind, from: monthFirst(month), to: monthEnd(month) };
    case "3m": return { kind, from: addDays(monthsBack(today, 3), 1), to: today };
    case "quarter": {
      const first = Math.floor((Number(month.slice(5)) - 1) / 3) * 3 + 1;
      const start = `${year}-${String(first).padStart(2, "0")}`;
      return { kind, from: monthFirst(start), to: monthEnd(addMonths(start, 2)) };
    }
    case "year": return { kind, from: `${year}-01-01`, to: `${year}-12-31` };
    case "custom": {
      if (!isDueDate(from) || !isDueDate(to)) return null;
      return from <= to ? { kind, from, to } : { kind, from: to, to: from };
    }
  }
}

export type Standing = "completed" | "open" | "backlog";

/** Where a task stands in a period, or null when it was not in play during it. */
export function standing(task: ProgressTask, period: Period): Standing | null {
  if (period.to && task.createdOn > period.to) return null;
  if (task.completedOn) {
    if (period.from && task.completedOn < period.from) return null;
    return !period.to || task.completedOn <= period.to ? "completed" : "open";
  }
  return task.stage === "backlog" ? "backlog" : "open";
}

/* -------------------------------- filters ---------------------------------- */

/** All groups, one group's id, or "none" — the tasks without a group. */
export type GroupFilter = "all" | "none" | string;
/** Everyone, one member's id, or "none" — the tasks nobody is assigned to. */
export type MemberFilter = "all" | "none" | string;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A group or member filter as it arrives in an address: "none", an id, or —
 * for anything else, absent included — "all". Whether the id names a group or
 * member of this space is the caller's to check; a stale one (a deleted group,
 * someone who left) must widen the view, never empty it silently.
 */
export const filterParam = (raw: unknown): "all" | "none" | string =>
  raw === "none" ? "none" : typeof raw === "string" && UUID.test(raw) ? raw.toLowerCase() : "all";

export function matchesGroup(task: Pick<ProgressTask, "groupId">, group: GroupFilter): boolean {
  if (group === "all") return true;
  return group === "none" ? task.groupId === null : task.groupId === group;
}

export function matchesMember(task: Pick<ProgressTask, "assignees">, member: MemberFilter): boolean {
  if (member === "all") return true;
  return member === "none" ? task.assignees.length === 0 : task.assignees.includes(member);
}

/* ------------------------------ the numbers -------------------------------- */

export interface Tally { tasks: number; points: number }
const tally = (): Tally => ({ tasks: 0, points: 0 });
const add = (t: Tally, task: ProgressTask) => { t.tasks += 1; t.points += effectivePoints(task.effort); };
/** A share, or null when there is nothing to divide by — shown as "—", never as 0%. */
export const rateOf = (done: number, of: number): number | null => (of > 0 ? done / of : null);

export interface Totals {
  committed: Tally;
  completed: Tally;
  open: Tally;
  backlog: Tally;
  /** Completed ÷ committed tasks, or null when nothing was committed. */
  rate: number | null;
  /** Committed tasks with no estimate, counted at DEFAULT_POINTS each. */
  defaulted: number;
  /** Backlog tasks with no estimate. */
  backlogDefaulted: number;
}

export function totalsOf(tasks: ProgressTask[], period: Period): Totals {
  const t: Totals = { committed: tally(), completed: tally(), open: tally(), backlog: tally(), rate: null, defaulted: 0, backlogDefaulted: 0 };
  for (const task of tasks) {
    const s = standing(task, period);
    if (s === null) continue;
    if (s === "backlog") {
      add(t.backlog, task);
      if (task.effort === null) t.backlogDefaulted += 1;
      continue;
    }
    add(t.committed, task);
    add(s === "completed" ? t.completed : t.open, task);
    if (task.effort === null) t.defaulted += 1;
  }
  t.rate = rateOf(t.completed.tasks, t.committed.tasks);
  return t;
}

/** Open committed work right now, by stage, and how much of it is due soon (within a week) or overdue. */
export interface OpenNow { todo: Tally; doing: Tally; waiting: Tally; dueSoon: number; overdue: number }

export function openNow(tasks: ProgressTask[], today: string): OpenNow {
  const now: OpenNow = { todo: tally(), doing: tally(), waiting: tally(), dueSoon: 0, overdue: 0 };
  for (const task of tasks) {
    if (task.stage !== "todo" && task.stage !== "doing" && task.stage !== "waiting") continue;
    add(now[task.stage], task);
    if (!task.dueOn) continue;
    const state = dueState(task.dueOn, today);
    if (state === "overdue") now.overdue += 1;
    else if (state !== "later") now.dueSoon += 1;
  }
  return now;
}

export interface GroupRow {
  /** null: the tasks without a group. */
  groupId: string | null;
  committed: Tally;
  completed: Tally;
  backlog: Tally;
  rate: number | null;
}

/**
 * The same totals per group, in the order given, then the tasks without one.
 * Groups partition the tasks, so the rows add up to the project's totals.
 * A task naming a group that is not listed (it cannot happen — deleting a group
 * clears it from its tasks — but the read is not atomic with the list) counts
 * as ungrouped rather than vanishing.
 */
export function byGroup(tasks: ProgressTask[], period: Period, groupIds: string[]): GroupRow[] {
  const known = new Set(groupIds);
  const buckets = new Map<string | null, ProgressTask[]>([...groupIds.map((id) => [id, []] as [string, ProgressTask[]]), [null, []]]);
  for (const task of tasks) buckets.get(task.groupId !== null && known.has(task.groupId) ? task.groupId : null)!.push(task);
  return [...buckets].map(([groupId, list]) => {
    const t = totalsOf(list, period);
    return { groupId, committed: t.committed, completed: t.completed, backlog: t.backlog, rate: t.rate };
  });
}

export interface ContributionRow {
  /** null: committed work nobody is assigned to. */
  memberId: string | null;
  /** Committed tasks assigned to them that were in play in the period. */
  assigned: Tally;
  /** Of those, the ones completed in the period — "completed assigned work". */
  completed: Tally;
  rate: number | null;
  /** How many of their assigned tasks are shared with someone else. */
  shared: number;
  /** How many of their completed assigned tasks were shared. */
  sharedCompleted: number;
}

/**
 * Assigned work per member. Every assignee is credited with the whole task —
 * its full points — and a task with more than one assignee is counted as shared
 * for each of them. So rows overlap by design and must not be summed: the
 * project's totals, which count each task once, are `totalsOf`. Backlog tasks
 * are ideas, not commitments, and are left out, as in the completion rate.
 * The unassigned row (memberId null) is committed work with nobody on it.
 */
export function contributionsOf(tasks: ProgressTask[], period: Period, memberIds: string[]): ContributionRow[] {
  const rows = new Map<string | null, ContributionRow>(
    [...memberIds, null].map((id) => [id, { memberId: id, assigned: tally(), completed: tally(), rate: null, shared: 0, sharedCompleted: 0 }]));
  for (const task of tasks) {
    const s = standing(task, period);
    if (s === null || s === "backlog") continue;
    const people = task.assignees.filter((id) => rows.has(id));
    const shared = people.length > 1;
    for (const row of people.length ? people.map((id) => rows.get(id)!) : [rows.get(null)!]) {
      add(row.assigned, task);
      if (shared) row.shared += 1;
      if (s === "completed") {
        add(row.completed, task);
        if (shared) row.sharedCompleted += 1;
      }
    }
  }
  for (const row of rows.values()) row.rate = rateOf(row.completed.tasks, row.assigned.tasks);
  return [...rows.values()];
}

/* -------------------------------- trends ----------------------------------- */

export type Granularity = "week" | "month";

export interface TrendBucket {
  /** First and last day of the bucket inside the span (the ends are clipped to it). */
  start: string;
  end: string;
  tasks: number;
  points: number;
  /** Running totals from the first bucket. */
  cumTasks: number;
  cumPoints: number;
}

/**
 * The days a trend covers: the period, from the space's first task when the
 * period has no start, and never past today — nothing is finished in the
 * future, so later buckets could only ever be empty. Null when there is nothing
 * to chart (no work yet, or a period that lies entirely in the future).
 */
export function trendSpan(period: Period, today: string, firstDay: string | null): { from: string; to: string } | null {
  const from = period.from ?? firstDay;
  if (!from) return null;
  const to = period.to && period.to < today ? period.to : today;
  return from <= to ? { from, to } : null;
}

/** Weekly for a span of up to about three months (14 bars at most), monthly beyond. */
export const granularityFor = (span: { from: string; to: string }): Granularity =>
  daysBetween(span.from, span.to) < 100 ? "week" : "month";

/** Completions per week (the app's Sunday-to-Saturday week) or per month, with running totals. */
export function trendOf(tasks: ProgressTask[], span: { from: string; to: string }, granularity: Granularity): TrendBucket[] {
  const keyOf = (date: string) => (granularity === "week" ? weekStart(date) : monthFirst(monthOf(date)));
  const next = (key: string) => (granularity === "week" ? addDays(key, 7) : monthFirst(addMonths(monthOf(key), 1)));
  const buckets: TrendBucket[] = [];
  const at = new Map<string, TrendBucket>();
  for (let key = keyOf(span.from); key <= span.to; key = next(key)) {
    const end = addDays(next(key), -1);
    const bucket = { start: key < span.from ? span.from : key, end: end > span.to ? span.to : end, tasks: 0, points: 0, cumTasks: 0, cumPoints: 0 };
    buckets.push(bucket);
    at.set(key, bucket);
  }
  for (const task of tasks) {
    if (!task.completedOn || task.completedOn < span.from || task.completedOn > span.to) continue;
    const bucket = at.get(keyOf(task.completedOn))!;
    bucket.tasks += 1;
    bucket.points += effectivePoints(task.effort);
  }
  let cumTasks = 0, cumPoints = 0;
  for (const b of buckets) {
    cumTasks += b.tasks; cumPoints += b.points;
    b.cumTasks = cumTasks; b.cumPoints = cumPoints;
  }
  return buckets;
}

/* -------------------------------- a report --------------------------------- */

export interface ReportFilters { period: Period; group: GroupFilter; member: MemberFilter }

export interface ProgressReport {
  totals: Totals;
  now: OpenNow;
  /** Every group (in the order given) and then the ungrouped tasks. */
  groups: GroupRow[];
  /** The members in the order given, then the unassigned row — or just the one the member filter names. */
  contributions: ContributionRow[];
  trend: { granularity: Granularity; buckets: TrendBucket[] };
  /** The day the oldest selected task was created — where All Time's trend starts ("since …"). */
  firstDay: string | null;
}

/** The whole dashboard for one set of filters. Everything is computed from the tasks the filters select. */
export function buildReport(all: ProgressTask[], filters: ReportFilters, today: string,
  memberIds: string[], groupIds: string[]): ProgressReport {
  const tasks = all.filter((x) => matchesGroup(x, filters.group) && matchesMember(x, filters.member));
  const firstDay = tasks.reduce<string | null>((min, x) => (min === null || x.createdOn < min ? x.createdOn : min), null);
  const span = trendSpan(filters.period, today, firstDay);
  const granularity = span ? granularityFor(span) : "month";
  const contributions = contributionsOf(tasks, filters.period, memberIds)
    .filter((row) => (filters.member === "all" ? true : filters.member === "none" ? row.memberId === null : row.memberId === filters.member));
  return {
    totals: totalsOf(tasks, filters.period),
    now: openNow(tasks, today),
    groups: byGroup(tasks, filters.period, groupIds),
    contributions,
    trend: { granularity, buckets: span ? trendOf(tasks, span, granularity) : [] },
    firstDay,
  };
}
