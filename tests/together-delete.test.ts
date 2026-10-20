import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deleting a space (and leaving one), through the real routes and data layer
 * against Postgres (PGlite) with the real schema — the same harness as
 * together-db.test.ts. Stubbed: who is signed in, the cookie store, the
 * analytics sink and the mail sender.
 *
 * What must hold: only the owner can delete, even by calling the API directly;
 * the typed name is required; everything inside that one space goes — members,
 * invitations, groups, tasks, assignments — and nothing outside it: no other
 * space, no account, no personal habit or completion, no collaborator link;
 * the audit event carries counts, never a name; a repeated request deletes
 * nothing more.
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
const tracked: { event: string; entityType?: string; entityId?: string | null; properties?: Record<string, unknown>; userId?: string }[] = [];
vi.mock("@/lib/analytics/track", () => ({ trackEvent: async (e: any) => { tracked.push(e); } }));

process.env.APP_URL = "http://localhost:3000";
const invitations = await import("../src/lib/together/invitations");
const sent: { to: string; text: string }[] = [];
invitations.setInviteSenderForTests(async (m) => { sent.push(m as any); });

const boards = await import("../src/app/api/together/boards/route");
const board = await import("../src/app/api/together/boards/[id]/route");
const leave = await import("../src/app/api/together/boards/[id]/leave/route");
const invite = await import("../src/app/api/together/boards/[id]/invitations/route");
const accept = await import("../src/app/api/together/invitations/accept/route");

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
afterAll(async () => { for (const d of open) await d.close(); });
const sql = async (text: string, params: unknown[] = []) => (await db.query<any>(text, params as any[])).rows;

const allow = (...ids: string[]) => { process.env.TOGETHER_PREVIEW_USER_IDS = ids.join(","); };
async function account(name: string) {
  const email = `${name.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`;
  const [u] = await sql(`insert into users (email, username, password_hash) values ($1, $2, 'x') returning id`,
    [email, `${name.toLowerCase()}${randomUUID().slice(0, 4)}`]);
  await sql(`insert into profiles (id, first_name) values ($1, $2)`, [u.id, name]);
  await sql(`insert into user_preferences (user_id, locale) values ($1, 'en')`, [u.id]);
  return { id: u.id as string, email };
}
const req = (body?: unknown, method = "POST") =>
  new Request("http://x/api", { method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" } });
const raw = (text: string, method = "DELETE") =>
  new Request("http://x/api", { method, body: text, headers: { "content-type": "application/json" } });
const as = (id: string | null) => { signedIn = id; };
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) });
const tokenOf = (m: { text: string }) => m.text.match(/#t=([A-Za-z0-9_-]{43})/)![1];

async function newBoard(owner: string, name: string) {
  as(owner);
  const r = await json(await boards.POST(req({ name })));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.id as string;
}
async function join(boardId: string, owner: string, who: { id: string; email: string }) {
  as(owner);
  const r = await json(await invite.POST(req({ email: who.email }), { params: { id: boardId } }));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  as(who.id);
  const a = await json(await accept.POST(req({ token: tokenOf(sent.at(-1)!) })));
  expect(a.status, JSON.stringify(a.body)).toBe(200);
}
/** A space's work and loose ends: a group, two tasks (one assigned), one open invitation. */
async function fill(boardId: string, by: string, assignee: string) {
  const [g] = await sql(`insert into together_groups (board_id, name, created_by) values ($1, 'Errands', $2) returning id`, [boardId, by]);
  const [t1] = await sql(`insert into together_tasks (board_id, title, stage, group_id, created_by) values ($1, 'Plan the trip', 'todo', $2, $3) returning id`,
    [boardId, g.id, by]);
  await sql(`insert into together_tasks (board_id, title, stage, created_by) values ($1, 'Someday idea', 'backlog', $2)`, [boardId, by]);
  await sql(`insert into together_task_assignees (task_id, board_id, user_id) values ($1, $2, $3)`, [t1.id, boardId, assignee]);
  as(by);
  await invite.POST(req({ email: `pending-${randomUUID().slice(0, 6)}@example.com` }), { params: { id: boardId } });
}
const count = async (table: string, boardId: string) =>
  Number((await sql(`select count(*)::int as n from ${table} where board_id = $1`, [boardId]))[0].n);
const spaceRows = async (boardId: string) => ({
  board: Number((await sql(`select count(*)::int as n from together_boards where id = $1`, [boardId]))[0].n),
  members: await count("together_members", boardId),
  invitations: await count("together_invitations", boardId),
  groups: await count("together_groups", boardId),
  tasks: await count("together_tasks", boardId),
  assignees: await count("together_task_assignees", boardId),
});
const del = (id: string, confirmName?: unknown) =>
  board.DELETE(req(confirmName === undefined ? {} : { confirmName }, "DELETE"), { params: { id } });

beforeEach(async () => {
  db = await PGlite.create();
  open.push(db);
  await db.exec(SCHEMA);
  (globalThis as any).__tgDb = db;
  sent.length = 0;
  tracked.length = 0;
  signedIn = null;
});

describe("deleting a space", () => {
  it("lets the owner delete their space, and takes everything inside it", async () => {
    const owner = await account("Meiling"), eddie = await account("Eddie");
    allow(owner.id);
    const id = await newBoard(owner.id, "Family Plans");
    await join(id, owner.id, eddie);
    await fill(id, owner.id, eddie.id);
    expect(await spaceRows(id)).toMatchObject({ board: 1, members: 2, groups: 1, tasks: 2, assignees: 1 });

    as(owner.id);
    const r = await json(await del(id, "Family Plans"));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await spaceRows(id)).toEqual({ board: 0, members: 0, invitations: 0, groups: 0, tasks: 0, assignees: 0 });
  });

  it("deletes nothing outside that space: other spaces, accounts, personal habits and collaborator links stay", async () => {
    const owner = await account("Meiling"), eddie = await account("Eddie");
    allow(owner.id, eddie.id);
    const doomed = await newBoard(owner.id, "Family Plans");
    const kept = await newBoard(owner.id, "Work");
    const eddies = await newBoard(eddie.id, "Eddie's Garden");
    for (const b of [doomed, kept]) await join(b, owner.id, eddie);
    await join(eddies, eddie.id, owner);
    for (const b of [doomed, kept]) await fill(b, owner.id, eddie.id);
    await fill(eddies, eddie.id, owner.id);
    // Personal RichHabit data and a collaborator link between the two.
    for (const u of [owner.id, eddie.id]) {
      const [h] = await sql(`insert into habits (user_id, name, category) values ($1, 'Read', 'morning') returning id`, [u]);
      await sql(`insert into habit_completions (habit_id, user_id, done_on) values ($1, $2, current_date)`, [h.id, u]);
    }
    const [lo, hi] = [owner.id, eddie.id].sort();
    await sql(`insert into together_connections (user_low, user_high) values ($1, $2)`, [lo, hi]);
    const before = { kept: await spaceRows(kept), eddies: await spaceRows(eddies) };

    as(owner.id);
    expect((await del(doomed, "Family Plans")).status).toBe(200);

    expect(await spaceRows(kept)).toEqual(before.kept);
    expect(await spaceRows(eddies)).toEqual(before.eddies);
    expect(Number((await sql(`select count(*)::int as n from users`))[0].n)).toBe(2);
    expect(Number((await sql(`select count(*)::int as n from habits`))[0].n)).toBe(2);
    expect(Number((await sql(`select count(*)::int as n from habit_completions`))[0].n)).toBe(2);
    expect(Number((await sql(`select count(*)::int as n from together_connections`))[0].n)).toBe(1);
  });

  it("refuses a member, even calling the API directly with the right name", async () => {
    const owner = await account("Meiling"), eddie = await account("Eddie");
    allow(owner.id);
    const id = await newBoard(owner.id, "Family Plans");
    await join(id, owner.id, eddie);
    as(eddie.id);
    const r = await json(await del(id, "Family Plans"));
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("Only the space's owner can do that.");
    expect((await spaceRows(id)).board).toBe(1);
  });

  it("answers anyone else as if the space did not exist, and refuses the signed-out", async () => {
    const owner = await account("Meiling"), stranger = await account("Stranger");
    allow(owner.id, stranger.id);
    const id = await newBoard(owner.id, "Family Plans");
    as(stranger.id);
    expect((await del(id, "Family Plans")).status).toBe(404);
    expect((await board.DELETE(raw("{not json"), { params: { id } })).status).toBe(404);   // access before the body
    allow(owner.id);                                                                        // outside the preview
    expect((await del(id, "Family Plans")).status).toBe(404);
    as(null);
    expect((await del(id, "Family Plans")).status).toBe(401);
    expect((await spaceRows(id)).board).toBe(1);
  });

  it("requires the space's name, typed — a wrong, missing or malformed confirmation deletes nothing", async () => {
    const owner = await account("Meiling");
    allow(owner.id);
    const id = await newBoard(owner.id, "Family Plans");
    as(owner.id);
    for (const r of [
      await del(id, "family plans"),
      await del(id, "Family"),
      await del(id),
      await del(id, 42),
      await board.DELETE(raw("{not json"), { params: { id } }),
    ]) {
      const j = await json(r);
      expect(j.status).toBe(400);
      expect(j.body.error).toBe("Type the space's name exactly as it appears to delete it.");
    }
    expect((await spaceRows(id)).board).toBe(1);
    // Surrounding spaces are forgiven; the name itself must match.
    expect((await del(id, "  Family Plans ")).status).toBe(200);
  });

  it("records the deletion with counts only — no name, no task — and a repeated request deletes nothing more", async () => {
    const owner = await account("Meiling"), eddie = await account("Eddie");
    allow(owner.id);
    const id = await newBoard(owner.id, "Family Plans");
    await join(id, owner.id, eddie);
    await fill(id, owner.id, eddie.id);
    tracked.length = 0;
    as(owner.id);
    expect((await del(id, "Family Plans")).status).toBe(200);
    const e = tracked.find((x) => x.event === "together_board_deleted")!;
    expect(e).toMatchObject({ userId: owner.id, entityType: "together_board", entityId: id });
    expect(e.properties).toEqual({ members: 2, tasks: 2, groups: 1, invitations: 2 });
    expect(JSON.stringify(e)).not.toMatch(/Family|Plan the trip|Errands/);
    // A second click, another tab: the space is gone, so it is "not found", never a second deletion.
    expect((await del(id, "Family Plans")).status).toBe(404);
    expect(tracked.filter((x) => x.event === "together_board_deleted")).toHaveLength(1);
  });

  it("lets the owner delete an archived space too", async () => {
    const owner = await account("Meiling");
    allow(owner.id);
    const id = await newBoard(owner.id, "Old Project");
    as(owner.id);
    expect((await board.PATCH(req({ archived: true }, "PATCH"), { params: { id } })).status).toBe(200);
    expect((await del(id, "Old Project")).status).toBe(200);
    expect((await spaceRows(id)).board).toBe(0);
  });
});

describe("where the screen goes next", () => {
  it("says whether Together still exists for them — so nobody lands on a 'not found'", async () => {
    const owner = await account("Meiling"), eddie = await account("Eddie");
    allow(owner.id);                                   // eddie is outside the preview: Together exists for him through his spaces
    const a = await newBoard(owner.id, "Family Plans");
    const b = await newBoard(owner.id, "Book Club");
    await join(a, owner.id, eddie);
    await join(b, owner.id, eddie);
    as(eddie.id);
    expect((await json(await leave.POST(req({}), { params: { id: a } }))).body).toEqual({ ok: true, together: true });
    expect((await json(await leave.POST(req({}), { params: { id: b } }))).body).toEqual({ ok: true, together: false });
    as(owner.id);
    expect((await json(await del(a, "Family Plans"))).body).toEqual({ ok: true, together: true });
  });
});

describe("leaving a space", () => {
  it("lets a member leave — the space and everyone else stay — but not the owner", async () => {
    const owner = await account("Meiling"), eddie = await account("Eddie");
    allow(owner.id);
    const id = await newBoard(owner.id, "Family Plans");
    await join(id, owner.id, eddie);
    await fill(id, owner.id, eddie.id);
    as(eddie.id);
    expect((await leave.POST(req({}), { params: { id } })).status).toBe(200);
    const rows = await spaceRows(id);
    expect(rows).toMatchObject({ board: 1, members: 1, groups: 1, tasks: 2, assignees: 0 });
    as(owner.id);
    expect((await leave.POST(req({}), { params: { id } })).status).toBe(409);
  });
});
