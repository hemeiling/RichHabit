import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Together V1B — a space's shared work — through the real routes and data layer,
 * against Postgres (PGlite). Stubbed: who is signed in, the cookie store and the
 * analytics sink (so what each route records can be inspected).
 *
 * What matters: every route refuses a non-member exactly as it refuses a space
 * that does not exist; an archived space is read-only for every write; nothing
 * crosses from one space to another; only current members can be assigned, and
 * leaving or removal clears assignments; deletion is soft and restorable; two
 * people cannot silently overwrite each other's words; order is "newest move on
 * top"; Done keeps a task for 24 hours, then History; a departed creator becomes "Former
 * member"; and analytics never carry what anyone wrote.
 */

let db: PGlite;
const open: PGlite[] = [];
vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__tgDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__tgDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows)),
}));
let signedIn: string | null = null;
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => (signedIn ? { id: signedIn, email: "x" } : null) }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined }), headers: () => new Map() }));
const tracked: { event: string; properties?: Record<string, unknown>; entityId?: unknown; userId?: string }[] = [];
vi.mock("@/lib/analytics/track", () => ({ trackEvent: async (e: any) => { tracked.push(e); } }));

const work = await import("../src/app/api/together/boards/[id]/work/route");
const tasks = await import("../src/app/api/together/boards/[id]/tasks/route");
const deleted = await import("../src/app/api/together/boards/[id]/tasks/deleted/route");
const task = await import("../src/app/api/together/boards/[id]/tasks/[taskId]/route");
const history = await import("../src/app/api/together/boards/[id]/tasks/history/route");
const restore = await import("../src/app/api/together/boards/[id]/tasks/[taskId]/restore/route");
const groups = await import("../src/app/api/together/boards/[id]/groups/route");
const group = await import("../src/app/api/together/boards/[id]/groups/[groupId]/route");
const boardRoute = await import("../src/app/api/together/boards/[id]/route");
const memberRoute = await import("../src/app/api/together/boards/[id]/members/[userId]/route");
const leaveRoute = await import("../src/app/api/together/boards/[id]/leave/route");
const invitations = await import("../src/app/api/together/boards/[id]/invitations/route");
const lib = await import("../src/lib/together/work");

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
/** A space with an owner and members — joined directly, as accepting an invitation would. */
async function space(owner: string, members: string[] = [], name = "Headband") {
  const [b] = await sql(`insert into together_boards (name, created_by) values ($1, $2) returning id`, [name, owner]);
  await sql(`insert into together_members (board_id, user_id, role, added_by) values ($1, $2, 'owner', $2)`, [b.id, owner]);
  for (const m of members) {
    await sql(`insert into together_members (board_id, user_id, role, added_by) values ($1, $2, 'member', $3)`, [b.id, m, owner]);
  }
  return b.id as string;
}

const req = (body?: unknown, method = "POST", url = "http://x/api") =>
  new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const as = (id: string | null) => { signedIn = id; };
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) });
const P = (id: string) => ({ params: { id } });
const T = (id: string, taskId: string) => ({ params: { id, taskId } });
const G = (id: string, groupId: string) => ({ params: { id, groupId } });

async function add(who: string, id: string, title: string, stage?: string) {
  as(who);
  const r = await json(await tasks.POST(req(stage ? { title, stage } : { title }), P(id)));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.task as { id: string; stage: string; movedAt: string; textVersion: number; assignees: string[] };
}
async function patch(who: string, id: string, taskId: string, body: unknown) {
  as(who);
  return json(await task.PATCH(req(body, "PATCH"), T(id, taskId)));
}
async function view(who: string, id: string) {
  as(who);
  const r = await json(await work.GET(req(undefined, "GET"), P(id)));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as { tasks: { id: string; stage: string; title: string; assignees: string[]; groupId: string | null }[];
    history: { tasks: { id: string; title: string; movedAt: string }[]; more: boolean; total: number }; groups: { id: string; name: string }[]; members: { id: string }[]; space: { archived: boolean } };
}
const stageIds = async (who: string, id: string, stage: string) =>
  (await view(who, id)).tasks.filter((x) => x.stage === stage).map((x) => x.id);

beforeEach(async () => {
  db = await PGlite.create();
  open.push(db);
  await db.exec(SCHEMA);
  (globalThis as any).__tgDb = db;
  tracked.length = 0;
  signedIn = null;
});

describe("who may touch a space's work", () => {
  it("answers a non-member exactly as a space that does not exist — on every route — and changes nothing", async () => {
    const owner = await account("Hippo");
    const stranger = await account("Stranger");
    allow(owner, stranger);
    const id = await space(owner);
    const t = await add(owner, id, "Request supplier quotes");
    const [{ id: g }] = await sql(`insert into together_groups (board_id, name) values ($1, 'Sourcing') returning id`, [id]);
    const before = JSON.stringify(await sql(`select * from together_tasks order by id`));

    as(stranger);
    const missing = randomUUID();
    const calls: [string, () => Promise<Response>][] = [
      ["work", () => work.GET(req(undefined, "GET"), P(id))],
      ["history", () => history.GET(req(undefined, "GET", "http://x/api?cursor="), P(id))],
      ["create", () => tasks.POST(req({ title: "x" }), P(id))],
      ["deleted", () => deleted.GET(req(undefined, "GET"), P(id))],
      ["task", () => task.GET(req(undefined, "GET"), T(id, t.id))],
      ["patch", () => task.PATCH(req({ stage: "done" }, "PATCH"), T(id, t.id))],
      ["delete", () => task.DELETE(req(undefined, "DELETE"), T(id, t.id))],
      ["restore", () => restore.POST(req(), T(id, t.id))],
      ["group create", () => groups.POST(req({ name: "Mine" }), P(id))],
      ["group rename", () => group.PATCH(req({ name: "Mine" }, "PATCH"), G(id, g))],
      ["group delete", () => group.DELETE(req(undefined, "DELETE"), G(id, g))],
    ];
    const theirs = await json(await work.GET(req(undefined, "GET"), P(id)));
    const nowhere = await json(await work.GET(req(undefined, "GET"), P(missing)));
    const garbage = await json(await work.GET(req(undefined, "GET"), P("not-a-uuid")));
    expect(theirs).toEqual(nowhere);
    expect(garbage).toEqual(nowhere);
    for (const [name, call] of calls) expect((await call()).status, name).toBe(404);
    expect(JSON.stringify(await sql(`select * from together_tasks order by id`))).toBe(before);
    expect((await sql(`select name from together_groups where id = $1`, [g]))[0].name).toBe("Sourcing");

    // Signed out: 401. Together switched off (empty list): 404, even for the owner.
    as(null);
    expect((await work.GET(req(undefined, "GET"), P(id))).status).toBe(401);
    allow();
    as(owner);
    expect((await work.GET(req(undefined, "GET"), P(id))).status).toBe(404);
    expect((await tasks.POST(req({ title: "x" }), P(id))).status).toBe(404);
  });

  it("lets a member who is here by invitation (not on the preview list) work like anyone else in the space", async () => {
    const owner = await account("Hippo");
    const meimei = await account("Meimei");
    allow(owner);
    const id = await space(owner, [meimei]);
    const t = await add(meimei, id, "Review fabric samples", "doing");
    expect((await patch(meimei, id, t.id, { assignees: [meimei] })).status).toBe(200);
    expect((await view(owner, id)).tasks.find((x) => x.id === t.id)?.assignees).toEqual([meimei]);
  });

  it("makes an archived space read-only for every write, and keeps it readable", async () => {
    const owner = await account("Hippo");
    const meimei = await account("Meimei");
    allow(owner, meimei);
    const id = await space(owner, [meimei]);
    const t = await add(owner, id, "Finalize first headband design");
    const gone = await add(owner, id, "Old idea", "backlog");
    as(owner);
    await task.DELETE(req(undefined, "DELETE"), T(id, gone.id));
    const [{ id: g }] = await sql(`insert into together_groups (board_id, name) values ($1, 'Product') returning id`, [id]);
    as(owner);
    expect((await boardRoute.PATCH(req({ archived: true }, "PATCH"), P(id))).status).toBe(200);
    const before = JSON.stringify([await sql(`select * from together_tasks order by id`), await sql(`select * from together_groups`),
      await sql(`select * from together_task_assignees`)]);

    for (const who of [owner, meimei]) {
      as(who);
      const writes: [string, () => Promise<Response>][] = [
        ["create", () => tasks.POST(req({ title: "x" }), P(id))],
        ["capture", () => tasks.POST(req({ title: "x", stage: "backlog" }), P(id))],
        ["edit", () => task.PATCH(req({ title: "y", textVersion: 1 }, "PATCH"), T(id, t.id))],
        ["move", () => task.PATCH(req({ stage: "done" }, "PATCH"), T(id, t.id))],
        ["assign", () => task.PATCH(req({ assignees: [who] }, "PATCH"), T(id, t.id))],
        ["group", () => task.PATCH(req({ groupId: g }, "PATCH"), T(id, t.id))],
        ["effort", () => task.PATCH(req({ effort: 3 }, "PATCH"), T(id, t.id))],
        ["due", () => task.PATCH(req({ dueOn: "2026-10-09" }, "PATCH"), T(id, t.id))],
        ["delete", () => task.DELETE(req(undefined, "DELETE"), T(id, t.id))],
        ["restore", () => restore.POST(req(), T(id, gone.id))],
        ["group create", () => groups.POST(req({ name: "Sourcing" }), P(id))],
        ["group rename", () => group.PATCH(req({ name: "Design" }, "PATCH"), G(id, g))],
        ["group delete", () => group.DELETE(req(undefined, "DELETE"), G(id, g))],
      ];
      for (const [name, call] of writes) expect((await call()).status, `${name} as ${who === owner ? "owner" : "member"}`).toBe(409);
      expect((await work.GET(req(undefined, "GET"), P(id))).status).toBe(200);
      expect((await task.GET(req(undefined, "GET"), T(id, t.id))).status).toBe(200);
      expect((await deleted.GET(req(undefined, "GET"), P(id))).status).toBe(200);
    }
    expect(JSON.stringify([await sql(`select * from together_tasks order by id`), await sql(`select * from together_groups`),
      await sql(`select * from together_task_assignees`)])).toBe(before);
    expect((await view(meimei, id)).space.archived).toBe(true);
  });

  it("tells Members whether this reader may invite — the rule the invitation route enforces", async () => {
    const owner = await account("Hippo");
    const peer = await account("Eddie");
    const meimei = await account("Meimei");
    allow(owner, peer);
    const id = await space(owner, [peer, meimei]);
    const members = async (who: string) => { as(who); return (await json(await boardRoute.GET(req(undefined, "GET"), P(id)))).body; };

    // On the preview list: owner and member alike may invite.
    for (const who of [owner, peer]) expect((await members(who)).canInvite).toBe(true);
    // Here by invitation only: no invite form, and the route refuses (403 — they already know the space).
    expect((await members(meimei)).canInvite).toBe(false);
    as(meimei);
    expect((await invitations.POST(req({ email: "someone@example.com" }), P(id))).status).toBe(403);
    expect(await sql(`select id from together_invitations`)).toEqual([]);

    // Archived: nobody may invite.
    as(owner);
    expect((await boardRoute.PATCH(req({ archived: true }, "PATCH"), P(id))).status).toBe(200);
    for (const who of [owner, peer, meimei]) expect((await members(who)).canInvite).toBe(false);
  });
});

describe("nothing crosses between spaces", () => {
  it("refuses another space's task, group or person — through this space's address", async () => {
    const hippo = await account("Hippo");
    const meimei = await account("Meimei");
    const other = await account("Other");
    allow(hippo, meimei, other);
    const mine = await space(hippo, [meimei]);
    const theirs = await space(other, [hippo], "Garden");
    const theirTask = await add(other, theirs, "Their private task");
    as(other);
    const { body: { group: theirGroup } } = await json(await groups.POST(req({ name: "Their group" }), P(theirs)));
    const myTask = await add(hippo, mine, "Request supplier quotes");

    as(hippo); // a member of both spaces, asking through the wrong one
    expect((await task.GET(req(undefined, "GET"), T(mine, theirTask.id))).status).toBe(404);
    expect((await task.PATCH(req({ stage: "done" }, "PATCH"), T(mine, theirTask.id))).status).toBe(404);
    expect((await task.DELETE(req(undefined, "DELETE"), T(mine, theirTask.id))).status).toBe(404);
    expect((await restore.POST(req(), T(mine, theirTask.id))).status).toBe(404);
    expect((await patch(hippo, mine, myTask.id, { groupId: theirGroup.id })).status).toBe(409);
    expect((await group.PATCH(req({ name: "x" }, "PATCH"), G(mine, theirGroup.id))).status).toBe(409);
    as(hippo);
    await group.DELETE(req(undefined, "DELETE"), G(mine, theirGroup.id));
    expect((await sql(`select count(*)::int n from together_groups where id = $1`, [theirGroup.id]))[0].n).toBe(1);
    // `other` is in Garden only: not assignable in Headband.
    const r = await patch(hippo, mine, myTask.id, { assignees: [other] });
    expect(r.status).toBe(400);
    expect((await sql(`select stage from together_tasks where id = $1`, [theirTask.id]))[0].stage).toBe("todo");
    expect((await view(hippo, mine)).tasks.map((x) => x.id)).toEqual([myTask.id]);
  });
});

describe("assignees", () => {
  it("holds none, one or several people on one task — never a copy per person — and only current members", async () => {
    const hippo = await account("Hippo");
    const meimei = await account("Meimei");
    const outsider = await account("Out");
    allow(hippo, meimei, outsider);
    const id = await space(hippo, [meimei]);
    const t = await add(hippo, id, "Supplier pricing confirmation", "waiting");
    expect((await view(hippo, id)).tasks[0].assignees).toEqual([]);
    expect((await patch(hippo, id, t.id, { assignees: [hippo, meimei] })).body.task.assignees.sort()).toEqual([hippo, meimei].sort());
    expect((await sql(`select count(*)::int n from together_tasks where board_id = $1`, [id]))[0].n).toBe(1);
    expect((await patch(hippo, id, t.id, { assignees: [meimei, outsider] })).status).toBe(400);
    expect((await patch(hippo, id, t.id, { assignees: ["not-a-uuid"] })).status).toBe(400);
    expect((await patch(hippo, id, t.id, { assignees: Array.from({ length: 21 }, () => randomUUID()) })).status).toBe(400);
    // A refused change leaves the assignment as it was.
    expect((await view(meimei, id)).tasks[0].assignees.sort()).toEqual([hippo, meimei].sort());
    expect((await patch(meimei, id, t.id, { assignees: [] })).body.task.assignees).toEqual([]);
  });

  it("clears someone's assignments when they are removed or leave — and keeps the work", async () => {
    const hippo = await account("Hippo");
    const meimei = await account("Meimei");
    const eddie = await account("Eddie");
    allow(hippo, meimei, eddie);
    const id = await space(hippo, [meimei, eddie]);
    const a = await add(hippo, id, "Review fabric samples", "doing");
    const b = await add(hippo, id, "Request supplier quotes");
    await patch(hippo, id, a.id, { assignees: [meimei, hippo] });
    await patch(hippo, id, b.id, { assignees: [eddie] });

    as(hippo);
    expect((await memberRoute.DELETE(req(undefined, "DELETE"), { params: { id, userId: meimei } })).status).toBe(200);
    as(eddie);
    expect((await leaveRoute.POST(req(), P(id))).status).toBe(200);

    const after = await view(hippo, id);
    expect(after.tasks.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(after.tasks.find((x) => x.id === a.id)?.assignees).toEqual([hippo]);
    expect(after.tasks.find((x) => x.id === b.id)?.assignees).toEqual([]);
    // And they no longer reach the work at all.
    as(meimei);
    expect((await work.GET(req(undefined, "GET"), P(id))).status).toBe(404);
  });
});

describe("creator and former members", () => {
  it("records who added a task once, never changes it, and shows a departed creator only as a former member", async () => {
    const hippo = await account("Hippo");
    const meimei = await account("Meimei");
    allow(hippo, meimei);
    const id = await space(hippo, [meimei]);
    const t = await add(meimei, id, "Define initial product concept");
    // A request cannot name a creator; reassigning never touches it.
    await patch(hippo, id, t.id, { assignees: [hippo], createdBy: hippo, created_by: hippo } as any);
    as(hippo);
    let detail = (await json(await task.GET(req(undefined, "GET"), T(id, t.id)))).body;
    expect(detail.createdBy).toEqual({ id: meimei, name: "Meimei" });
    expect(detail.updatedBy).toEqual({ id: hippo, name: "Hippo" });
    expect((await sql(`select created_by from together_tasks where id = $1`, [t.id]))[0].created_by).toBe(meimei);

    as(meimei);
    await leaveRoute.POST(req(), P(id));
    as(hippo);
    detail = (await json(await task.GET(req(undefined, "GET"), T(id, t.id)))).body;
    expect(detail.createdBy).toBeNull(); // "Former member" — no name kept or shown
    expect((await sql(`select created_by from together_tasks where id = $1`, [t.id]))[0].created_by).toBe(meimei);
    expect(JSON.stringify(detail)).not.toContain("Meimei");

    await sql(`delete from users where id = $1`, [meimei]);
    detail = (await json(await task.GET(req(undefined, "GET"), T(id, t.id)))).body;
    expect(detail.createdBy).toBeNull();
    expect(detail.title).toBe("Define initial product concept");
  });
});

describe("order: the newest move on top", () => {
  it("puts new and moved work at the top of its stage, never reorders on an edit, and undoes a move to the top of the old stage", async () => {
    const hippo = await account("Hippo");
    allow(hippo);
    const id = await space(hippo);
    const a = await add(hippo, id, "A");
    const b = await add(hippo, id, "B");
    const c = await add(hippo, id, "C");
    expect(await stageIds(hippo, id, "todo")).toEqual([c.id, b.id, a.id]);

    // Editing details keeps the place.
    await patch(hippo, id, a.id, { title: "A, renamed", textVersion: 1 });
    await patch(hippo, id, a.id, { effort: 5, dueOn: "2026-10-09", assignees: [hippo] });
    expect(await stageIds(hippo, id, "todo")).toEqual([c.id, b.id, a.id]);

    // Moving brings it to the top of where it goes.
    await patch(hippo, id, a.id, { stage: "doing" });
    const x = await add(hippo, id, "X", "doing");
    await patch(hippo, id, b.id, { stage: "doing" });
    expect(await stageIds(hippo, id, "doing")).toEqual([b.id, x.id, a.id]);

    // Undo = move back: the top of the former stage, not its old slot.
    await patch(hippo, id, b.id, { stage: "todo" });
    expect(await stageIds(hippo, id, "todo")).toEqual([b.id, c.id]);

    // Moving to where it already is changes nothing.
    const before = (await sql(`select moved_at from together_tasks where id = $1`, [c.id]))[0].moved_at;
    await patch(hippo, id, c.id, { stage: "todo" });
    expect((await sql(`select moved_at from together_tasks where id = $1`, [c.id]))[0].moved_at).toEqual(before);
  });

  it("commits from the Backlog to the top of To do, and can send work back", async () => {
    const hippo = await account("Hippo");
    allow(hippo);
    const id = await space(hippo);
    await add(hippo, id, "Finalize first headband design");
    const idea = await add(hippo, id, "Research packaging options", "backlog");
    expect(await stageIds(hippo, id, "backlog")).toEqual([idea.id]);
    expect((await patch(hippo, id, idea.id, { stage: "todo" })).status).toBe(200);
    expect((await stageIds(hippo, id, "todo"))[0]).toBe(idea.id);
    expect((await patch(hippo, id, idea.id, { stage: "backlog" })).status).toBe(200);
    expect(await stageIds(hippo, id, "backlog")).toEqual([idea.id]);
  });
});

describe("two people at once", () => {
  it("lets independent small changes both land", async () => {
    const hippo = await account("Hippo");
    const meimei = await account("Meimei");
    allow(hippo, meimei);
    const id = await space(hippo, [meimei]);
    const t = await add(hippo, id, "Request supplier quotes");
    await patch(hippo, id, t.id, { stage: "doing" });
    await patch(meimei, id, t.id, { effort: 3 });
    await patch(hippo, id, t.id, { dueOn: "2026-10-12" });
    await patch(meimei, id, t.id, { assignees: [meimei] });
    const [row] = await sql(`select stage, effort, due_on::text as due, text_version from together_tasks where id = $1`, [t.id]);
    expect(row).toEqual({ stage: "doing", effort: 3, due: "2026-10-12", text_version: 1 });
  });

  it("refuses words edited from an older version — no silent overwrite — and accepts them from the current one", async () => {
    const hippo = await account("Hippo");
    const meimei = await account("Meimei");
    allow(hippo, meimei);
    const id = await space(hippo, [meimei]);
    const t = await add(hippo, id, "Compare supplier samples");
    // Both open the task at version 1. A move in between does not count as an edit of the words.
    await patch(meimei, id, t.id, { stage: "doing" });
    const first = await patch(hippo, id, t.id, { description: "Hippo's notes", textVersion: 1 });
    expect(first.status).toBe(200);
    expect(first.body.task.textVersion).toBe(2);
    const second = await patch(meimei, id, t.id, { description: "Meimei's notes", textVersion: 1 });
    expect(second.status).toBe(409);
    expect((await sql(`select description from together_tasks where id = $1`, [t.id]))[0].description).toBe("Hippo's notes");
    // Without a version at all, also refused.
    expect((await patch(meimei, id, t.id, { title: "x" })).status).toBe(409);
    // From the current version ("Keep mine"), it lands.
    expect((await patch(meimei, id, t.id, { description: "Meimei's notes", textVersion: 2 })).status).toBe(200);
    // Saving words that did not change is not a conflict, whatever the version.
    expect((await patch(hippo, id, t.id, { title: "Compare supplier samples", textVersion: 1 })).status).toBe(200);
  });

  it("tells someone editing a deleted task that it was deleted, and lets them restore it", async () => {
    const hippo = await account("Hippo");
    const meimei = await account("Meimei");
    allow(hippo, meimei);
    const id = await space(hippo, [meimei]);
    const t = await add(hippo, id, "Explore Amazon launch plan", "backlog");
    as(meimei);
    expect((await task.DELETE(req(undefined, "DELETE"), T(id, t.id))).status).toBe(200);
    const r = await patch(hippo, id, t.id, { title: "Explore launch", textVersion: 1 });
    expect(r.status).toBe(410);
    as(hippo);
    const detail = (await json(await task.GET(req(undefined, "GET"), T(id, t.id)))).body;
    expect(detail.deletedBy).toEqual({ id: meimei, name: "Meimei" });
    expect((await restore.POST(req(), T(id, t.id))).status).toBe(200);
    expect((await patch(hippo, id, t.id, { title: "Explore launch", textVersion: 1 })).status).toBe(200);
  });
});

describe("soft delete", () => {
  it("takes a task out of every view but Recently deleted, and restores it to the same stage and place", async () => {
    const hippo = await account("Hippo");
    const meimei = await account("Meimei");
    allow(hippo, meimei);
    const id = await space(hippo, [meimei]);
    const a = await add(hippo, id, "A");
    const b = await add(hippo, id, "B");
    await add(hippo, id, "C");
    await patch(hippo, id, b.id, { assignees: [meimei] });
    as(meimei);
    expect((await task.DELETE(req(undefined, "DELETE"), T(id, b.id))).status).toBe(200);
    expect((await task.DELETE(req(undefined, "DELETE"), T(id, b.id))).status).toBe(200); // again: nothing changes
    expect((await view(hippo, id)).tasks.map((x) => x.id)).not.toContain(b.id);
    as(hippo);
    const list = (await json(await deleted.GET(req(undefined, "GET"), P(id)))).body;
    expect(list.map((x: any) => x.id)).toEqual([b.id]);
    expect(list[0].deletedBy).toEqual({ id: meimei, name: "Meimei" });

    as(hippo);
    const back = (await json(await restore.POST(req(), T(id, b.id)))).body.task;
    expect(back.stage).toBe("todo");
    expect(back.assignees).toEqual([meimei]);
    expect((await stageIds(hippo, id, "todo")).indexOf(b.id)).toBe(1); // between C and A, as before
    expect((await stageIds(hippo, id, "todo")).at(-1)).toBe(a.id);
    expect((await json(await deleted.GET(req(undefined, "GET"), P(id)))).body).toEqual([]);
    expect((await sql(`select count(*)::int n from together_tasks`))[0].n).toBe(3);
  });
});

describe("Done for 24 hours, then History", () => {
  const page = async (who: string, id: string, cursor = "") => {
    as(who);
    return (await json(await history.GET(req(undefined, "GET", `http://x/api?cursor=${encodeURIComponent(cursor)}`), P(id)))).body;
  };

  it("pages History newest-finished first, without gaps or repeats, and never deletes old work", async () => {
    const hippo = await account("Hippo");
    allow(hippo);
    const id = await space(hippo);
    for (let i = 0; i < 25; i++) {
      await sql(`insert into together_tasks (board_id, title, stage, moved_at, created_by)
        values ($1, $2, 'done', now() - make_interval(days => 2 + $3), $4)`, [id, `old ${i}`, i, hippo]);
    }
    for (let i = 0; i < 3; i++) await add(hippo, id, `recent ${i}`, "done");
    const w = await view(hippo, id);
    expect(w.tasks.filter((x) => x.stage === "done").map((x) => x.title)).toEqual(["recent 2", "recent 1", "recent 0"]);
    expect(w.history.total).toBe(25);
    expect(w.history.tasks).toHaveLength(20);
    expect(w.history.more).toBe(true);
    const l1 = w.history.tasks.at(-1)!;
    const p2 = await page(hippo, id, `${l1.movedAt}|${l1.id}`);
    expect(p2.tasks).toHaveLength(5);
    expect(p2.more).toBe(false);
    const titles = [...w.history.tasks, ...p2.tasks].map((x: any) => x.title);
    expect(new Set(titles).size).toBe(25);
    expect(titles[0]).toBe("old 0");
    expect(titles.at(-1)).toBe("old 24");
    expect((await sql(`select count(*)::int n from together_tasks where deleted_at is null`))[0].n).toBe(28);
  });

  it("ties microsecond-identical completions deterministically (id), and ignores a malformed cursor", async () => {
    const hippo = await account("Hippo");
    allow(hippo);
    const id = await space(hippo);
    await sql(`insert into together_tasks (board_id, title, stage, moved_at) select $1, 't' || g, 'done', '2026-01-01T00:00:00Z'
      from generate_series(1, 25) g`, [id]);
    const p1 = await page(hippo, id, "nonsense");
    const l = p1.tasks.at(-1);
    const p2 = await page(hippo, id, `${l.movedAt}|${l.id}`);
    const ids = [...p1.tasks, ...p2.tasks].map((x: any) => x.id);
    expect(new Set(ids).size).toBe(25);
    expect(ids).toEqual([...ids].sort().reverse());
  });
});

describe("groups", () => {
  it("are labels: created once per name (ignoring case), renamed, deleted without touching their tasks, thirty at most", async () => {
    const hippo = await account("Hippo");
    allow(hippo);
    const id = await space(hippo);
    as(hippo);
    const a = (await json(await groups.POST(req({ name: "  Sourcing " }), P(id)))).body.group;
    expect(a.name).toBe("Sourcing");
    const again = (await json(await groups.POST(req({ name: "sourcing" }), P(id)))).body.group;
    expect(again.id).toBe(a.id); // "Create 'sourcing'" picks the existing one
    const b = (await json(await groups.POST(req({ name: "Product" }), P(id)))).body.group;
    expect((await group.PATCH(req({ name: "SOURCING" }, "PATCH"), G(id, b.id))).status).toBe(409);
    expect((await json(await group.PATCH(req({ name: "Design" }, "PATCH"), G(id, b.id)))).body.group.name).toBe("Design");
    expect((await groups.POST(req({ name: "" }), P(id))).status).toBe(400);
    expect((await groups.POST(req({ name: "x".repeat(41) }), P(id))).status).toBe(400);

    const t = await add(hippo, id, "Request supplier quotes");
    await patch(hippo, id, t.id, { groupId: a.id });
    as(hippo);
    expect((await group.DELETE(req(undefined, "DELETE"), G(id, a.id))).status).toBe(200);
    const after = await view(hippo, id);
    expect(after.tasks[0].groupId).toBeNull();
    expect(after.tasks[0].title).toBe("Request supplier quotes");
    expect((await patch(hippo, id, t.id, { groupId: a.id })).status).toBe(409); // deleted group

    as(hippo);
    for (let i = 0; i < 29; i++) expect((await groups.POST(req({ name: `G${i}` }), P(id))).status).toBe(200);
    expect((await groups.POST(req({ name: "One too many" }), P(id))).status).toBe(409);
    expect((await sql(`select count(*)::int n from together_groups where board_id = $1`, [id]))[0].n).toBe(30);
  });
});

describe("validation", () => {
  it("keeps a task small and well-formed", async () => {
    const hippo = await account("Hippo");
    allow(hippo);
    const id = await space(hippo);
    as(hippo);
    expect((await tasks.POST(req({ title: "   " }), P(id))).status).toBe(400);
    expect((await tasks.POST(req({ title: "x".repeat(201) }), P(id))).status).toBe(400);
    expect((await tasks.POST(req({ title: "x", stage: "someday" }), P(id))).status).toBe(400);
    const t = await add(hippo, id, "  Finalize\n first   design ");
    expect(t.stage).toBe("todo"); // the default
    expect((await view(hippo, id)).tasks[0].title).toBe("Finalize first design");
    for (const effort of [0, 4, 13, 99, "3", 2.5]) expect((await patch(hippo, id, t.id, { effort })).status, String(effort)).toBe(400);
    for (const effort of [1, 2, 3, 5, 8, null]) expect((await patch(hippo, id, t.id, { effort })).status, String(effort)).toBe(200);
    for (const dueOn of ["2026-02-30", "2026-13-01", "1999-12-31", "2101-01-01", "tomorrow", "2026-10-09T00:00:00Z"]) {
      expect((await patch(hippo, id, t.id, { dueOn })).status, dueOn).toBe(400);
    }
    expect((await patch(hippo, id, t.id, { dueOn: "2028-02-29" })).status).toBe(200);
    expect((await patch(hippo, id, t.id, { dueOn: null })).status).toBe(200);
    expect((await patch(hippo, id, t.id, { description: "x".repeat(10001), textVersion: 1 })).status).toBe(400);
    expect((await patch(hippo, id, t.id, { description: "Line one\nLine two  ", textVersion: 1 })).status).toBe(200);
    expect((await sql(`select description from together_tasks where id = $1`, [t.id]))[0].description).toBe("Line one\nLine two");
    expect((await patch(hippo, id, randomUUID(), { stage: "done" })).status).toBe(404);
    expect((await patch(hippo, id, "nope", { stage: "done" })).status).toBe(404);
  });

  it("caps open work per space, but never blocks finishing or capturing into Done", async () => {
    const hippo = await account("Hippo");
    allow(hippo);
    const id = await space(hippo);
    await sql(`insert into together_tasks (board_id, title, stage) select $1, 't' || g, 'todo' from generate_series(1, $2::int) g`,
      [id, lib.MAX_OPEN_TASKS]);
    as(hippo);
    expect((await tasks.POST(req({ title: "one more" }), P(id))).status).toBe(409);
    expect((await tasks.POST(req({ title: "already done", stage: "done" }), P(id))).status).toBe(200);
    const [{ id: some }] = await sql(`select id from together_tasks where board_id = $1 and stage = 'todo' limit 1`, [id]);
    expect((await patch(hippo, id, some, { stage: "done" })).status).toBe(200);
  });
});

describe("privacy", () => {
  it("records only stage keys and counts — never a title, description, group name or who", async () => {
    const hippo = await account("Hippo");
    const meimei = await account("Meimei");
    allow(hippo, meimei);
    const id = await space(hippo, [meimei]);
    const secret = "Secret supplier Zhejiang";
    const t = await add(hippo, id, secret, "backlog");
    await patch(hippo, id, t.id, { stage: "todo" });
    await patch(hippo, id, t.id, { assignees: [hippo, meimei] });
    await patch(hippo, id, t.id, { description: "Private notes about margins", textVersion: 1 });
    as(hippo);
    const { body: { group: g } } = await json(await groups.POST(req({ name: "Confidential group" }), P(id)));
    await patch(hippo, id, t.id, { groupId: g.id });
    as(hippo);
    await task.DELETE(req(undefined, "DELETE"), T(id, t.id));
    await restore.POST(req(), T(id, t.id));
    await group.DELETE(req(undefined, "DELETE"), G(id, g.id));

    expect(tracked.map((e) => e.event)).toEqual([
      "together_task_created", "together_task_moved", "together_task_assignees_set",
      "together_group_created", "together_task_deleted", "together_task_restored", "together_group_deleted",
    ]);
    const text = JSON.stringify(tracked);
    for (const leak of [secret, "Private notes", "Confidential group", meimei, t.id, g.id]) expect(text).not.toContain(leak);
    for (const e of tracked) {
      expect(e.entityId).toBeUndefined();
      for (const [k, v] of Object.entries(e.properties ?? {})) {
        expect(["stage", "from", "to", "count"]).toContain(k);
        expect(typeof v === "number" || ["backlog", "todo", "doing", "waiting", "done"].includes(v as string)).toBe(true);
      }
    }
  });

  it("never shows another member's email address in the work", async () => {
    const hippo = await account("Hippo");
    const meimei = await account("Meimei");
    allow(hippo, meimei);
    const id = await space(hippo, [meimei]);
    const t = await add(meimei, id, "Task");
    await patch(meimei, id, t.id, { assignees: [hippo, meimei] });
    as(hippo);
    const everything = JSON.stringify([await view(hippo, id),
      (await json(await task.GET(req(undefined, "GET"), T(id, t.id)))).body]);
    expect(everything).not.toMatch(/@example\.com/);
  });
});
