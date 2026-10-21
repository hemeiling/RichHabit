import { query } from "@/lib/db/pool";
import { isSchemaBehind } from "@/lib/db/diagnose";
import { importantDatesOf } from "@/lib/db/queries";
import { upcomingItems } from "@/lib/calendar";
import { viewerToday } from "@/lib/community";
import { DISPLAY_NAME, togetherAccess } from "@/lib/together/access";
import { pendingConnectionCount, pendingConnectionsFor } from "@/lib/together/connections";
import { pendingCount, pendingFor } from "@/lib/together/invitations";
import { canonicalZone } from "@/lib/zonedTime";
import {
  DEFAULT_PREFS, compareUpcoming, lastUpcomingDay,
  type ActivityItem, type Lead, type NotificationCenter, type NotificationPrefs, type UpcomingItem, type WaitingInvitation,
} from "@/lib/notifications/model";

/**
 * The Notification Center's server side: one service for every dated feature.
 *
 * - **Upcoming** is derived live from each source table, in the reader's zone —
 *   nothing is stored for it, so it is never stale. Each source is one adapter
 *   below; a new dated feature adds one.
 * - **Notices** (`notifications`) are written only for what someone did that
 *   needs you (an assignment, written in the same transaction) and for
 *   reminders that came due (lib/notifications/reminders). Each has a
 *   `dedupe_key` unique per person, so writing one twice is a no-op.
 * - **No words are stored.** A notice names its source by id; its title is read
 *   live, and a notice whose source is gone, finished or no longer yours to see
 *   is simply not shown — nor counted — and is swept later.
 * - **Ownership is server-side.** Every read starts from the session's user id;
 *   Together reads require current membership (an assignment cannot outlive it —
 *   the schema cascades) and a live space.
 *
 * A database not yet at step 23 reads as "no notices yet": the bell, Upcoming
 * and assignments keep working, so a deploy before the migration is safe.
 */

type Q = typeof query;

/** A read that tolerates a database not yet migrated (no notification tables): the fallback. */
export async function tolerant<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { if (isSchemaBehind(e)) return fallback; throw e; }
}

/* -------------------------------- settings --------------------------------- */

const clock = (v: unknown) => (typeof v === "string" ? v.slice(0, 5) : null);

export async function prefsOf(userId: string, q: Q = query): Promise<NotificationPrefs> {
  return tolerant(DEFAULT_PREFS, async () => {
    const [r] = await q<any>(`select * from notification_preferences where user_id = $1`, [userId]);
    if (!r) return DEFAULT_PREFS;
    return {
      togetherAssigned: r.together_assigned, togetherDue: r.together_due,
      importantDates: r.important_dates, importantDateLead: Number(r.important_date_lead) as Lead,
      priorities: r.priorities, habits: r.habits,
      morningTime: clock(r.morning_time) ?? DEFAULT_PREFS.morningTime,
      daytimeTime: clock(r.daytime_time) ?? DEFAULT_PREFS.daytimeTime,
      nighttimeTime: clock(r.nighttime_time) ?? DEFAULT_PREFS.nighttimeTime,
      timeZone: r.time_zone ?? null,
    };
  });
}

/** The reader's zone: the one saved in their settings, else this browser's, else UTC. */
export const zoneFor = (prefs: NotificationPrefs, raw: unknown): string => prefs.timeZone ?? canonicalZone(raw) ?? "UTC";

/**
 * The first time an account opens the app with notifications, its zone is
 * taken from the browser — once. After that only Account settings change it,
 * so travelling, or a second device elsewhere, never moves anyone's reminders.
 */
export async function adoptZone(userId: string, raw: unknown): Promise<void> {
  const zone = canonicalZone(raw);
  if (!zone) return;
  await tolerant(undefined, async () => {
    await query(
      `insert into notification_preferences (user_id, time_zone) values ($1, $2)
       on conflict (user_id) do update set time_zone = excluded.time_zone, updated_at = now()
        where notification_preferences.time_zone is null`, [userId, zone]);
  });
}

/* ------------------------------ Upcoming: sources --------------------------- */

/** Important Dates: each event's next occurrence, by the calendar's own recurrence (exclusions and ends included). */
async function upcomingDates(userId: string, today: string, zone: string): Promise<UpcomingItem[]> {
  const last = lastUpcomingDay(today);
  return upcomingItems(await importantDatesOf(userId), today, zone)
    .filter((i) => i.startDate <= last)
    .map((i) => {
      const started = i.startDate < today;   // a multi-day occurrence already under way
      return {
        key: `date:${i.sourceId}:${i.occurrenceDate}`, category: "dates" as const, title: i.title,
        date: started ? today : i.startDate, time: i.allDay || started ? null : i.startTime, overdue: false,
        context: null, count: 1, href: `/priorities?event=${i.sourceId}&on=${i.occurrenceDate}`, notificationId: null,
      };
    });
}

/** Planned Priorities: open ones with a planned day up to a month ahead — and those whose day has passed. */
async function upcomingPriorities(userId: string, today: string): Promise<UpcomingItem[]> {
  const rows = await query<{ id: string; body: string; planned: string }>(
    `select id::text as id, body, planned_on::text as planned from priorities
      where user_id = $1 and completed_on is null and planned_on is not null and planned_on <= $2::date
      order by planned_on limit 200`, [userId, lastUpcomingDay(today)]);
  return rows.map((r) => ({
    key: `priority:${r.id}`, category: "priorities" as const, title: r.body, date: r.planned, time: null,
    overdue: r.planned < today, context: null, count: 1, href: `/priorities?priority=${r.id}`, notificationId: null,
  }));
}

/** Together: open committed tasks assigned to you, with a due date, in live spaces you are still in. */
async function upcomingTasks(userId: string, today: string): Promise<UpcomingItem[]> {
  const rows = await query<{ id: string; title: string; due: string; boardId: string; space: string }>(
    `select t.id::text as id, t.title, t.due_on::text as due, t.board_id::text as "boardId", b.name as space
       from together_task_assignees a
       join together_tasks t on t.id = a.task_id and t.board_id = a.board_id
       join together_boards b on b.id = t.board_id
      where a.user_id = $1 and t.deleted_at is null and b.archived_at is null
        and t.stage in ('todo', 'doing', 'waiting') and t.due_on is not null and t.due_on <= $2::date
      order by t.due_on limit 200`, [userId, lastUpcomingDay(today)]);
  return rows.map((r) => ({
    key: `task:${r.id}`, category: "together" as const, title: r.title, date: r.due, time: null,
    overdue: r.due < today, context: r.space, count: 1, href: `/together/b/${r.boardId}?task=${r.id}`, notificationId: null,
  }));
}

/* --------------------------------- Activity --------------------------------- */

/**
 * Assignment notices you can still act on: the task exists, is not deleted, is
 * still assigned to you, in a space that is live — anything else is neither
 * shown nor counted. `$1` is the reader.
 */
const LIVE_ASSIGNMENT = `n.user_id = $1 and n.category = 'activity' and n.kind = 'task_assigned'
  and exists (select 1 from together_tasks t join together_boards b on b.id = t.board_id
               join together_task_assignees a on a.task_id = t.id and a.user_id = n.user_id
              where t.id = n.source_id and t.board_id = n.board_id and t.deleted_at is null and b.archived_at is null)`;

async function activityOf(userId: string): Promise<ActivityItem[]> {
  return tolerant([], async () => {
    const rows = await query<{ id: string; taskId: string; boardId: string; title: string; space: string;
      actor: string | null; at: string; read: boolean }>(
      `select n.id::text as id, n.source_id::text as "taskId", n.board_id::text as "boardId", t.title, b.name as space,
              (select ${DISPLAY_NAME} from together_members m join users u on u.id = m.user_id left join profiles p on p.id = u.id
                where m.board_id = n.board_id and m.user_id = n.actor_id) as actor,
              n.notify_at as at, n.read_at is not null as read
         from notifications n join together_tasks t on t.id = n.source_id join together_boards b on b.id = n.board_id
        where ${LIVE_ASSIGNMENT}
        order by n.notify_at desc, n.id desc limit 30`, [userId]);
    return rows.map((r) => ({
      id: r.id, kind: "task_assigned" as const, title: r.title, context: r.space, actor: r.actor,
      at: new Date(r.at).toISOString(), href: `/together/b/${r.boardId}?task=${r.taskId}`, unread: !r.read,
    }));
  });
}

async function invitationsOf(userId: string): Promise<WaitingInvitation[]> {
  const [connections, spaces] = await Promise.all([pendingConnectionsFor(userId), pendingFor(userId)]);
  return [
    ...connections.map((c) => ({ kind: "connection" as const, ...c })),
    ...spaces.map((i) => ({ kind: "space" as const, ...i })),
  ];
}

/* ------------------------------- the center --------------------------------- */

/** Extra Upcoming sources and reminder marks (Stage 2 plugs in here). */
export interface CenterExtras {
  upcoming?: UpcomingItem[];
  /** Upcoming item key → the unread reminder notice for it. */
  reminders?: Map<string, string>;
}

export async function centerFor(userId: string, rawZone: unknown,
  extras?: (prefs: NotificationPrefs, today: string, zone: string) => Promise<CenterExtras>): Promise<NotificationCenter> {
  const prefs = await prefsOf(userId);
  const zone = zoneFor(prefs, rawZone);
  const today = viewerToday(zone);
  const together = (await togetherAccess(userId)) !== null;
  const [dates, priorities, tasks, activity, invitations, more] = await Promise.all([
    upcomingDates(userId, today, zone),
    upcomingPriorities(userId, today),
    together ? upcomingTasks(userId, today) : Promise.resolve([]),
    together ? activityOf(userId) : Promise.resolve([]),
    together ? invitationsOf(userId) : Promise.resolve([]),
    extras ? extras(prefs, today, zone) : Promise.resolve({} as CenterExtras),
  ]);
  const upcoming = [...dates, ...priorities, ...tasks, ...(more.upcoming ?? [])]
    .map((i) => ({ ...i, notificationId: more.reminders?.get(i.key) ?? null }))
    .sort(compareUpcoming);
  const unread = activity.filter((a) => a.unread).length + invitations.length
    + upcoming.filter((i) => i.notificationId !== null).length;
  return { today, timeZone: zone, upcoming, activity, invitations, unread };
}

/**
 * The badge, cheaply: unread assignment notices you can still act on, waiting
 * invitations, and (from Stage 2) unread reminders that are still relevant.
 */
export async function unreadCount(userId: string, reminders: (userId: string) => Promise<number> = async () => 0): Promise<number> {
  const together = (await togetherAccess(userId).catch(() => null)) !== null;
  const activity = together
    ? await tolerant(0, async () => (await query<{ n: number }>(
      `select count(*)::int n from notifications n where ${LIVE_ASSIGNMENT} and n.read_at is null`, [userId]))[0].n)
    : 0;
  const waiting = together ? (await pendingCount(userId).catch(() => 0)) + (await pendingConnectionCount(userId).catch(() => 0)) : 0;
  return activity + waiting + await reminders(userId);
}

/** Marks some of your notices read — or all of them. Only ever your own. */
export async function markRead(userId: string, ids: unknown): Promise<number> {
  return tolerant(0, async () => {
    if (ids === "all") {
      return (await query(`update notifications set read_at = now() where user_id = $1 and read_at is null returning id`, [userId])).length;
    }
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200) : [];
    if (!list.length) return 0;
    return (await query(
      `update notifications set read_at = now() where user_id = $1 and id = any($2::uuid[]) and read_at is null returning id`,
      [userId, list])).length;
  });
}

/* ------------------------------- assignments -------------------------------- */

/**
 * "You were assigned …" — written inside the assignment's own transaction, for
 * the people just added (never the person doing it). One notice per person per
 * task: being assigned the same task again brings that notice back to the top,
 * unread, rather than adding another. A savepoint keeps a database without the
 * table (deploy before migration) from failing the assignment itself.
 */
export async function recordAssignments(q: Q, actorId: string, boardId: string, taskId: string, added: string[]): Promise<void> {
  const people = [...new Set(added)].filter((id) => id !== actorId);
  if (!people.length) return;
  await q(`savepoint notify_assigned`);
  try {
    await q(
      `insert into notifications (user_id, category, kind, source_type, source_id, board_id, actor_id, dedupe_key, notify_at)
       select u, 'activity', 'task_assigned', 'together_task', $1, $2, $3, $5, now()
         from unnest($4::uuid[]) as u
       on conflict (user_id, dedupe_key) do update
         set read_at = null, notify_at = now(), actor_id = excluded.actor_id`,
      [taskId, boardId, actorId, people, `assign:${taskId}`]);
    await q(`release savepoint notify_assigned`);
  } catch (e) {
    await q(`rollback to savepoint notify_assigned`);
    if (!isSchemaBehind(e)) throw e;
  }
}
