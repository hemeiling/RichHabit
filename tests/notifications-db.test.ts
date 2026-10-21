import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unified Notifications, Stage 1, through the real routes and data layer
 * against Postgres (PGlite) with the real schema (step 23 included). Stubbed:
 * who is signed in, cookies and the analytics sink.
 *
 * What must hold: an assignment tells the people just added — once, never the
 * person assigning — and a reassignment brings that one notice back unread;
 * a notice for a task you no longer have, a deleted task or an archived space
 * is neither shown nor counted; Upcoming is every dated thing ahead from live
 * data, grouped by day, with nothing stored for it; the badge never counts a
 * future event; nobody can read or mark anyone else's notices; and a database
 * without the new tables keeps everything working.
 */

let db: PGlite;
const open: PGlite[] = [];
/* The parsers lib/db/pool registers for `pg`: a date comes back as the string Postgres sent, as in production. */
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
const taskRoute = await import("../src/app/api/together/boards/[id]/tasks/[taskId]/route");
const { bucketOf } = await import("../src/lib/notifications/model");

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
afterAll(async () => { for (const d of open) await d.close(); });
const sql = async (text: string, params: unknown[] = []) => (await db.query<any>(text, params as any[])).rows;
const allow = (...ids: string[]) => { process.env.TOGETHER_PREVIEW_USER_IDS = ids.join(","); };
async function account(name: string) {
  const [u] = await sql(`insert into users (email, username, password_hash) values ($1, $2, 'x') returning id`,
    [`${name.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`, `${name.toLowerCase()}${randomUUID().slice(0, 4)}`]);
  await sql(`insert into profiles (id, first_name) values ($1, $2)`, [u.id, name]);
  return u.id as string;
}
const as = (id: string | null) => { signedIn = id; };
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) });
const get = (url: string) => new Request(`http://x/api${url}`);
const post = (body: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const view = async (who: string) => { as(who); return (await json(await center.GET(get("?tz=UTC")))).body; };
const badge = async (who: string) => { as(who); return (await json(await summary.GET(get("?tz=UTC")))).body.unread as number; };
async function assign(who: string, board: string, task: string, assignees: string[]) {
  as(who);
  const r = await json(await taskRoute.PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify({ assignees }),
    headers: { "content-type": "application/json" } }), { params: { id: board, taskId: task } }));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

let hippo: string, ann: string, bo: string, solo: string, board: string, other: string;
let t1: string, t2: string, t3: string;
beforeEach(async () => {
  db = await PGlite.create();
  open.push(db);
  await db.exec(SCHEMA);
  (globalThis as any).__tgDb = db;
  tracked.length = 0;
  signedIn = null;
  hippo = await account("Hippo"); ann = await account("Ann"); bo = await account("Bo"); solo = await account("Solo");
  allow(hippo);
  [{ id: board }] = await sql(`insert into together_boards (name, created_by) values ('Headband', $1) returning id`, [hippo]);
  [{ id: other }] = await sql(`insert into together_boards (name, created_by) values ('Elsewhere', $1) returning id`, [bo]);
  await sql(`insert into together_members (board_id, user_id, role, added_by) values ($1, $2, 'owner', $2), ($1, $3, 'member', $2), ($1, $4, 'member', $2)`, [board, hippo, ann, bo]);
  await sql(`insert into together_members (board_id, user_id, role, added_by) values ($1, $2, 'owner', $2)`, [other, bo]);
  const task = async (title: string, stage: string, due: string | null, b = board, by = hippo) =>
    (await sql(`insert into together_tasks (board_id, title, stage, due_on, created_by) values ($1, $2, $3, $4, $5) returning id`, [b, title, stage, due, by]))[0].id as string;
  t1 = await task("Order fabric", "todo", day(1));
  t2 = await task("Call the printer", "doing", day(-2));
  t3 = await task("Someday", "backlog", day(3));
  await task("Their task", "todo", day(1), other, bo);
});

describe("assignment notices (Activity)", () => {
  it("tells the people just added — once, never the person assigning — and a reassignment brings it back unread", async () => {
    await assign(hippo, board, t1, [hippo, ann]);
    expect((await sql(`select user_id from notifications`)).map((r: any) => r.user_id)).toEqual([ann]);   // not Hippo
    const a = await view(ann);
    expect(a.activity).toEqual([expect.objectContaining({ kind: "task_assigned", title: "Order fabric", context: "Headband", actor: "Hippo", unread: true,
      href: `/together/b/${board}?task=${t1}` })]);
    expect(await badge(ann)).toBe(1);
    await assign(hippo, board, t1, [hippo, ann]);                     // saving again changes nothing
    expect((await sql(`select count(*)::int n from notifications`))[0].n).toBe(1);
    as(ann); await read.POST(post({ ids: [a.activity[0].id] }));
    expect(await badge(ann)).toBe(0);
    await assign(hippo, board, t1, [hippo]);                          // removed: nothing sent, notice hidden
    expect((await view(ann)).activity).toEqual([]);
    await assign(hippo, board, t1, [hippo, ann]);                     // back again: the same notice, unread
    expect((await sql(`select count(*)::int n from notifications`))[0].n).toBe(1);
    expect((await view(ann)).activity[0].unread).toBe(true);
    expect(await badge(ann)).toBe(1);
  });

  it("hides — and stops counting — a notice whose task was deleted, whose space was archived, or whose member left", async () => {
    await assign(hippo, board, t1, [ann, bo]);
    await assign(hippo, board, t2, [ann]);
    // Two assignments, plus t2's one overdue reminder (due two days ago; Stage 2).
    expect(await badge(ann)).toBe(3);
    await sql(`update together_tasks set deleted_at = now() where id = $1`, [t1]);
    expect((await view(ann)).activity.map((x: any) => x.title)).toEqual(["Call the printer"]);
    expect(await badge(ann)).toBe(2);
    await sql(`update together_boards set archived_at = now() where id = $1`, [board]);
    expect((await view(ann)).activity).toEqual([]);
    expect(await badge(ann)).toBe(0);
    await sql(`update together_boards set archived_at = null where id = $1`, [board]);
    await sql(`delete from together_members where board_id = $1 and user_id = $2`, [board, ann]);   // assignments cascade
    expect((await view(ann)).activity).toEqual([]);
    expect((await view(bo)).activity).toEqual([]);   // t1 is still deleted
  });
});

describe("Upcoming", () => {
  it("lists every dated thing ahead from live data, grouped by day — nothing stored for it", async () => {
    await sql(`insert into important_dates (user_id, title, starts_on, ends_on) values ($1, 'Dentist', $2, $2), ($1, 'Trip', $3, $3), ($1, 'Long ago', '2020-01-01', '2020-01-01')`, [ann, day(0), day(12)]);
    await sql(`insert into important_dates (user_id, title, starts_on, ends_on, repeat_unit, repeat_interval) values ($1, 'Team call', $2, $2, 'week', 1)`, [ann, day(-6)]);
    await sql(`insert into priorities (user_id, body, created_on, planned_on, completed_on) values
      ($1, 'Call bank', $2, $3, null), ($1, 'Pay rent', $2, $4, null), ($1, 'Done one', $2, $3, $2), ($1, 'No plan', $2, null, null)`,
      [ann, day(-5), day(1), day(-1)]);
    await assign(hippo, board, t1, [ann]);
    await assign(hippo, board, t2, [ann]);
    await assign(hippo, board, t3, [ann]);
    const before = (await sql(`select count(*)::int n from notifications`))[0].n;
    const v = await view(ann);
    expect(v.today).toBe(day(0));
    const byTitle = Object.fromEntries(v.upcoming.map((i: any) => [i.title, i]));
    expect(Object.keys(byTitle).sort()).toEqual(["Call bank", "Call the printer", "Dentist", "Order fabric", "Pay rent", "Team call", "Trip"].sort());
    expect(bucketOf(byTitle["Dentist"], v.today)).toBe("today");
    expect(bucketOf(byTitle["Team call"], v.today)).toBe("tomorrow");          // the next weekly occurrence
    expect(byTitle["Team call"].date).toBe(day(1));
    expect(bucketOf(byTitle["Trip"], v.today)).toBe("later");
    expect(byTitle["Pay rent"]).toMatchObject({ overdue: true, category: "priorities" });
    expect(byTitle["Call the printer"]).toMatchObject({ overdue: true, category: "together", context: "Headband" });
    expect(byTitle["Order fabric"].href).toBe(`/together/b/${board}?task=${t1}`);
    expect(byTitle["Dentist"].href).toMatch(/^\/priorities\?event=[0-9a-f-]+&on=\d{4}-\d{2}-\d{2}$/);
    expect(byTitle["Call bank"].href).toMatch(/^\/priorities\?priority=[0-9a-f-]+$/);
    // Overdue first, then by day.
    expect(v.upcoming.slice(0, 2).every((i: any) => i.overdue)).toBe(true);
    // Upcoming wrote nothing, and future items are never "unread".
    expect((await sql(`select count(*)::int n from notifications`))[0].n).toBe(before);
    expect(v.upcoming.every((i: any) => i.notificationId === null)).toBe(true);
    expect(v.unread).toBe(3);                                                  // the three assignments only
  });

  it("follows completions and edits at once, and never shows someone else's tasks, dates or priorities", async () => {
    await assign(hippo, board, t1, [ann]);
    await sql(`insert into priorities (user_id, body, created_on, planned_on) values ($1, 'Mine', $2, $2)`, [bo, day(0)]);
    expect((await view(ann)).upcoming.map((i: any) => i.title)).toEqual(["Order fabric"]);
    await sql(`update together_tasks set stage = 'done' where id = $1`, [t1]);
    expect((await view(ann)).upcoming).toEqual([]);
    const boView = await view(bo);
    expect(boView.upcoming.map((i: any) => i.title)).toEqual(["Mine"]);     // not "Their task": Bo is not on the preview list
  });

  it("works for an account with no Together at all, with the same bell", async () => {
    await sql(`insert into important_dates (user_id, title, starts_on, ends_on) values ($1, 'Birthday', $2, $2)`, [solo, day(2)]);
    const v = await view(solo);
    expect(v.upcoming.map((i: any) => i.title)).toEqual(["Birthday"]);
    expect(v.activity).toEqual([]);
    expect(v.invitations).toEqual([]);
    expect(v.unread).toBe(0);
  });
});

describe("read state, ownership and safety", () => {
  it("marks only your own notices read — by id or all — and answers a signed-out caller 401", async () => {
    await assign(hippo, board, t1, [ann, bo]);
    const [mine] = await sql(`select id from notifications where user_id = $1`, [ann]);
    as(bo);
    expect((await json(await read.POST(post({ ids: [mine.id] })))).body.changed).toBe(0);   // Ann's, not Bo's
    expect(await badge(ann)).toBe(1);
    as(ann);
    expect((await json(await read.POST(post({ all: true })))).body.changed).toBe(1);
    expect(await badge(ann)).toBe(0);
    expect(await badge(bo)).toBe(1);
    as(null);
    expect((await center.GET(get(""))).status).toBe(401);
    expect((await summary.GET(get(""))).status).toBe(401);
    expect((await read.POST(post({ all: true }))).status).toBe(401);
  });

  it("takes the browser's zone once — a later browser elsewhere does not move it", async () => {
    as(ann);
    await summary.GET(get("?tz=america/chicago"));
    await summary.GET(get("?tz=Asia/Shanghai"));
    expect((await sql(`select time_zone from notification_preferences where user_id = $1`, [ann]))[0].time_zone).toBe("America/Chicago");
    expect((await view(ann)).timeZone).toBe("America/Chicago");
  });

  it("keeps working on a database without the new tables: assignments succeed, the bell reads empty", async () => {
    await db.exec(`drop table notifications; drop table notification_preferences; drop table habit_reminders;`);
    await assign(hippo, board, t1, [ann]);                                       // no failure
    expect((await sql(`select count(*)::int n from together_task_assignees where task_id = $1`, [t1]))[0].n).toBe(1);
    const v = await view(ann);
    expect(v.activity).toEqual([]);
    expect(v.upcoming.map((i: any) => i.title)).toEqual(["Order fabric"]);       // Upcoming needs no new table
    expect(await badge(ann)).toBe(0);
    as(ann);
    expect((await json(await read.POST(post({ all: true })))).status).toBe(200);
  });

  it("counts the bell's opening — never a title", async () => {
    await assign(hippo, board, t1, [ann]);
    await view(ann);
    const e = tracked.find((x) => x.event === "notification_center_opened")!;
    expect(e.properties).toEqual({ upcoming: 1, unread: 1 });
  });
});
