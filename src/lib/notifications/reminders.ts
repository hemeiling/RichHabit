import { query } from "@/lib/db/pool";
import { importantDatesOf, loadState } from "@/lib/db/queries";
import { importantDateItems } from "@/lib/calendar";
import { viewerToday } from "@/lib/community";
import { addDays } from "@/lib/dates";
import { frequencyOn, habitStatus, isScheduled } from "@/lib/habits";
import { togetherAccess } from "@/lib/together/access";
import { zonedToInstant } from "@/lib/zonedTime";
import { habitTime, type NotificationPrefs, type UpcomingItem } from "@/lib/notifications/model";
import { prefsOf, tolerant, zoneFor, type CenterExtras } from "@/lib/notifications/server";

/**
 * In-app reminders (Stage 2). Phase 1 has no background job: reminders that
 * have come due are written when the person opens RichHabit (or returns to the
 * tab), at most every few minutes — they are seen in the app, never pushed
 * while it is closed, so writing them on open gives exactly the feed a timer
 * would have produced.
 *
 * - **Times are the person's own**, in their saved zone (Account settings;
 *   first taken from the browser). Date-only items remind at a local clock time
 *   (the Morning time, 8:00 by default); a timed event also reminds at its
 *   start. `zonedToInstant` handles daylight saving.
 * - **No duplicates.** Each reminder's key is its source, occurrence and kind —
 *   never the zone or the instant — and the table refuses a second row with the
 *   same key. Changing time zone, two tabs, a retry: still one reminder.
 * - **Only what is still true counts.** A reminder is shown (as a dot on its
 *   Upcoming row) and counted only while that row exists on the same day: a
 *   priority completed or re-planned, a task finished or reassigned, an event
 *   deleted or that occurrence excluded, a habit already done — and it simply
 *   stops counting. Old rows are swept: read ones after 90 days, any after 180.
 * - **Habits respect their schedule.** Only habits whose reminder was switched
 *   on; only on days `isScheduled` says so; only while `habitStatus` is due or
 *   behind — so a flexible weekly or monthly habit gets no artificial deadline,
 *   and reminders stop once its target is met.
 */

/** Reminders whose time came up to this long ago are still written (someone away for a weekend still sees Friday's). */
const LOOKBACK_MS = 3 * 86_400_000;
/** Written at most this often per person. */
const THROTTLE_MS = 5 * 60_000;

interface Due {
  kind: string; sourceType: string; sourceId: string; boardId: string | null; occursOn: string; key: string; at: number;
  /** Still worth saying however long ago its time passed (an event not yet started). */
  stillAhead?: boolean;
}

/* ------------------------------ habits in Upcoming --------------------------- */

/**
 * Habits whose reminder is on, for today and tomorrow, as their schedule has
 * them — the only habits Upcoming shows. Today's drop out once done or on
 * track; flexible ones appear only on days they are due or behind. Loads the
 * account's habits only if at least one reminder is on.
 */
async function habitItems(userId: string, prefs: NotificationPrefs, today: string): Promise<UpcomingItem[]> {
  if (!prefs.habits) return [];
  const opted = await tolerant([] as { habitId: string; remindAt: string | null }[], () => query<{ habitId: string; remindAt: string | null }>(
    `select habit_id::text as "habitId", to_char(remind_at, 'HH24:MI') as "remindAt" from habit_reminders where user_id = $1`, [userId]));
  if (!opted.length) return [];
  const state = await loadState(userId);
  const out: UpcomingItem[] = [];
  for (const { habitId, remindAt } of opted) {
    const habit = state.habits.find((h) => h.id === habitId);
    if (!habit || !habit.active) continue;
    for (const date of [today, addDays(today, 1)]) {
      if (!isScheduled(state, habit, date)) continue;
      // A flexible (N times a week or month) habit has no fixed day: it is shown
      // only today, and only once every remaining day is needed (due) or more.
      const flexible = ["times", "month_times"].includes(frequencyOn(habit, date).mode);
      if (date !== today && flexible) continue;
      if (date === today) {
        const s = habitStatus(state, habit, today).status;
        if (s !== "due" && s !== "behind") continue;
      }
      out.push({
        key: `habit:${habitId}:${date}`, category: "habits", title: habit.name, date,
        time: habitTime(prefs, habit.category, remindAt), overdue: false, context: null, count: 1,
        href: "/habits", notificationId: null,
        habit: { templateKey: habit.templateKey ?? null, name: habit.name, rotation: habit.rotation ?? null, rotationStart: habit.rotationStart ?? null },
      });
    }
  }
  return out;
}

/* ------------------------------ what came due -------------------------------- */

async function dueReminders(userId: string, prefs: NotificationPrefs, zone: string, today: string, now: number): Promise<Due[]> {
  const out: Due[] = [];
  const at = (date: string, time: string) => zonedToInstant(date, time, zone);
  const from = addDays(today, -3);

  if (prefs.importantDates) {
    const lead = prefs.importantDateLead;
    for (const i of importantDateItems(await importantDatesOf(userId), from, addDays(today, lead + 1), zone)) {
      if (i.endDate < today) continue;   // over: nothing left to remind about
      // One "coming up" reminder per occurrence, whatever the lead: the key has
      // no lead in it, so changing the lead never writes a second one, and one
      // already seen is never repeated. Lengthening the lead past a reminder
      // time that slipped out of the lookback still gives the reminder (now)
      // while the event is ahead — rather than none at all.
      out.push({ kind: "date_upcoming", sourceType: "important_date", sourceId: i.sourceId, boardId: null, occursOn: i.occurrenceDate,
        key: `date:${i.sourceId}:${i.occurrenceDate}:ahead`, at: at(addDays(i.startDate, -lead), prefs.morningTime),
        stillAhead: i.startDate >= today });
      if (!i.allDay && i.startTime) {
        out.push({ kind: "date_start", sourceType: "important_date", sourceId: i.sourceId, boardId: null, occursOn: i.occurrenceDate,
          key: `date:${i.sourceId}:${i.occurrenceDate}:start`, at: at(i.startDate, i.startTime) });
      }
    }
  }
  if (prefs.priorities) {
    const rows = await query<{ id: string; planned: string }>(
      `select id::text as id, planned_on::text as planned from priorities
        where user_id = $1 and completed_on is null and planned_on between $2::date and $3::date`, [userId, addDays(today, -4), today]);
    for (const r of rows) {
      out.push({ kind: "priority_planned", sourceType: "priority", sourceId: r.id, boardId: null, occursOn: r.planned,
        key: `priority:${r.id}:${r.planned}:day`, at: at(r.planned, prefs.morningTime) });
      out.push({ kind: "priority_overdue", sourceType: "priority", sourceId: r.id, boardId: null, occursOn: r.planned,
        key: `priority:${r.id}:${r.planned}:overdue`, at: at(addDays(r.planned, 1), prefs.morningTime) });
    }
  }
  if (prefs.togetherDue && (await togetherAccess(userId)) !== null) {
    const rows = await query<{ id: string; boardId: string; due: string }>(
      `select t.id::text as id, t.board_id::text as "boardId", t.due_on::text as due
         from together_task_assignees a join together_tasks t on t.id = a.task_id and t.board_id = a.board_id
         join together_boards b on b.id = t.board_id
        where a.user_id = $1 and t.deleted_at is null and b.archived_at is null and t.stage in ('todo', 'doing', 'waiting')
          and t.due_on between $2::date and $3::date`, [userId, addDays(today, -4), today]);
    for (const r of rows) {
      out.push({ kind: "task_due", sourceType: "together_task", sourceId: r.id, boardId: r.boardId, occursOn: r.due,
        key: `task:${r.id}:${r.due}:due`, at: at(r.due, prefs.morningTime) });
      out.push({ kind: "task_overdue", sourceType: "together_task", sourceId: r.id, boardId: r.boardId, occursOn: r.due,
        key: `task:${r.id}:${r.due}:overdue`, at: at(addDays(r.due, 1), prefs.morningTime) });
    }
  }
  for (const h of await habitItems(userId, prefs, today)) {
    if (h.date !== today || !h.time) continue;
    const habitId = h.key.split(":")[1];
    out.push({ kind: "habit_due", sourceType: "habit", sourceId: habitId, boardId: null, occursOn: today,
      key: `habit:${habitId}:${today}`, at: at(today, h.time) });
  }
  return out.filter((d) => d.at <= now && (d.stillAhead || d.at > now - LOOKBACK_MS));
}

/**
 * Writes the reminders that have come due since the last visit — once each —
 * and sweeps old ones. Throttled per person; a database without the tables
 * does nothing.
 */
export async function materializeReminders(userId: string, rawZone: unknown, now = Date.now()): Promise<number> {
  return tolerant(0, async () => {
    const [row] = await query<{ last: number | null }>(
      `select (extract(epoch from materialized_at) * 1000)::float8 as last from notification_preferences where user_id = $1`, [userId]);
    if (row?.last && now - row.last < THROTTLE_MS) return 0;
    const prefs = await prefsOf(userId);
    const zone = zoneFor(prefs, rawZone);
    const today = viewerToday(zone, new Date(now));
    const due = await dueReminders(userId, prefs, zone, today, now);
    let written = 0;
    if (due.length) {
      const rows = await query(
        `insert into notifications (user_id, category, kind, source_type, source_id, board_id, occurs_on, dedupe_key, notify_at)
         select $1, 'reminder', d.kind, d.source_type, d.source_id::uuid, d.board_id::uuid, d.occurs_on::date, d.dedupe_key,
                to_timestamp(d.at / 1000.0)
           from jsonb_to_recordset($2::jsonb) as d(kind text, source_type text, source_id text, board_id text,
                                                   occurs_on text, dedupe_key text, at float8)
         on conflict (user_id, dedupe_key) do nothing returning id`,
        [userId, JSON.stringify(due.map((d) => ({ kind: d.kind, source_type: d.sourceType, source_id: d.sourceId,
          board_id: d.boardId, occurs_on: d.occursOn, dedupe_key: d.key, at: d.at })))]);
      written = rows.length;
    }
    await query(
      `insert into notification_preferences (user_id, materialized_at) values ($1, to_timestamp($2 / 1000.0))
       on conflict (user_id) do update set materialized_at = excluded.materialized_at`, [userId, now]);
    await query(
      `delete from notifications where user_id = $1
         and ((read_at is not null and read_at < to_timestamp($2 / 1000.0) - interval '90 days')
              or notify_at < to_timestamp($2 / 1000.0) - interval '180 days')`, [userId, now]);
    return written;
  });
}

/* ------------------------- reminders on Upcoming rows ------------------------ */

/** The Upcoming key a reminder belongs to — the same record, on the same day. */
function keyOf(r: { sourceType: string; sourceId: string; occursOn: string }): string {
  switch (r.sourceType) {
    case "important_date": return `date:${r.sourceId}:${r.occursOn}`;
    case "priority": return `priority:${r.sourceId}@${r.occursOn}`;
    case "together_task": return `task:${r.sourceId}@${r.occursOn}`;
    default: return `habit:${r.sourceId}:${r.occursOn}`;
  }
}
/** An Upcoming row's matching key: priorities and tasks match only while their day is unchanged. */
const rowKey = (i: UpcomingItem) => (i.category === "priorities" || i.category === "together" ? `${i.key}@${i.date}` : i.key);

/**
 * Habits for Upcoming, and the unread reminders that still belong to a row
 * there (one per row: the newest) — what the bell shows as dots and counts.
 */
export const reminderExtras = (userId: string) =>
  async (prefs: NotificationPrefs, today: string, _zone: string): Promise<CenterExtras> => {
    const upcoming = await habitItems(userId, prefs, today);
    const unread = await tolerant([] as { id: string; sourceType: string; sourceId: string; occursOn: string }[], () => query(
      `select id::text as id, source_type as "sourceType", source_id::text as "sourceId", occurs_on::text as "occursOn"
         from notifications where user_id = $1 and category = 'reminder' and read_at is null
        order by notify_at desc limit 500`, [userId]));
    // A kind switched off stops counting at once, even for reminders already written.
    const wanted: Record<string, boolean> = {
      important_date: prefs.importantDates, priority: prefs.priorities, together_task: prefs.togetherDue, habit: prefs.habits,
    };
    const byKey = new Map<string, string>();
    for (const r of unread) if (wanted[r.sourceType] && !byKey.has(keyOf(r))) byKey.set(keyOf(r), r.id);
    return { upcoming, reminders: byKey, rowKey };
  };
