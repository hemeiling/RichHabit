import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unified Notifications, Stage 2 — in-app reminders, Notification settings and
 * per-habit reminders — through the real routes and data layer against
 * Postgres (PGlite) with the real schema. Stubbed: who is signed in, cookies
 * and the analytics sink.
 *
 * What must hold: each reminder comes at the person's own local time, right
 * across a daylight-saving change; it is written once, however often the app
 * opens and whatever the time zone does; it counts (and shows as a dot) only
 * while what it is about is still true; habits remind only when switched on,
 * only on their scheduled days and never once done — and a flexible habit is
 * never given a deadline; settings refuse anything malformed; and nobody can
 * touch anyone else's.
 */

let db: PGlite;
const open: PGlite[] = [];
vi.mock("@/lib/db/pool", () => {
  const parsers = { 1082: (v: string) => v, 1182: (v: string) => (v === "{}" ? [] : v.slice(1, -1).split(",")) };
  return {
    query: async (sql: string, params: unknown[] = []) =>
      ((globalThis as any).__tgDb as PGlite).query(sql, params as any[], { parsers }).then((r) => r.rows),
    transaction: async (fn: (q: any) => Promise<unknown>) =>
      ((globalThis as any).__tgDb as PGlite).transaction(async (tx: any) =>
        fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params, { parsers })).rows)),
  };
});
let signedIn: string | null = null;
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => (signedIn ? { id: signedIn, email: "x" } : null) }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined }), headers: () => new Map() }));
const tracked: { event: string; properties?: Record<string, unknown> }[] = [];
vi.mock("@/lib/analytics/track", () => ({ trackEvent: async (e: any) => { tracked.push(e); } }));

const center = await import("../src/app/api/notifications/route");
const summary = await import("../src/app/api/notifications/summary/route");
const read = await import("../src/app/api/notifications/read/route");
const prefsRoute = await import("../src/app/api/notifications/preferences/route");
const habitRoute = await import("../src/app/api/notifications/habits/[habitId]/route");
const taskRoute = await import("../src/app/api/together/boards/[id]/tasks/[taskId]/route");
const { materializeReminders } = await import("../src/lib/notifications/reminders");
const { savePrefs } = await import("../src/lib/notifications/server");

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
afterAll(async () => { for (const d of open) await d.close(); });
const sql = async (text: string, params: unknown[] = []) => (await db.query<any>(text, params as any[])).rows;
async function account(name: string) {
  const [u] = await sql(`insert into users (email, username, password_hash) values ($1, $2, 'x') returning id`,
    [`${name.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`, `${name.toLowerCase()}${randomUUID().slice(0, 4)}`]);
  await sql(`insert into profiles (id, first_name) values ($1, $2)`, [u.id, name]);
  return u.id as string;
}
const as = (id: string | null) => { signedIn = id; };
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) });
const get = (url: string) => new Request(`http://x/api${url}`);
const send = (method: string, body: unknown) =>
  new Request("http://x/api", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const utc = (date: string, time: string) => Date.parse(`${date}T${time}:00Z`);
/** The center as the reader sees it (reading it writes nothing). */
const view = async (who: string, tz = "UTC") => { as(who); return (await json(await center.GET(get(`?tz=${tz}`)))).body; };
/** Open the app at `now`: reminders that came due are written. The throttle is reset first unless asked not to. */
const openAt = async (who: string, now: number, zone = "UTC", { throttle = false } = {}) => {
  if (!throttle) await sql(`update notification_preferences set materialized_at = null where user_id = $1`, [who]);
  return materializeReminders(who, zone, now);
};
const reminders = async (who: string) =>
  sql(`select kind, dedupe_key, notify_at, read_at from notifications where user_id = $1 and category = 'reminder' order by notify_at, dedupe_key`, [who]);
async function habit(who: string, name: string, schedule: { mode: string; days?: number[]; times?: number } = { mode: "daily" },
  category = "morning") {
  const [h] = await sql(`insert into habits (user_id, name, category, start_date) values ($1, $2, $3, $4) returning id`, [who, name, category, day(-30)]);
  await sql(`insert into habit_schedules (habit_id, user_id, mode, days_of_week, times_per_week, effective_from)
             values ($1, $2, $3, $4, $5, $6)`,
    [h.id, who, schedule.mode, schedule.days ?? [0, 1, 2, 3, 4, 5, 6], schedule.times ?? null, day(-30)]);
  return h.id as string;
}
const remind = async (who: string | null, habitId: string, body: unknown) => {
  as(who); return json(await habitRoute.PUT(send("PUT", body), { params: { habitId } }));
};

let ann: string, bo: string;
beforeEach(async () => {
  db = await PGlite.create();
  open.push(db);
  await db.exec(SCHEMA);
  (globalThis as any).__tgDb = db;
  tracked.length = 0;
  signedIn = null;
  ann = await account("Ann"); bo = await account("Bo");
});

describe("Important Dates", () => {
  it("reminds the day before at the morning time, and at a timed event's start — on local time across a DST change", async () => {
    await savePrefs(ann, { timeZone: "America/New_York" });                   // lead: 1 day (the default)
    // New York leaves daylight time at 02:00 on Sunday 1 November 2026.
    await sql(`insert into important_dates (user_id, title, starts_on, ends_on) values ($1, 'Dentist', '2026-11-02', '2026-11-02')`, [ann]);
    await sql(`insert into important_dates (user_id, title, starts_on, ends_on, start_time, end_time, time_zone)
               values ($1, 'Brunch', '2026-11-01', '2026-11-01', '09:30', '10:30', 'America/New_York')`, [ann]);
    expect(await openAt(ann, utc("2026-11-01", "12:59"))).toBe(1);
    expect((await reminders(ann)).map((r: any) => [r.kind, new Date(r.notify_at).toISOString()])).toEqual([
      ["date_upcoming", "2026-10-31T12:00:00.000Z"],                            // Brunch, Sat 08:00 EDT
    ]);
    expect(await openAt(ann, utc("2026-11-01", "14:31"))).toBe(2);
    expect((await reminders(ann)).map((r: any) => [r.kind, new Date(r.notify_at).toISOString()])).toEqual([
      ["date_upcoming", "2026-10-31T12:00:00.000Z"],
      ["date_upcoming", "2026-11-01T13:00:00.000Z"],                            // Dentist, Sun 08:00 EST
      ["date_start", "2026-11-01T14:30:00.000Z"],                               // Brunch starts 09:30 EST
    ]);
    // Spring forward (02:00 on Sunday 14 March 2027): 08:00 EDT is 12:00 UTC, not 13:00.
    // (A future date: the sweep, on the real clock, would drop a reminder more than 180 days old.)
    await sql(`insert into important_dates (user_id, title, starts_on, ends_on) values ($1, 'Recital', '2027-03-15', '2027-03-15')`, [ann]);
    expect(await openAt(ann, utc("2027-03-14", "11:59"))).toBe(0);
    expect(await openAt(ann, utc("2027-03-14", "12:00"))).toBe(1);
    const spring = (await reminders(ann)).at(-1);
    expect(spring).toMatchObject({ kind: "date_upcoming", dedupe_key: expect.stringMatching(/:2027-03-15:lead1$/) });
    expect(new Date(spring.notify_at).toISOString()).toBe("2027-03-14T12:00:00.000Z");
  });

  it("honours the chosen lead, skips an excluded occurrence, and writes nothing when switched off", async () => {
    await savePrefs(ann, { importantDateLead: 3 });
    await sql(`insert into important_dates (user_id, title, starts_on, ends_on, repeat_unit, repeat_interval, excluded_on)
               values ($1, 'Class', '2026-06-01', '2026-06-01', 'week', 1, '{2026-06-08}')`, [ann]);
    expect(await openAt(ann, utc("2026-06-05", "08:01"))).toBe(0);           // the 8th is excluded
    expect(await openAt(ann, utc("2026-06-12", "08:01"))).toBe(1);           // three days before the 15th
    expect((await reminders(ann))[0].dedupe_key).toMatch(/:2026-06-15:lead3$/);
    await savePrefs(ann, { importantDates: false });
    expect(await openAt(ann, utc("2026-06-19", "08:01"))).toBe(0);
  });
});

describe("one reminder each, whatever happens", () => {
  it("never duplicates — repeated opens, two tabs at once, a changed time zone", async () => {
    await sql(`insert into priorities (user_id, body, created_on, planned_on) values ($1, 'Call bank', '2026-10-30', '2026-11-01')`, [ann]);
    expect(await openAt(ann, utc("2026-11-01", "09:00"))).toBe(1);           // on the day, 08:00 UTC
    expect(await openAt(ann, utc("2026-11-01", "09:00"))).toBe(0);
    await sql(`update notification_preferences set materialized_at = null where user_id = $1`, [ann]);
    const both = await Promise.all([materializeReminders(ann, "UTC", utc("2026-11-01", "10:00")), materializeReminders(ann, "UTC", utc("2026-11-01", "10:00"))]);
    expect(both[0] + both[1]).toBe(0);
    await savePrefs(ann, { timeZone: "Asia/Tokyo" });                         // the day's reminder moves to 08:00 JST — already sent
    expect(await openAt(ann, utc("2026-11-02", "09:00"))).toBe(1);           // only the overdue one is new
    await savePrefs(ann, { timeZone: "Pacific/Honolulu" });
    expect(await openAt(ann, utc("2026-11-02", "20:00"))).toBe(0);
    expect((await reminders(ann)).map((r: any) => r.kind)).toEqual(["priority_planned", "priority_overdue"]);
  });

  it("writes at most every few minutes per person", async () => {
    await sql(`insert into priorities (user_id, body, created_on, planned_on) values ($1, 'First', '2026-10-30', '2026-11-01')`, [ann]);
    const t = utc("2026-11-01", "09:00");
    expect(await openAt(ann, t)).toBe(1);
    await sql(`insert into priorities (user_id, body, created_on, planned_on) values ($1, 'Second', '2026-10-30', '2026-11-01')`, [ann]);
    expect(await openAt(ann, t + 60_000, "UTC", { throttle: true })).toBe(0);
    expect(await openAt(ann, t + 6 * 60_000, "UTC", { throttle: true })).toBe(1);
  });

  it("sweeps old reminders — read ones after 90 days, any after 180 — and only the reader's", async () => {
    const old = (who: string, key: string, notifyDays: number, readDays: number | null) => sql(
      `insert into notifications (user_id, category, kind, source_type, source_id, occurs_on, dedupe_key, notify_at, read_at)
       values ($1, 'reminder', 'priority_planned', 'priority', gen_random_uuid(), current_date, $2,
               now() - make_interval(days => $3), case when $4::int is null then null else now() - make_interval(days => $4::int) end)`,
      [who, key, notifyDays, readDays]);
    await old(ann, "read-old", 120, 100); await old(ann, "read-recent", 120, 10);
    await old(ann, "unread-ancient", 200, null); await old(ann, "unread-old", 100, null); await old(bo, "bo-ancient", 200, null);
    await openAt(ann, Date.now());
    expect((await sql(`select dedupe_key from notifications order by dedupe_key`)).map((r: any) => r.dedupe_key))
      .toEqual(["bo-ancient", "read-recent", "unread-old"]);
  });
});

describe("a dot only while it is still true", () => {
  it("Priorities: on the day and one overdue; one tap clears both; completed or re-planned, it stops counting", async () => {
    const [{ id: late }] = await sql(`insert into priorities (user_id, body, created_on, planned_on) values ($1, 'Late', $2, $2) returning id`, [ann, day(-1)]);
    await sql(`insert into priorities (user_id, body, created_on, planned_on) values ($1, 'Today', $2, $2), ($1, 'Moved', $2, $2)`, [ann, day(0)]);
    expect(await openAt(ann, utc(day(0), "08:30"))).toBe(4);                 // Late ×2, Today, Moved
    let v = await view(ann);
    expect(v.upcoming.filter((i: any) => i.notificationId).map((i: any) => i.title).sort()).toEqual(["Late", "Moved", "Today"]);
    expect(v.unread).toBe(3);                                                 // one per row, never two for Late
    as(ann); expect((await json(await summary.GET(get("?tz=UTC")))).body.unread).toBe(v.unread);   // the badge is the list's count
    as(ann); await read.POST(send("POST", { ids: [v.upcoming.find((i: any) => i.title === "Late").notificationId] }));
    expect((await sql(`select count(*)::int n from notifications where source_id = $1 and read_at is null`, [late]))[0].n).toBe(0);
    await sql(`update priorities set completed_on = $2 where user_id = $1 and body = 'Today'`, [ann, day(0)]);
    await sql(`update priorities set planned_on = $2 where user_id = $1 and body = 'Moved'`, [ann, day(2)]);
    v = await view(ann);
    expect(v.upcoming.map((i: any) => [i.title, i.notificationId !== null])).toEqual([["Late", false], ["Moved", false]]);
    expect(v.unread).toBe(0);
    await savePrefs(ann, { priorities: false });
    expect(await openAt(ann, utc(day(1), "08:30"))).toBe(0);
  });

  it("Together: on the due day and one overdue; done, moved or unassigned, it stops counting", async () => {
    process.env.TOGETHER_PREVIEW_USER_IDS = bo;
    const [{ id: board }] = await sql(`insert into together_boards (name, created_by) values ('Headband', $1) returning id`, [bo]);
    await sql(`insert into together_members (board_id, user_id, role, added_by) values ($1, $2, 'owner', $2), ($1, $3, 'member', $2)`, [board, bo, ann]);
    const task = async (title: string, due: string) =>
      (await sql(`insert into together_tasks (board_id, title, stage, due_on, created_by) values ($1, $2, 'todo', $3, $4) returning id`, [board, title, due, bo]))[0].id as string;
    const a = await task("Order fabric", day(0)), b = await task("Call printer", day(-1)), c = await task("Pack", day(0));
    for (const t of [a, b, c]) {
      as(bo);
      expect((await taskRoute.PATCH(send("PATCH", { assignees: [ann] }), { params: { id: board, taskId: t } })).status).toBe(200);
    }
    await sql(`update notifications set read_at = now() where category = 'activity'`);   // only the reminders are in question here
    expect(await openAt(ann, utc(day(0), "08:30"))).toBe(4);
    expect(await openAt(bo, utc(day(0), "08:30"))).toBe(0);                  // assigned to Ann, not to Bo
    expect((await view(ann)).unread).toBe(3);
    await sql(`update together_tasks set stage = 'done' where id = $1`, [a]);
    await sql(`update together_tasks set due_on = $2 where id = $1`, [b, day(4)]);
    as(bo); await taskRoute.PATCH(send("PATCH", { assignees: [bo] }), { params: { id: board, taskId: c } });
    const v = await view(ann);
    expect(v.upcoming.map((i: any) => [i.title, i.notificationId !== null])).toEqual([["Call printer", false]]);
    expect(v.unread).toBe(0);
  });

  it("a kind switched off stops counting at once, even for reminders already written", async () => {
    await sql(`insert into priorities (user_id, body, created_on, planned_on) values ($1, 'Today', $2, $2)`, [ann, day(0)]);
    await openAt(ann, utc(day(0), "08:30"));
    expect((await view(ann)).unread).toBe(1);
    await savePrefs(ann, { priorities: false });
    expect((await view(ann)).unread).toBe(0);
    await savePrefs(ann, { priorities: true });
    expect((await view(ann)).unread).toBe(1);
  });
});

describe("habits", () => {
  it("off unless switched on per habit; at its time of day or its own; only on scheduled days; never once done", async () => {
    const stretch = await habit(ann, "Stretch");
    const swim = await habit(ann, "Swim", { mode: "days", days: [new Date(`${day(1)}T12:00:00Z`).getUTCDay()] }, "nighttime");
    let v = await view(ann);
    expect(v.upcoming.filter((i: any) => i.category === "habits")).toEqual([]);   // off by default
    expect((await remind(ann, stretch, { on: true })).status).toBe(200);
    expect((await remind(ann, swim, { on: true, time: "18:45" })).status).toBe(200);
    v = await view(ann);
    const habits = v.upcoming.filter((i: any) => i.category === "habits").map((i: any) => [i.title, i.date, i.time]);
    expect(habits).toEqual(expect.arrayContaining([["Stretch", day(0), "08:00"], ["Stretch", day(1), "08:00"], ["Swim", day(1), "18:45"]]));
    expect(habits).toHaveLength(3);                                           // Swim is not on today
    expect(v.upcoming.find((i: any) => i.title === "Stretch").href).toBe("/habits");

    expect(await openAt(ann, utc(day(0), "08:30"))).toBe(1);                 // Stretch, today, 08:00
    expect((await view(ann)).unread).toBe(1);
    await sql(`insert into habit_completions (habit_id, user_id, done_on) values ($1, $2, $3)`, [stretch, ann, day(0)]);
    v = await view(ann);
    expect(v.upcoming.filter((i: any) => i.title === "Stretch").map((i: any) => i.date)).toEqual([day(1)]);
    expect(v.unread).toBe(0);
    expect(await openAt(ann, utc(day(0), "09:00"))).toBe(0);                 // done: nothing more today

    expect((await remind(ann, stretch, { on: false })).status).toBe(200);
    expect((await view(ann)).upcoming.filter((i: any) => i.title === "Stretch")).toEqual([]);
    await savePrefs(ann, { habits: false });                                  // the master switch hides the rest
    expect((await view(ann)).upcoming.filter((i: any) => i.category === "habits")).toEqual([]);
    expect(tracked.filter((e) => e.event === "habit_reminder_set").map((e) => e.properties))
      .toEqual([{ on: true, ownTime: false }, { on: true, ownTime: true }, { on: false, ownTime: false }]);
  });

  it("gives a flexible habit no deadline: shown only on a day it is due, never as tomorrow", async () => {
    const yoga = await habit(ann, "Yoga", { mode: "times", times: 1 });
    await remind(ann, yoga, { on: true });
    const rows = (await view(ann)).upcoming.filter((i: any) => i.title === "Yoga");
    // Once a week (weeks run Sunday–Saturday): due only on Saturday, on track before.
    const isLastDay = new Date(`${day(0)}T12:00:00Z`).getUTCDay() === 6;
    expect(rows.map((i: any) => i.date)).toEqual(isLastDay ? [day(0)] : []);
  });

  it("only the habit's owner can switch its reminder; anything malformed is refused", async () => {
    const stretch = await habit(ann, "Stretch");
    expect((await remind(bo, stretch, { on: true })).status).toBe(404);
    expect((await remind(null, stretch, { on: true })).status).toBe(401);
    expect((await remind(ann, stretch, { on: "yes" })).status).toBe(400);
    expect((await remind(ann, stretch, { on: true, time: "25:00" })).status).toBe(400);
    expect((await remind(ann, "not-a-uuid", { on: true })).status).toBe(400);
    expect((await sql(`select count(*)::int n from habit_reminders`))[0].n).toBe(0);
    await sql(`delete from habits where id = $1`, [stretch]);                 // a deleted habit takes its reminder with it
    expect((await remind(ann, stretch, { on: true })).status).toBe(404);
  });
});

describe("Notification settings", () => {
  it("starts from the approved defaults, saves what is valid, refuses — wholly — anything that is not", async () => {
    as(ann);
    const first = (await json(await prefsRoute.GET())).body;
    expect(first.prefs).toEqual({ togetherAssigned: true, togetherDue: true, importantDates: true, importantDateLead: 1, priorities: true,
      habits: true, morningTime: "08:00", daytimeTime: "13:00", nighttimeTime: "20:00", timeZone: null });
    expect(first.habitReminders).toEqual({});
    for (const bad of [{ importantDateLead: 2 }, { morningTime: "8am" }, { timeZone: "Mars/Olympus" }, { priorities: "no" },
      { morningTime: "07:00", nighttimeTime: "24:00" }]) {
      as(ann); expect((await json(await prefsRoute.PUT(send("PUT", bad)))).status, JSON.stringify(bad)).toBe(400);
    }
    as(ann); expect((await json(await prefsRoute.GET())).body.prefs.morningTime).toBe("08:00");   // the valid half was not applied
    as(ann);
    const ok = await json(await prefsRoute.PUT(send("PUT", { morningTime: "07:15", importantDateLead: 3, timeZone: "Europe/London" })));
    expect(ok.status).toBe(200);
    as(bo); expect((await json(await prefsRoute.GET())).body.prefs.morningTime).toBe("08:00");   // Bo's own, untouched
    as(ann); expect((await json(await prefsRoute.GET())).body.prefs).toMatchObject({ morningTime: "07:15", importantDateLead: 3, timeZone: "Europe/London" });
    as(null); expect((await prefsRoute.GET()).status).toBe(401);
    // Analytics: the names of what changed, never values.
    const saved = tracked.filter((e) => e.event === "notification_settings_saved");
    expect(JSON.stringify(saved)).not.toMatch(/07:15|London/);
  });

  it("with Together assignments switched off, no assignment notice is written or shown", async () => {
    process.env.TOGETHER_PREVIEW_USER_IDS = bo;
    const [{ id: board }] = await sql(`insert into together_boards (name, created_by) values ('Headband', $1) returning id`, [bo]);
    await sql(`insert into together_members (board_id, user_id, role, added_by) values ($1, $2, 'owner', $2), ($1, $3, 'member', $2)`, [board, bo, ann]);
    const [{ id: task }] = await sql(`insert into together_tasks (board_id, title, stage, created_by) values ($1, 'Pack', 'todo', $2) returning id`, [board, bo]);
    await savePrefs(ann, { togetherAssigned: false });
    as(bo); expect((await taskRoute.PATCH(send("PATCH", { assignees: [ann] }), { params: { id: board, taskId: task } })).status).toBe(200);
    expect((await sql(`select count(*)::int n from notifications`))[0].n).toBe(0);
    expect((await view(ann)).activity).toEqual([]);
  });
});
