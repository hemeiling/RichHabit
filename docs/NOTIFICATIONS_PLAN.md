# Unified Notifications & Upcoming Items / 统一通知中心与即将到来的事项

**Status (2026-10-22):** Stages 1 and 2 **built and tested locally**, with the PO's follow-ups (one Important Dates reminder per occurrence whatever the lead; accessible toggles). **Not pushed, not deployed; step 23 not applied to production.** Local full-runner rehearsal and the read-only production preflight passed; the Neon rehearsal scripts are dry-run and wait for the PO's fresh branch. See "As built" at the end for what differs from the proposal below.

**PO decisions of 2026-10-21:**
- **Default habit reminder times:** 8:00 AM Morning, 1:00 PM Daytime, 8:00 PM Nighttime, in the user's own time zone. These are editable suggestions; each habit's reminder stays opt-in.
- **Important Dates and planned Priorities:** always appear in Upcoming. In-app reminders are on by default and easy to turn off or retime.
- **Together:** use the existing task model; no story entity.
- **Out of the first release:** email and push.

## What exists today (production `784d97d`)

| Source | What is stored | Reusable logic |
|---|---|---|
| **Important Dates** | One row per event or series. Repeats by week, month or year (`repeat_unit`, `repeat_interval`, `repeat_until`, `excluded_on[]`). All-day, or a wall-clock time plus an IANA zone (`important_dates`). | `src/lib/recurrence.ts` (occurrences computed, never stored) and `src/lib/calendar.ts` `upcomingItems(events, today, viewerZone)`, which already returns the next occurrence per series. DST is handled in `src/lib/zonedTime.ts`. |
| **Priority Compass** | `planned_on` (a date, no time; often empty). Open while `completed_on` is null. | `src/lib/priorities.ts` (`isPlanOverdue`, `prioritiesOn`). |
| **Habits** | A schedule (daily, weekdays, every N days, N per week, N per month, dates of the month, with schedule versions) and a category (Morning, Daytime or Nighttime). There is no time-of-day field. | `src/lib/habits.ts` is pure, so the server can use it: `isScheduled` (is it scheduled on a date) and `habitStatus` (completed, due, behind or on_track). Community already uses it server-side. |
| **Together** | `together_tasks.due_on` (a date), assignees in `together_task_assignees`, plus soft delete, archived spaces and memberships. | Assignment is written in `updateTask` (`work.ts`, the `added … returning user_id` step). Access goes through `requireBoard` / `togetherAccess`. |
| **Notifications** | There is a header bell (`HeaderControls.tsx` `NotificationBell`), but it shows **only Together invitations**, only to Together accounts, with a count from the server layout. | The bell UI: a dropdown on desktop and a sheet on phones. |
| **Time zone** | No per-user zone is stored. The browser sends `x-rh-timezone` on every request, and the server derives "today" from it (`community.ts` `viewerToday`). | `zonedTime.ts`: `canonicalZone`, `zonedToInstant`, `instantToZoned`. |
| **Jobs** | `render.yaml` defines a single web service. There is no cron job, worker or queue, and the app is built to need none (scores are recomputed on read). | — |

## Proposed architecture: one service, no background job

```
src/lib/notifications/
  sources/  importantDates.ts · priorities.ts · habits.ts · together.ts   (one adapter per feature)
  upcoming.ts      Today / Tomorrow / Next 7 days / Later, derived live — never stored
  reminders.ts     due reminders → notification rows, idempotent (insert … on conflict do nothing)
  service.ts       feed (keyset, 20 per page) · unread count · mark read · mark all read · retention
```

- **Adding a dated feature later** means writing one adapter that returns `{ sourceType, sourceId, title (rendered live), date, time?, zone?, link, done? }`. Nothing else changes.
- **Upcoming is computed when the bell opens**, from the source tables and in the reader's zone, so it always reflects current schedules, edits and completions. It is never a stale copy, and nothing is stored for it.
- **Activity notices** ("You were assigned …") are written in the same transaction as the assignment.
  - Only newly added assignees are notified.
  - Assigning yourself sends nothing.
  - If you are reassigned the same task later, your one notice for it moves back to the top as unread.
  - Removal sends nothing. A notice whose task you are no longer assigned to, or which was deleted, or whose space was archived or left, is hidden when read and then removed.
- **Reminders are written when the user opens the app** (page load, returning to the tab, opening the bell; throttled to once every few minutes).
  - Each reminder whose time has passed becomes one row, keyed by source, occurrence and lead time, so it can never be duplicated.
  - An in-app notice can only be seen with the app open, so writing it at that moment gives exactly the feed a timer would have produced.
- **Titles are never copied into notifications.** They are read live from the source, in the reader's language. Renames, deletions and privacy are therefore handled, and a notice never shows something its reader may no longer see.
- **One bell for everyone.** It extends the existing bell, which becomes visible to every account:
  - **Upcoming:** grouped into Today, Tomorrow, Next 7 days and Later, with a category filter for Events, Priorities, Habits and Together.
  - **Reminders.**
  - **Activity:** Together assignments, plus the invitations it already shows, with Accept and Decline.
  - An unread count, Mark all read, a link to the original item on every row, and empty states, in EN and 中文, with the phone sheet at 360 and 390 px.
- **Notification Settings / 通知设置** go on the Account page, with a link from the bell. They are a few switches and times, not a control panel.

## When things remind (proposed defaults, all editable)

| Source | In Upcoming | Reminder by default | Never reminds |
|---|---|---|---|
| **Important Dates** | Every event's next occurrence (Later covers up to 30 days ahead) | **On**: 1 day before, at 8:00 AM. Options: on the day, 1, 3 or 7 days before. A timed event also reminds at its start. | An occurrence excluded from its series, or already over |
| **Planned Priorities** | Open priorities with a planned date | **On**: the planned day at 8:00 AM; one "still planned" notice the day after, if it is overdue | Completed or deleted priorities |
| **Together** (assigned to you) | Your open tasks with a due date | **On**: assignment (Activity), the due day at 8:00 AM, and one overdue notice the day after | Done or deleted tasks, archived spaces, spaces you left, tasks no longer yours |
| **Habits** | Only habits whose reminder you switched on, as one row per day | **Off** until you switch on a habit (in its editor): at its category's time (8:00, 13:00 or 20:00), or a time you choose | Days it isn't scheduled (`isScheduled`); days its status is on track or completed (`habitStatus`), so a flexible weekly or monthly habit gets **no artificial deadline**; reminders stop once its target is met |

"8:00 AM" means the user's Morning time, which is editable in settings. All times are in the user's zone, which is captured from the browser on each visit and stored for consistency. Date-only items remind at a local time; timed events at their own instant. DST and recurrence reuse `zonedTime.ts` and `recurrence.ts`.

## Database migration: needed, additive only (proposed step 23)

```sql
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users on delete cascade,
  category    text not null check (category in ('reminder','activity')),
  kind        text not null check (kind in ('task_assigned','task_due','task_overdue', 'date_upcoming',
                                            'date_start','priority_planned','priority_overdue','habit_due')),
  source_type text not null check (source_type in ('together_task','important_date','priority','habit')),
  source_id   uuid not null,                       -- no FK: sources differ; checked live on read
  board_id    uuid references together_boards on delete cascade,
  occurs_on   date,                                -- the occurrence / due / planned day it is about
  actor_id    uuid references users on delete set null,   -- who assigned (Activity only)
  dedupe_key  text not null check (length(dedupe_key) <= 200),
  notify_at   timestamptz not null,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index if not exists notifications_feed   on notifications (user_id, notify_at desc, id desc);
create index if not exists notifications_unread on notifications (user_id) where read_at is null;

-- No row = the defaults above, so nothing is backfilled for existing users.
create table if not exists notification_preferences (
  user_id             uuid primary key references users on delete cascade,
  together_assigned   boolean not null default true,
  together_due        boolean not null default true,
  important_dates     boolean not null default true,
  important_date_lead smallint not null default 1 check (important_date_lead in (0, 1, 3, 7)),
  priorities          boolean not null default true,
  habits              boolean not null default true,   -- master switch; each habit still opts in
  morning_time        time not null default '08:00',
  daytime_time        time not null default '13:00',
  nighttime_time      time not null default '20:00',
  time_zone           text check (time_zone is null or length(time_zone) between 1 and 64),
  materialized_at     timestamptz,                    -- throttle for writing reminders
  updated_at          timestamptz not null default now()
);

-- A habit's reminder exists only once someone switches it on (opt-in).
create table if not exists habit_reminders (
  habit_id   uuid primary key references habits on delete cascade,
  user_id    uuid not null references users on delete cascade,
  remind_at  time,                                    -- null = its category's time
  created_at timestamptz not null default now()
);

-- "My assigned tasks across spaces": today's index leads with board_id.
create index if not exists together_task_assignees_user on together_task_assignees (user_id);
```

- **No existing table is altered, and no row is written or rewritten.** It is safe to re-run.
- **Deploying before the migration is safe:** the code treats a missing table as "no notifications yet", so assignments never fail because of it. That follows the existing `42P01` pattern.
- **Retention:** each user's own visit sweeps their rows. Read rows go after 90 days and any row after 180. Rows whose source is gone or no longer accessible are hidden at once and removed by the sweep.
- **Release safety:** the usual sequence applies: local full-runner rehearsal, then the Neon rehearsal (on a branch the PO creates), then a production preflight. Each step needs separate approval.

## Background job and Render cost

- **Phase 1 needs no recurring job and no new Render service. Added cost: $0.** It runs on the existing web service and database, with the extra work only when a user opens the app.
- **Why no job:**
  - In-app notices are only seen in the app.
  - Writing them on open produces the same feed, order and count a cron would.
  - A cron job would also keep the free-tier database awake.
  - The app already avoids schedulers by design.
- **Phase 2 (email and push, separate approval):**
  - It needs a Render Cron Job calling the same `reminders.ts`. Cron jobs can't run on the Free instance and carry a minimum monthly charge, about $1/month at last check; confirm on render.com before deciding.
  - Quiet hours and a daily digest belong with it: they only matter for something that interrupts you. Phase 1 keeps their settings out, to stay simple.

## Build order (one branch; it can ship as one release or two)

1. **N1:**
   - the migration, and the service with its feed, count and read state
   - Together assignment notices
   - the unified bell, with Upcoming for Important Dates, Priorities and Together due dates
   - the existing invitations moved into Activity
2. **N2:**
   - reminder writing for dates, priorities, Together due and overdue
   - Notification Settings
   - per-habit opt-in in the habit editor, using the category times

**Tests:**
- **Rules and data:**
  - aggregation, buckets and the category filter
  - assignment, reassignment and self-assignment
  - every timing rule, with recurring events (exclusions, `repeat_until`)
  - flexible habits (weekly and monthly) and unscheduled days
  - done, deleted and cancelled sources
  - DST weeks (US and none-DST zones)
  - duplicate prevention under retries and concurrent opens
  - preferences, read/unread persistence and retention
  - removed membership, archived and deleted spaces
- **Product checks:** EN/中文, and desktop, 390 and 360 px.
- **Regression:** existing Today scoring, Community and Together suites unchanged.

## Decisions (all six approved by the PO, 2026-10-21)

1. Migration step 23 approved **for local development and rehearsal only**; production needs a separate approval.
2. No recurring job in Phase 1; the UI says plainly that these are in-app reminders, not alerts while the app is closed.
3. Default timings as in the table above (Priorities: planned day plus one overdue the next day).
4. The bell is shown to every signed-in account.
5. Habits appear in Upcoming only when their reminder is switched on.
6. Quiet hours, daily digest, email and push are Phase 2.

## As built (Stages 1 + 2)

- **Code:** `src/lib/notifications/` — `model.ts` (shared shapes, buckets, defaults), `server.ts` (Upcoming sources, Activity, the center, read state, assignment notices, settings), `reminders.ts` (habit rows, due reminders, writing them, matching them to rows). Routes under `/api/notifications` (center, `summary`, `read`, `preferences`, `habits/[habitId]`). UI: `NotificationCenter.tsx` (the bell's panel), `NotificationSettings.tsx` (Account page, `#notifications`), `HabitReminderField.tsx` (habit editor).
- **One extra kind, `date_start`,** for a timed event's reminder at its start (the step-23 check lists it).
- **The time zone is taken from the browser once** (first visit), then changes only in settings — not on every visit — so travelling or a second device never moves reminders.
- **Writing reminders:** when the badge is fetched (app open, tab regains focus), at most every 5 minutes per person, for reminders that came due in the last 3 days. Keys are source + occurrence + kind — never the lead time, the zone or the instant — so a lead or zone change, two tabs or a retry never write a second reminder, and one already read is never repeated. Lengthening an event's lead past a time that slipped out of the 3-day catch-up still reminds once while the event is ahead. A moved event, priority or task is reminded once for its new date; a changed event time does not repeat its start reminder.
- **A reminder counts only while it is still true:** it shows as a dot on its Upcoming row only while that row exists on the same day (priority/task keys include the planned/due day, so re-planning or moving a due date retires the old reminder). One dot per row; opening a record clears every notice about it (its assignment and its reminders together). Switching a kind off stops its reminders counting at once; "Together: tasks assigned to me" off writes no assignment notice.
- **Badge = the panel's own count** (unread activity still actionable + waiting invitations + reminder dots); future events never count.
- **Habits:** opt-in per habit; today's row only while `habitStatus` is due or behind; tomorrow's row only for fixed-day schedules — a flexible "N times a week/month" habit is never shown ahead of a day it is due.
- **Sweep:** read rows after 90 days, any after 180, on the same clock as the reminders.
- **Known limits:** reminders appear only when the app is opened (by design); data created in the last 5 minutes may wait for the next window; a reminder whose time passed before a change is not re-sent at the new time (e.g. a start reminder after the event's time moves later).
- **Accessibility:** `Segmented` (every On/Off and option row) now announces its chosen option with `aria-pressed`; settings rows name their toggles. A full `role="switch"`/radio-group pattern with arrow keys across the app's 28 uses is left as a separate task.
