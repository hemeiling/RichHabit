import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Together — the unified work surface's ordering and History, through the real
 * routes and data layer, on Postgres (PGlite).
 *
 * Ordering: sparse ranks assigned by the server from intent (top, bottom, up,
 * down, before/after a visible task); a list renumbered only when a gap runs
 * out; deleted and History tasks never act as neighbours, but keep their place
 * through a renumber so a restore lands where it was — and a restore never
 * leaves two visible tasks on one rank.
 *
 * History: a Done task leaves the Board exactly 24 elapsed hours after it most
 * recently entered Done (the database's clock), shows in History, and can only
 * be reopened.
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
const tracked: { event: string; properties?: Record<string, unknown>; entityId?: unknown }[] = [];
vi.mock("@/lib/analytics/track", () => ({ trackEvent: async (e: any) => { tracked.push(e); } }));

const work = await import("../src/app/api/together/boards/[id]/work/route");
const tasks = await import("../src/app/api/together/boards/[id]/tasks/route");
const task = await import("../src/app/api/together/boards/[id]/tasks/[taskId]/route");
const move = await import("../src/app/api/together/boards/[id]/tasks/[taskId]/move/route");
const restore = await import("../src/app/api/together/boards/[id]/tasks/[taskId]/restore/route");
const history = await import("../src/app/api/together/boards/[id]/tasks/history/route");
const boardRoute = await import("../src/app/api/together/boards/[id]/route");

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
async function space(owner: string, members: string[] = []) {
  const [b] = await sql(`insert into together_boards (name, created_by) values ('Headband', $1) returning id`, [owner]);
  await sql(`insert into together_members (board_id, user_id, role, added_by) values ($1, $2, 'owner', $2)`, [b.id, owner]);
  for (const m of members) await sql(`insert into together_members (board_id, user_id, role, added_by) values ($1, $2, 'member', $3)`, [b.id, m, owner]);
  return b.id as string;
}
const req = (body?: unknown, method = "POST", url = "http://x/api") =>
  new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const as = (id: string | null) => { signedIn = id; };
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) });
const P = (id: string) => ({ params: { id } });
const T = (id: string, taskId: string) => ({ params: { id, taskId } });

let who = "";
let sid = "";
async function add(title: string, stage?: string) {
  as(who);
  const r = await json(await tasks.POST(req(stage ? { title, stage } : { title }), P(sid)));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.task.id as string;
}
async function mv(taskId: string, intent: Record<string, unknown>) {
  as(who);
  return json(await move.POST(req(intent), T(sid, taskId)));
}
async function del(taskId: string) { as(who); expect((await task.DELETE(req(undefined, "DELETE"), T(sid, taskId))).status).toBe(200); }
async function undel(taskId: string) { as(who); return json(await restore.POST(req(), T(sid, taskId))); }
const titles = async (stage: string) => {
  as(who);
  const w = (await json(await work.GET(req(undefined, "GET"), P(sid)))).body;
  return (w.tasks as any[]).filter((t) => t.stage === stage).map((t) => t.title as string);
};
const idOf = async (title: string) => (await sql(`select id from together_tasks where title = $1`, [title]))[0].id as string;
const visibleRanks = async (stage: string) => (await sql(
  `select rank::text r from together_tasks where board_id = $1 and stage = $2 and deleted_at is null order by rank`, [sid, stage])).map((r) => r.r);
/** Every column except rank and the bookkeeping of the moved task — to prove a renumber writes rank only. */
const allButRank = async () => JSON.stringify(await sql(
  `select id, board_id, title, description, stage, moved_at, group_id, effort, due_on, created_by, updated_by, text_version,
          created_at, updated_at, deleted_at, deleted_by from together_tasks order by id`));

beforeEach(async () => {
  db = await PGlite.create();
  open.push(db);
  await db.exec(SCHEMA);
  (globalThis as any).__tgDb = db;
  tracked.length = 0;
  who = await account("Hippo");
  allow(who);
  sid = await space(who);
});

describe("ordering within a list", () => {
  it("puts new work on top, and places a task exactly where it is dropped", async () => {
    for (const t of ["A", "B", "C"]) await add(t);
    expect(await titles("todo")).toEqual(["C", "B", "A"]);
    expect((await mv(await idOf("A"), { stage: "todo", before: await idOf("C") })).status).toBe(200);
    expect(await titles("todo")).toEqual(["A", "C", "B"]);
    await mv(await idOf("A"), { stage: "todo", after: await idOf("B") });
    expect(await titles("todo")).toEqual(["C", "B", "A"]);
    await mv(await idOf("B"), { stage: "todo", after: await idOf("C") });   // already there
    expect(await titles("todo")).toEqual(["C", "B", "A"]);
  });

  it("moves up, down, to the top and to the bottom — and up from the top changes nothing", async () => {
    for (const t of ["A", "B", "C", "D"]) await add(t);   // D C B A
    await mv(await idOf("A"), { place: "up" });
    expect(await titles("todo")).toEqual(["D", "C", "A", "B"]);
    await mv(await idOf("D"), { place: "down" });
    expect(await titles("todo")).toEqual(["C", "D", "A", "B"]);
    await mv(await idOf("B"), { place: "top" });
    expect(await titles("todo")).toEqual(["B", "C", "D", "A"]);
    await mv(await idOf("B"), { place: "bottom" });
    expect(await titles("todo")).toEqual(["C", "D", "A", "B"]);
    const r = await mv(await idOf("C"), { place: "up" });
    expect(r.body.unchanged).toBe(true);
    expect(await titles("todo")).toEqual(["C", "D", "A", "B"]);
  });

  it("moves across lists to an exact place, and commits from the Backlog to the top of To do by default", async () => {
    for (const t of ["A", "B"]) await add(t);                // todo: B A
    for (const t of ["X", "Y"]) await add(t, "doing");      // doing: Y X
    const idea = await add("Idea", "backlog");
    await mv(await idOf("A"), { stage: "doing", after: await idOf("Y") });
    expect(await titles("doing")).toEqual(["Y", "A", "X"]);
    expect(await titles("todo")).toEqual(["B"]);
    await mv(idea, { stage: "todo" });
    expect(await titles("todo")).toEqual(["Idea", "B"]);
    await mv(idea, { stage: "backlog" });
    expect(await titles("backlog")).toEqual(["Idea"]);
  });

  it("ignores a neighbour from another list, another space or the deleted — and goes to the top instead", async () => {
    for (const t of ["A", "B"]) await add(t);
    const elsewhere = await add("Elsewhere", "doing");
    const gone = await add("Gone");
    await del(gone);
    const other = await space(who);
    as(who);
    const foreign = (await json(await tasks.POST(req({ title: "Foreign" }), P(other)))).body.task.id;
    for (const n of [elsewhere, gone, foreign, randomUUID()]) {
      await mv(await idOf("A"), { stage: "todo", before: n });
      expect((await titles("todo"))[0]).toBe("A");
      await mv(await idOf("A"), { place: "bottom" });
    }
  });

  it("orders deterministically when ranks tie (id), and a pre-ordering task (null rank) sorts first and is ranked on the next placement", async () => {
    for (const t of ["A", "B"]) await add(t);
    await sql(`insert into together_tasks (board_id, title, stage) values ($1, 'Legacy', 'todo')`, [sid]);
    expect((await titles("todo"))[0]).toBe("Legacy");
    await mv(await idOf("A"), { place: "top" });
    expect(await titles("todo")).toEqual(["A", "Legacy", "B"]);
    expect((await sql(`select count(*)::int n from together_tasks where rank is null`))[0].n).toBe(0);
  });
});

describe("renumbering (rebalance)", () => {
  it("renumbers one list only when a gap runs out, preserving the order and writing rank only", async () => {
    const ids: string[] = [];
    for (const t of ["L", "R", "Z"]) ids.push(await add(t));   // Z R L
    const outside = await add("Outside", "doing");
    const outsideRank = (await sql(`select rank::text r from together_tasks where id = $1`, [outside]))[0].r;
    // Keep dropping new tasks directly after Z: each halves the gap after Z.
    const dropped: string[] = [];
    for (let i = 0; i < 14; i++) {
      const id = await add(`n${i}`);
      await mv(id, { stage: "todo", after: await idOf("Z") });
      dropped.push(`n${i}`);
    }
    const order = await titles("todo");
    expect(order).toEqual(["Z", ...[...dropped].reverse(), "R", "L"]);
    const ranks = (await visibleRanks("todo")).map(BigInt);
    expect(new Set(ranks.map(String)).size).toBe(ranks.length);
    // It renumbered (gaps of 1024 again somewhere), and another list was never touched.
    expect(ranks.some((r, i) => i > 0 && r - ranks[i - 1] === 1024n)).toBe(true);
    expect((await sql(`select rank::text r from together_tasks where id = $1`, [outside]))[0].r).toBe(outsideRank);
  });

  it("a renumber changes no column but rank, on any task but the one being moved", async () => {
    for (const t of ["A", "B"]) await add(t);
    await sql(`update together_tasks set rank = 1 where board_id = $1 and title = 'A'`, [sid]);
    await sql(`update together_tasks set rank = 0 where board_id = $1 and title = 'B'`, [sid]);   // B, A — no room between
    const n = await add("N");
    const pre = await allButRank();
    await mv(n, { stage: "todo", before: await idOf("A") });
    const post = JSON.parse(await allButRank()) as any[];
    const preRows = JSON.parse(pre) as any[];
    for (const row of post) {
      const was = preRows.find((r) => r.id === row.id);
      if (row.id === n) continue;                 // the moved task records who moved it, and when
      expect(row, row.title).toEqual(was);
    }
    expect(await titles("todo")).toEqual(["B", "N", "A"]);
  });
});

describe("a move that changes nothing", () => {
  it("writes nothing — no rank, no 'edited' stamp — when the task would stay where it is", async () => {
    for (const t of ["A", "B", "C"]) await add(t);   // C B A
    const snap = JSON.stringify(await sql(`select id, rank, updated_at, updated_by from together_tasks order by id`));
    for (const intent of [
      { place: "top" }, { place: "up" }, { stage: "todo", before: await idOf("B") }, { stage: "todo", before: await idOf("C") },
    ]) expect((await mv(await idOf("C"), intent)).body.unchanged, JSON.stringify(intent)).toBe(true);
    for (const intent of [{ place: "bottom" }, { place: "down" }, { stage: "todo", after: await idOf("B") }]) {
      expect((await mv(await idOf("A"), intent)).body.unchanged, JSON.stringify(intent)).toBe(true);
    }
    expect(JSON.stringify(await sql(`select id, rank, updated_at, updated_by from together_tasks order by id`))).toBe(snap);
    expect(tracked.filter((e) => /moved|reordered|reopened/.test(e.event))).toEqual([]);
  });
});

describe("deleted tasks and the order", () => {
  it("1 — a deleted task is never a neighbour: placement uses only what members see", async () => {
    for (const t of ["A", "B", "C"]) await add(t);   // C B A
    await del(await idOf("B"));
    const x = await add("X");
    await mv(x, { stage: "todo", after: await idOf("C") });
    expect(await titles("todo")).toEqual(["C", "X", "A"]);
    await mv(x, { stage: "todo", before: await idOf("B") });   // a deleted neighbour: ignored → top
    expect(await titles("todo")).toEqual(["X", "C", "A"]);
  });

  it("2 — a renumber with deleted tasks present keeps the visible order, and the deleted task its place", async () => {
    for (const t of ["A", "B", "C", "D"]) await add(t);   // D C B A
    await del(await idOf("C"));
    // Force a renumber: squeeze B and A together, then drop between them.
    await sql(`update together_tasks set rank = 5000 where title = 'B'`);
    await sql(`update together_tasks set rank = 5001 where title = 'A'`);
    const x = await add("X");
    await mv(x, { stage: "todo", before: await idOf("A") });
    expect(await titles("todo")).toEqual(["D", "B", "X", "A"]);
    // C (deleted) still sits between D and B in rank order.
    const all = (await sql(`select title from together_tasks where board_id = $1 and stage = 'todo' order by rank`, [sid])).map((r) => r.title);
    expect(all.indexOf("C")).toBe(all.indexOf("D") + 1);
    expect(all.indexOf("B")).toBe(all.indexOf("C") + 1);
  });

  it("3 — restoring puts a task back exactly where it was", async () => {
    for (const t of ["A", "B", "C"]) await add(t);   // C B A
    await del(await idOf("B"));
    expect(await titles("todo")).toEqual(["C", "A"]);
    expect((await undel(await idOf("B"))).status).toBe(200);
    expect(await titles("todo")).toEqual(["C", "B", "A"]);
  });

  it("4 — a restore never leaves two visible tasks on one rank: if its rank was taken, it goes directly above the holder", async () => {
    for (const t of ["A", "B", "C"]) await add(t);
    await sql(`update together_tasks set rank = 0 where title = 'C'`);
    await sql(`update together_tasks set rank = 1024 where title = 'B'`);
    await sql(`update together_tasks set rank = 2048 where title = 'A'`);
    await del(await idOf("B"));
    // X dropped between C and A takes the midpoint — B's old rank, 1024.
    const x = await add("X");
    await mv(x, { stage: "todo", after: await idOf("C") });
    expect((await sql(`select rank::text r from together_tasks where id = $1`, [x]))[0].r).toBe("1024");
    await undel(await idOf("B"));
    expect(await titles("todo")).toEqual(["C", "B", "X", "A"]);
    const ranks = await visibleRanks("todo");
    expect(new Set(ranks).size).toBe(ranks.length);
    // Restoring again changes nothing.
    await undel(await idOf("B"));
    expect(await titles("todo")).toEqual(["C", "B", "X", "A"]);
  });

  it("4b — a restored task without a rank (deleted before ordering existed) goes to the top, unambiguously", async () => {
    await add("A");
    await sql(`insert into together_tasks (board_id, title, stage, deleted_at) values ($1, 'Old', 'todo', now())`, [sid]);
    await undel(await idOf("Old"));
    expect(await titles("todo")).toEqual(["Old", "A"]);
    const ranks = await visibleRanks("todo");
    expect(ranks.every((r) => r !== null)).toBe(true);
    expect(new Set(ranks).size).toBe(2);
  });
});

describe("Done for exactly 24 hours, then History", () => {
  const view = async () => { as(who); return (await json(await work.GET(req(undefined, "GET"), P(sid)))).body; };
  const agedTo = (title: string, interval: string) => sql(`update together_tasks set moved_at = now() - interval '${interval}' where title = $1`, [title]);

  it("keeps a task on the Board for 24 hours to the second — not until midnight", async () => {
    for (const t of ["Fresh", "Edge", "Aged"]) await add(t, "done");
    await agedTo("Fresh", "23 hours 59 minutes");
    await agedTo("Aged", "24 hours 1 minute");
    await agedTo("Edge", "24 hours");
    const w = await view();
    expect((w.tasks as any[]).filter((t) => t.stage === "done").map((t) => t.title)).toEqual(["Fresh"]);
    expect((w.history.tasks as any[]).map((t) => t.title)).toEqual(["Edge", "Aged"]);
    expect(w.history.total).toBe(2);
    expect(typeof w.serverNow).toBe("string");
  });

  it("starts a new 24 hours each time a task enters Done again; reordering within Done does not", async () => {
    const t = await add("T");
    await mv(t, { stage: "done" });
    await agedTo("T", "10 hours");
    await mv(t, { stage: "doing" });
    await mv(t, { stage: "done" });
    const fresh = (await sql(`select now() - moved_at < interval '1 minute' ok from together_tasks where id = $1`, [t]))[0].ok;
    expect(fresh).toBe(true);
    const u = await add("U", "done");
    await agedTo("T", "20 hours");
    const before = (await sql(`select moved_at from together_tasks where id = $1`, [t]))[0].moved_at;
    await mv(t, { stage: "done", before: u });
    expect((await sql(`select moved_at from together_tasks where id = $1`, [t]))[0].moved_at).toEqual(before);
  });

  it("restoring a deleted Done task keeps its completion time — past 24 hours it returns to History", async () => {
    const t = await add("T", "done");
    await del(t);
    await agedTo("T", "3 days");
    await undel(t);
    const w = await view();
    expect((w.tasks as any[]).some((x) => x.id === t)).toBe(false);
    expect((w.history.tasks as any[]).map((x) => x.id)).toEqual([t]);
  });

  it("reopens History work to the top of an active stage, with everything else intact, and a fresh timer", async () => {
    const t = await add("T", "done");
    as(who);
    await json(await task.PATCH(req({ description: "notes", effort: 3, dueOn: "2026-10-09", assignees: [who], textVersion: 1 }, "PATCH"), T(sid, t)));
    await agedTo("T", "2 days");
    await add("Existing");
    const r = await mv(t, { stage: "doing", via: "menu" });
    expect(r.status).toBe(200);
    const w = await view();
    expect((w.history.tasks as any[]).length).toBe(0);
    expect((w.tasks as any[]).filter((x) => x.stage === "doing").map((x) => x.title)).toEqual(["T"]);
    const [row] = await sql(`select description, effort, due_on::text due, text_version, created_by, now() - moved_at < interval '1 minute' fresh,
      (select count(*)::int from together_task_assignees a where a.task_id = t.id) people from together_tasks t where id = $1`, [t]);
    expect(row).toEqual({ description: "notes", effort: 3, due: "2026-10-09", text_version: 2, created_by: who, fresh: true, people: 1 });
    expect(tracked.at(-1)).toMatchObject({ event: "together_task_reopened", properties: { to: "doing", via: "menu" } });
  });

  it("History is not a list: a History task cannot be reordered in Done or dropped back into it, and 'history' is not a stage", async () => {
    const t = await add("T", "done");
    const u = await add("U", "done");
    await agedTo("T", "2 days");
    expect((await mv(t, { stage: "done", before: u })).status).toBe(400);
    expect((await mv(t, { place: "up" })).status).toBe(400);
    expect((await mv(u, { stage: "history" })).status).toBe(400);
    as(who);
    expect((await json(await tasks.POST(req({ title: "x", stage: "history" }), P(sid)))).status).toBe(400);
  });
});

describe("authorization and words", () => {
  it("answers a non-member as a missing space, refuses an archived space, and never touches the words", async () => {
    const t = await add("T");
    const stranger = await account("Stranger");
    allow(who, stranger);
    as(stranger);
    expect((await move.POST(req({ place: "top" }), T(sid, t))).status).toBe(404);
    expect((await history.GET(req(undefined, "GET"), P(sid))).status).toBe(404);
    as(who);
    await json(await task.PATCH(req({ title: "T2", textVersion: 1 }, "PATCH"), T(sid, t)));
    await mv(t, { stage: "doing" });
    await mv(t, { stage: "doing", place: "bottom" });
    expect((await sql(`select title, text_version from together_tasks where id = $1`, [t]))[0]).toEqual({ title: "T2", text_version: 2 });
    const other = await space(stranger);
    as(stranger);
    const foreign = (await json(await tasks.POST(req({ title: "F" }), P(other)))).body.task.id;
    as(who);
    expect((await move.POST(req({ place: "top" }), T(sid, foreign))).status).toBe(404);   // not this space's task
    await boardRoute.PATCH(req({ archived: true }, "PATCH"), P(sid));
    expect((await mv(t, { stage: "todo" })).status).toBe(409);
    expect((await mv(t, { place: "top" })).status).toBe(409);
  });
});

describe("privacy", () => {
  it("records only stage keys and how — never a title, a task, a neighbour or who", async () => {
    const a = await add("Secret alpha");
    const b = await add("Secret beta");
    await mv(a, { stage: "todo", before: b, via: "drag" });
    await mv(a, { stage: "done", via: "drag" });
    await sql(`update together_tasks set moved_at = now() - interval '2 days' where id = $1`, [a]);
    await mv(a, { stage: "todo", via: "menu" });
    const events = tracked.filter((e) => /moved|reordered|reopened/.test(e.event));
    expect(events.map((e) => e.event)).toEqual(["together_task_reordered", "together_task_moved", "together_task_reopened"]);
    // The actor (userId) is recorded as for every event; nothing about the task or anyone else is.
    const text = JSON.stringify(tracked.map(({ userId: _actor, ...rest }: any) => rest));
    for (const leak of ["Secret", a, b, who]) expect(text).not.toContain(leak);
    for (const e of events) {
      expect(e.entityId).toBeUndefined();
      for (const [k, v] of Object.entries(e.properties ?? {})) {
        expect(["stage", "from", "to", "via"]).toContain(k);
        expect(["backlog", "todo", "doing", "waiting", "done", "drag", "menu"]).toContain(v);
      }
    }
  });
});
