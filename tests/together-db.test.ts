import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Together V1A through the real routes and data layer, against Postgres
 * (PGlite). Stubbed: who is signed in, the cookie store, the analytics sink and
 * the mail sender — so what each route records and sends can be inspected.
 *
 * The properties that matter: every route refuses anyone who is not on the
 * board (as "not found"), and anyone outside the preview; owner-only actions
 * are owner-only; archived boards are read-only; an invitation is usable only
 * after its email was accepted by the provider, exactly once, by the account
 * with that address; nothing reveals whether an address has an account; and no
 * account deletion can take a shared board with it.
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
const tracked: { event: string; properties?: Record<string, unknown>; userId?: string }[] = [];
vi.mock("@/lib/analytics/track", () => ({ trackEvent: async (e: any) => { tracked.push(e); } }));

process.env.APP_URL = "http://localhost:3000";
const invitations = await import("../src/lib/together/invitations");
const sent: { to: string; subject: string; text: string; html: string }[] = [];
let failNextSend: Error | null = null;
let duringSend: (() => Promise<void>) | null = null;
invitations.setInviteSenderForTests(async (m) => {
  if (duringSend) { const f = duringSend; duringSend = null; await f(); }
  if (failNextSend) { const e = failNextSend; failNextSend = null; throw e; }
  sent.push(m as any);
});

const home = await import("../src/app/api/together/home/route");
const boards = await import("../src/app/api/together/boards/route");
const board = await import("../src/app/api/together/boards/[id]/route");
const respond = await import("../src/app/api/together/invitations/respond/route");
const member = await import("../src/app/api/together/boards/[id]/members/[userId]/route");
const leave = await import("../src/app/api/together/boards/[id]/leave/route");
const invite = await import("../src/app/api/together/boards/[id]/invitations/route");
const inviteList = await import("../src/app/api/together/invitations/route");
const inviteOne = await import("../src/app/api/together/boards/[id]/invitations/[inviteId]/route");
const preview = await import("../src/app/api/together/invitations/preview/route");
const accept = await import("../src/app/api/together/invitations/accept/route");
const boardsLib = await import("../src/lib/together/boards");

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const use = async () => {
  db = await PGlite.create();
  open.push(db);
  await db.exec(SCHEMA);
  (globalThis as any).__tgDb = db;
};
afterAll(async () => { for (const d of open) await d.close(); });
const sql = async (text: string, params: unknown[] = []) => (await db.query<any>(text, params as any[])).rows;

const allow = (...ids: string[]) => { process.env.TOGETHER_PREVIEW_USER_IDS = ids.join(","); };
async function account(name: string, { email = `${name.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`,
  verified = false, joined }: { email?: string; verified?: boolean; joined?: string } = {}) {
  const [u] = await sql(`insert into users (email, username, password_hash, email_verified_at)
    values ($1, $2, 'x', $3) returning id`,
    [email, `${name.toLowerCase()}${randomUUID().slice(0, 4)}`, verified ? new Date().toISOString() : null]);
  await sql(`insert into profiles (id, first_name) values ($1, $2)`, [u.id, name]);
  await sql(`insert into user_preferences (user_id, locale) values ($1, 'en')`, [u.id]);
  void joined;
  return { id: u.id as string, email };
}

const req = (body?: unknown, method = "POST") =>
  new Request("http://x/api", { method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" } });
const as = (id: string | null) => { signedIn = id; };
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) });
const tokenOf = (m: { text: string }) => m.text.match(/#t=([A-Za-z0-9_-]{43})/)![1];

async function newBoard(owner: string, name = "Headband Business", people: string[] = []) {
  as(owner);
  const r = await json(await boards.POST(req({ name, people })));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.id as string;
}
async function inviteTo(boardId: string, from: string, email: string) {
  as(from);
  return json(await invite.POST(req({ email }), { params: { id: boardId } }));
}
async function join(boardId: string, owner: string, who: { id: string; email: string }) {
  const r = await inviteTo(boardId, owner, who.email);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  as(who.id);
  const a = await json(await accept.POST(req({ token: tokenOf(sent.at(-1)!) })));
  expect(a.status, JSON.stringify(a.body)).toBe(200);
}

/** The in-platform invitations waiting for `who`, as their Together home shows them. */
async function waitingFor(who: string): Promise<{ id: string; board: string; inviter: string }[]> {
  as(who);
  const r = await json(await home.GET());
  return r.status === 200 ? r.body.invitations : [];
}
async function answer(who: string, inviteId: string, accept: boolean) {
  as(who);
  return json(await respond.POST(req({ id: inviteId, accept })));
}
const memberIds = async (boardId: string) =>
  (await sql("select user_id from together_members where board_id = $1 order by joined_at", [boardId]))
    .map((r: any) => r.user_id as string);
const canSee = async (who: string, boardId: string) => {
  as(who);
  return (await board.GET(req(undefined, "GET"), { params: { id: boardId } })).status === 200;
};

beforeEach(async () => {
  await use();
  sent.length = 0;
  tracked.length = 0;
  signedIn = null;
  failNextSend = null;
  duringSend = null;
});

describe("the preview gate", () => {
  it("checks access before reading the request, so nothing reveals that Together exists", async () => {
    const outsider = await account("Out");
    const owner = await account("Meiling");
    allow(owner.id);
    const id = await newBoard(owner.id);
    as(outsider.id);
    for (const r of [
      await boards.POST(req({})),
      await boards.POST(req({ name: "x", emails: ["nope"] })),
      await boards.POST(req({ name: "x", people: Array.from({ length: 30 }, () => randomUUID()) })),
      await invite.POST(req({ email: "nope" }), { params: { id } }),
      await invite.POST(req({ people: Array.from({ length: 30 }, () => randomUUID()) }), { params: { id } }),
    ]) expect(r.status).toBe(404);
    allow();
    as(owner.id);
    expect((await boards.POST(req({}))).status).toBe(404);
    expect((await respond.POST(req({ id: randomUUID(), accept: "x" }))).status).toBe(404);
  });

  it("answers as if Together did not exist for anyone outside the allow-list", async () => {
    const outsider = await account("Out");
    allow();
    as(outsider.id);
    expect((await home.GET()).status).toBe(404);
    expect((await boards.POST(req({ name: "x" }))).status).toBe(404);
  });

  it("refuses a signed-out caller", async () => {
    allow();
    expect((await home.GET()).status).toBe(401);
  });

  it("ignores anything in the allow-list that is not a UUID", async () => {
    const a = await account("Ann");
    process.env.TOGETHER_PREVIEW_USER_IDS = `nonsense, ${a.id.toUpperCase()} ,*`;
    as(a.id);
    expect((await home.GET()).status).toBe(200);
  });
});

describe("authorization", () => {
  it("lets only members see a board, and answers everyone else exactly as for a missing board", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    const stranger = await account("Stranger");
    allow(owner.id, eddie.id, stranger.id);
    const id = await newBoard(owner.id);
    await join(id, owner.id, eddie);

    as(stranger.id);
    const theirs = await json(await board.GET(req(undefined, "GET"), { params: { id } }));
    const missing = await json(await board.GET(req(undefined, "GET"), { params: { id: randomUUID() } }));
    const garbage = await json(await board.GET(req(undefined, "GET"), { params: { id: "not-a-uuid" } }));
    expect(theirs).toEqual(missing);
    expect(garbage).toEqual(missing);
    expect(theirs.status).toBe(404);

    // Every board route, as a stranger: 404, and nothing changed.
    const params = { params: { id } };
    expect((await board.PATCH(req({ name: "Mine" }), params)).status).toBe(404);
    expect((await invite.POST(req({ people: [stranger.id] }), params)).status).toBe(404);
    expect((await member.DELETE(req(), { params: { id, userId: eddie.id } })).status).toBe(404);
    expect((await leave.POST(req(), params)).status).toBe(404);
    expect((await invite.POST(req({ email: "x@example.com" }), params)).status).toBe(404);
    expect((await sql("select count(*)::int n from together_members where board_id = $1", [id]))[0].n).toBe(2);
    expect((await sql("select name from together_boards where id = $1", [id]))[0].name).toBe("Headband Business");
  });

  it("keeps the owner's administration to the owner", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    const xx = await account("Xiaoxuan");
    allow(owner.id, eddie.id, xx.id);
    const id = await newBoard(owner.id);
    await join(id, owner.id, eddie);
    await join(id, owner.id, xx);
    as(eddie.id);
    expect((await board.PATCH(req({ name: "Eddie's" }), { params: { id } })).status).toBe(403);
    expect((await board.PATCH(req({ archived: true }), { params: { id } })).status).toBe(403);
    expect((await member.DELETE(req(), { params: { id, userId: xx.id } })).status).toBe(403);
    // Inviting is the owner's too: a member — here on the preview list — is
    // refused on every channel, and nothing is written.
    expect((await invite.POST(req({ people: [xx.id] }), { params: { id } })).status).toBe(403);
    expect((await inviteTo(id, eddie.id, "friend@example.com")).status).toBe(403);
    expect(await sql("select id from together_invitations where invited_by = $1", [eddie.id])).toEqual([]);
    expect((await inviteTo(id, owner.id, "friend@example.com")).status).toBe(200);
  });

  it("makes an archived board read-only for everyone, and restorable by its owner", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    allow(owner.id, eddie.id);
    const id = await newBoard(owner.id);
    await join(id, owner.id, eddie);
    as(owner.id);
    expect((await board.PATCH(req({ archived: true }), { params: { id } })).status).toBe(200);
    expect((await board.PATCH(req({ name: "New" }), { params: { id } })).status).toBe(409);
    expect((await inviteTo(id, owner.id, "late@example.com")).status).toBe(409);
    as(eddie.id);
    expect((await json(await board.GET(req(undefined, "GET"), { params: { id } }))).body.archived).toBe(true);
    as(owner.id);
    expect((await board.PATCH(req({ archived: false }), { params: { id } })).status).toBe(200);
    expect((await board.PATCH(req({ name: "Restored" }), { params: { id } })).status).toBe(200);
  });

  it("takes who did what from the session, never from the request", async () => {
    const owner = await account("Meiling");
    const other = await account("Other");
    allow(owner.id, other.id);
    as(owner.id);
    const r = await json(await boards.POST(req({ name: "B", created_by: other.id, owner: other.id, userId: other.id })));
    const [row] = await sql("select created_by from together_boards where id = $1", [r.body.id]);
    expect(row.created_by).toBe(owner.id);
    expect((await sql("select user_id, role from together_members where board_id = $1", [r.body.id])))
      .toEqual([{ user_id: owner.id, role: "owner" }]);
  });
});

describe("boards and People", () => {
  it("derives People from shared boards; ticking someone invites them, and only Accept makes them a member", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    const stranger = await account("Stranger");
    allow(owner.id, eddie.id, stranger.id);
    const first = await newBoard(owner.id, "Headband Business");
    as(owner.id);
    expect((await json(await home.GET())).body.people).toEqual([]);
    await join(first, owner.id, eddie);
    as(owner.id);
    expect((await json(await home.GET())).body.people).toEqual([{ id: eddie.id, name: "Eddie" }]);

    // A new board with Eddie ticked: an invitation inside Together, no email, no membership.
    const emailsBefore = sent.length;
    const second = await newBoard(owner.id, "Home Projects", [eddie.id]);
    expect(sent.length).toBe(emailsBefore);
    expect(await memberIds(second)).toEqual([owner.id]);
    expect(await canSee(eddie.id, second)).toBe(false);
    const waiting = await waitingFor(eddie.id);
    expect(waiting).toMatchObject([{ board: "Home Projects", inviter: "Meiling" }]);

    // Accept: now he is on it, and the invitation is spent.
    expect((await answer(eddie.id, waiting[0].id, true)).body).toEqual({ boardId: second });
    expect(await memberIds(second)).toEqual([owner.id, eddie.id]);
    expect(await canSee(eddie.id, second)).toBe(true);
    expect(await waitingFor(eddie.id)).toEqual([]);
    expect((await answer(eddie.id, waiting[0].id, true)).status).toBe(404);

    // Somebody you share nothing with cannot be invited that way, at creation or later.
    as(owner.id);
    expect((await boards.POST(req({ name: "Sneaky", people: [stranger.id] }))).status).toBe(400);
    expect((await invite.POST(req({ people: [stranger.id] }), { params: { id: second } })).status).toBe(400);
    expect(await waitingFor(stranger.id)).toEqual([]);
  });

  it("lets the invitee decline, which leaves them off the board and can be followed by a new invitation", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    allow(owner.id, eddie.id);
    await join(await newBoard(owner.id), owner.id, eddie);
    const second = await newBoard(owner.id, "Home Projects", [eddie.id]);
    const [w] = await waitingFor(eddie.id);
    expect((await answer(eddie.id, w.id, false)).status).toBe(200);
    expect(await memberIds(second)).toEqual([owner.id]);
    expect(await canSee(eddie.id, second)).toBe(false);
    expect(await waitingFor(eddie.id)).toEqual([]);
    expect((await answer(eddie.id, w.id, true)).status).toBe(404);   // a declined invitation stays declined
    // The same inviter waits a week before asking again…
    as(owner.id);
    expect((await json(await invite.POST(req({ people: [eddie.id] }), { params: { id: second } }))).body).toEqual({ invited: 0 });
    expect(await waitingFor(eddie.id)).toEqual([]);
    await sql(`update together_invitations set declined_at = now() - interval '8 days' where declined_at is not null`);
    as(owner.id);
    expect((await json(await invite.POST(req({ people: [eddie.id] }), { params: { id: second } }))).body).toEqual({ invited: 1 });
    expect(await waitingFor(eddie.id)).toHaveLength(1);
    expect(await memberIds(second)).toEqual([owner.id]);
  });

  it("does not invite twice: members and people already invited are skipped", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    const xx = await account("Xiaoxuan");
    allow(owner.id, eddie.id, xx.id);
    const first = await newBoard(owner.id);
    await join(first, owner.id, eddie);
    await join(first, owner.id, xx);
    const second = await newBoard(owner.id, "Second", [eddie.id]);
    as(owner.id);
    expect((await json(await invite.POST(req({ people: [eddie.id, xx.id] }), { params: { id: second } }))).body)
      .toEqual({ invited: 1 });
    expect((await json(await invite.POST(req({ people: [eddie.id, xx.id] }), { params: { id: second } }))).body)
      .toEqual({ invited: 0 });
    expect((await sql(`select count(*)::int n from together_invitations where board_id = $1 and invitee_id is not null`, [second]))[0].n).toBe(2);
  });

  it("voids an invitation whose sender no longer holds the right to invite — by link, in-app and in the bell", async () => {
    const owner = await account("Meiling");
    const z = await account("Zed");
    const x = await account("Xin", { email: "xin@example.com" });
    const w = await account("Wen");
    allow(owner.id, z.id, x.id, w.id);
    const id = await newBoard(owner.id);
    await join(id, owner.id, z);
    // Invitations a member sent while members could still invite (none exist
    // in production; planted here as they would have been written).
    const legacyToken = "L".repeat(43);
    await sql(`insert into together_invitations (board_id, email_normalized, token_hash, invited_by, sent_at, expires_at)
      values ($1, 'xin@example.com', $2, $3, now(), now() + interval '14 days')`,
      [id, createHash("sha256").update(legacyToken).digest("hex"), z.id]);
    await sql(`insert into together_invitations (board_id, invitee_id, invited_by, sent_at, expires_at)
      values ($1, $2, $3, now(), now() + interval '14 days')`, [id, w.id, z.id]);
    // Neither can be previewed, answered, accepted or waited on.
    expect((await json(await preview.POST(req({ token: legacyToken })))).body.status).toBe("invalid");
    as(x.id);
    expect((await accept.POST(req({ token: legacyToken }))).status).toBe(404);
    expect(await waitingFor(w.id)).toEqual([]);
    const [{ id: stale }] = await sql(`select id from together_invitations where invitee_id = $1`, [w.id]);
    expect((await answer(w.id, stale, true)).status).toBe(404);
    expect(await sql(`select user_id from together_members where board_id = $1 and user_id = any($2::uuid[])`,
      [id, [x.id, w.id]])).toEqual([]);
    // …nor do they stand in the owner's way: a fresh invitation goes out and works.
    expect((await inviteTo(id, owner.id, "xin@example.com")).status).toBe(200);
    as(x.id);
    expect((await accept.POST(req({ token: tokenOf(sent.at(-1)!) }))).status).toBe(200);
  });

  it("keeps one live invitation per person per space: a repeat is refused quietly, and a member cannot withdraw the owner's", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    const xx = await account("Xiaoxuan", { email: "xx@example.com" });
    allow(owner.id, eddie.id, xx.id);
    const a = await newBoard(owner.id, "A");
    await join(a, owner.id, eddie);
    await join(a, owner.id, xx);
    const b = await newBoard(owner.id, "B");
    await join(b, owner.id, eddie);
    as(owner.id);
    expect((await json(await invite.POST(req({ people: [xx.id] }), { params: { id: b } }))).body).toEqual({ invited: 1 });
    // Again in-app, and by her username: nothing new.
    expect((await json(await invite.POST(req({ people: [xx.id] }), { params: { id: b } }))).body).toEqual({ invited: 0 });
    // By her address: the ordinary answer, but no email and no second invitation.
    const mails = sent.length;
    expect((await inviteTo(b, owner.id, "xx@example.com")).status).toBe(200);
    expect(sent.length).toBe(mails);
    expect((await sql(`select count(*)::int n from together_invitations where board_id = $1 and revoked_at is null
      and (invitee_id = $2 or email_normalized = 'xx@example.com')`, [b, xx.id]))[0].n).toBe(1);
    // The owner's list keeps her, marked pending, rather than offering a duplicate.
    const listed = (await json(await board.GET(req(undefined, "GET"), { params: { id: b } }))).body.invitable
      .find((p: any) => p.id === xx.id);
    expect(listed).toMatchObject({ pending: true, collaborator: false });
    // Eddie, a member, cannot withdraw it.
    const [{ id: theirs }] = await sql(`select id from together_invitations where board_id = $1 and invitee_id = $2`, [b, xx.id]);
    as(eddie.id);
    expect((await inviteOne.DELETE(req(), { params: { id: b, inviteId: theirs } })).status).toBe(404);
    // One in her bell; declining clears it.
    const waiting = await waitingFor(xx.id);
    expect(waiting).toHaveLength(1);
    expect((await answer(xx.id, waiting[0].id, false)).status).toBe(200);
    expect(await waitingFor(xx.id)).toEqual([]);
  });

  it("refuses an answer that is not a plain yes or no, and leaves the invitation open", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    allow(owner.id, eddie.id);
    await join(await newBoard(owner.id), owner.id, eddie);
    await newBoard(owner.id, "B", [eddie.id]);
    const [w] = await waitingFor(eddie.id);
    as(eddie.id);
    for (const acceptValue of ["true", 1, null, undefined]) {
      expect((await respond.POST(req({ id: w.id, accept: acceptValue }))).status).toBe(400);
    }
    expect(await waitingFor(eddie.id)).toHaveLength(1);
  });

  it("gives no access for an invitation that cannot be answered (archived board)", async () => {
    const owner = await account("Meiling");
    const newbie = await account("Newbie", { email: "newbie@example.com" });
    allow(owner.id);
    const a = await newBoard(owner.id, "A");
    await join(a, owner.id, newbie);
    const b = await newBoard(owner.id, "B", [newbie.id]);
    as(owner.id);
    await member.DELETE(req(), { params: { id: a, userId: newbie.id } });
    await board.PATCH(req({ archived: true }), { params: { id: b } });
    as(newbie.id);
    expect((await home.GET()).status).toBe(404);
  });

  it("lets nobody answer an invitation addressed to someone else", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    const xx = await account("Xiaoxuan");
    allow(owner.id, eddie.id, xx.id);
    const first = await newBoard(owner.id);
    await join(first, owner.id, eddie);
    await join(first, owner.id, xx);
    const second = await newBoard(owner.id, "Second", [eddie.id]);
    const [w] = await waitingFor(eddie.id);
    for (const who of [xx.id, owner.id]) {
      expect((await answer(who, w.id, true)).status).toBe(404);
      expect((await answer(who, w.id, false)).status).toBe(404);
    }
    as(null);
    expect((await respond.POST(req({ id: w.id, accept: true }))).status).toBe(401);
    expect(await memberIds(second)).toEqual([owner.id]);
    expect(await waitingFor(eddie.id)).toHaveLength(1);   // still his to answer
    for (const id of ["-".repeat(36), "x", null, randomUUID()]) expect((await answer(eddie.id, id as any, true)).status).toBe(404);
  });

  it("shows a pending in-platform invitee by name, never by address", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie", { email: "eddie-private@example.com" });
    allow(owner.id, eddie.id);
    await join(await newBoard(owner.id), owner.id, eddie);
    const second = await newBoard(owner.id, "Second", [eddie.id]);
    as(owner.id);
    const view = (await json(await board.GET(req(undefined, "GET"), { params: { id: second } }))).body;
    expect(view.invitations).toMatchObject([{ kind: "person", label: "Eddie", invitedBy: "Meiling" }]);
    expect(JSON.stringify(view)).not.toContain("eddie-private");
    // Still in the owner's directory, marked pending — never offered twice.
    expect(view.invitable).toMatchObject([{ id: eddie.id, name: "Eddie", pending: true }]);
  });

  it("ends access the moment someone is removed; only a new invitation, accepted, restores it", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    const xx = await account("Xiaoxuan");
    allow(owner.id, eddie.id, xx.id);
    const id = await newBoard(owner.id);
    await join(id, owner.id, eddie);
    await join(id, owner.id, xx);
    // An invitation for Eddie that predates his removal.
    await sql(`insert into together_invitations (board_id, email_normalized, token_hash, invited_by, sent_at, expires_at)
      values ($1, lower($2), $3, $4, now(), now() + interval '14 days')`,
      [id, eddie.email, createHash("sha256").update("O".repeat(43)).digest("hex"), owner.id]);
    const older = "O".repeat(43);
    as(owner.id);
    expect((await member.DELETE(req(), { params: { id, userId: eddie.id } })).status).toBe(200);
    expect(await canSee(eddie.id, id)).toBe(false);
    as(eddie.id);
    expect((await accept.POST(req({ token: older }))).status).toBe(404);
    expect(await canSee(eddie.id, id)).toBe(false);

    // A member cannot bring him back; the owner can invite him again. Pending is not access.
    expect((await inviteTo(id, xx.id, eddie.email)).status).toBe(403);
    expect((await inviteTo(id, owner.id, eddie.email)).status).toBe(200);
    const fresh = tokenOf(sent.at(-1)!);
    expect(await canSee(eddie.id, id)).toBe(false);
    as(eddie.id);
    expect((await accept.POST(req({ token: fresh }))).status).toBe(200);
    expect(await canSee(eddie.id, id)).toBe(true);
  });

  it("brings a removed person back through People only after they accept", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    allow(owner.id, eddie.id);
    const a = await newBoard(owner.id, "A");
    await join(a, owner.id, eddie);
    const b = await newBoard(owner.id, "B", [eddie.id]);
    await answer(eddie.id, (await waitingFor(eddie.id))[0].id, true);
    as(owner.id);
    await member.DELETE(req(), { params: { id: b, userId: eddie.id } });
    expect(await canSee(eddie.id, b)).toBe(false);
    as(owner.id);
    expect((await json(await invite.POST(req({ people: [eddie.id] }), { params: { id: b } }))).body).toEqual({ invited: 1 });
    expect(await canSee(eddie.id, b)).toBe(false);
    await answer(eddie.id, (await waitingFor(eddie.id))[0].id, true);
    expect(await canSee(eddie.id, b)).toBe(true);
  });

  it("withdraws a leaver's older invitations too", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    allow(owner.id, eddie.id);
    const a = await newBoard(owner.id, "A");
    await join(a, owner.id, eddie);
    const b = await newBoard(owner.id, "B", [eddie.id]);
    await answer(eddie.id, (await waitingFor(eddie.id))[0].id, true);
    await inviteTo(b, owner.id, eddie.email);   // an email invitation for someone already on the board
    const stale = tokenOf(sent.at(-1)!);
    as(eddie.id);
    expect((await leave.POST(req(), { params: { id: b } })).status).toBe(200);
    expect((await accept.POST(req({ token: stale }))).status).toBe(404);
    expect(await canSee(eddie.id, b)).toBe(false);
  });

  it("emails typed addresses once the board exists, and reports any that could not be sent", async () => {
    const owner = await account("Meiling");
    allow(owner.id);
    as(owner.id);
    expect((await boards.POST(req({ name: "Bad", emails: ["not-an-address"] }))).status).toBe(400);
    expect(await sql("select id from together_boards")).toEqual([]);   // nothing created for a typo

    let calls = 0;
    duringSend = async () => { calls++; };
    failNextSend = null;
    const r = await json(await boards.POST(req({ name: "Launch", emails: ["A@Example.com", "a@example.com", "b@example.com"] })));
    expect(r.status).toBe(200);
    expect(r.body.failedEmails).toEqual([]);
    expect(sent.map((m) => m.to)).toEqual(["a@example.com", "b@example.com"]);
    void calls;

    // One send fails: the board exists, the other invitation is usable, the failure is named.
    sent.length = 0;
    let n = 0;
    invitations.setInviteSenderForTests(async (m) => {
      if (n++ === 0) throw new Error("provider down");
      sent.push(m as any);
    });
    try {
      const p = await json(await boards.POST(req({ name: "Partly", emails: ["x@example.com", "y@example.com"] })));
      expect(p.status).toBe(200);
      expect(p.body.failedEmails).toEqual(["x@example.com"]);
      expect(sent.map((m) => m.to)).toEqual(["y@example.com"]);
      const usable = await sql(`select email_normalized e from together_invitations
        where board_id = $1 and sent_at is not null and revoked_at is null`, [p.body.id]);
      expect(usable).toEqual([{ e: "y@example.com" }]);
    } finally {
      invitations.setInviteSenderForTests(async (m) => {
        if (duringSend) { const fn = duringSend; duringSend = null; await fn(); }
        if (failNextSend) { const e = failNextSend; failNextSend = null; throw e; }
        sent.push(m as any);
      });
    }
  });

  it("says plainly when too many people are added at once, and counts only real ones", async () => {
    const owner = await account("Meiling");
    allow(owner.id);
    as(owner.id);
    const many = Array.from({ length: 21 }, () => randomUUID());
    const r = await json(await boards.POST(req({ name: "Big", people: many })));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/at once/);
    await boards.POST(req({ name: "Small", people: ["junk", 42, null] }));
    expect(tracked.at(-1)).toMatchObject({ event: "together_board_created", properties: { people: 0 } });
  });

  it("shows other members a name and never an email address", async () => {
    const owner = await account("Meiling", { email: "meiling-private@example.com" });
    const eddie = await account("Eddie", { email: "eddie-private@example.com" });
    allow(owner.id, eddie.id);
    const id = await newBoard(owner.id);
    await join(id, owner.id, eddie);
    as(eddie.id);
    const text = JSON.stringify([await json(await home.GET()), await json(await board.GET(req(undefined, "GET"), { params: { id } }))]);
    expect(text).not.toMatch(/meiling-private|eddie-private/);
    expect(text).toContain("Meiling");
  });

  it("shows a pending address only to the owner who sent it — members see a count, never the address", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    const xx = await account("Xiaoxuan");
    allow(owner.id, eddie.id, xx.id);
    const id = await newBoard(owner.id);
    await join(id, owner.id, eddie);
    await join(id, owner.id, xx);
    await inviteTo(id, owner.id, "owners-friend@example.com");
    const view = async (who: string) => { as(who); return (await json(await board.GET(req(undefined, "GET"), { params: { id } }))).body; };
    expect((await view(owner.id)).invitations.map((i: any) => i.label)).toEqual(["owners-friend@example.com"]);
    for (const who of [eddie.id, xx.id]) {
      const v = await view(who);
      expect(v.invitations).toEqual([]);
      expect(v.otherInvitations).toBe(1);
      expect(JSON.stringify(v)).not.toContain("owners-friend");
    }
  });

  it("lets a member leave, keeps the owner from leaving, and removing someone voids their invitations", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    const xx = await account("Xiaoxuan");
    allow(owner.id, eddie.id, xx.id);
    const id = await newBoard(owner.id);
    await join(id, owner.id, eddie);
    await join(id, owner.id, xx);
    as(owner.id);
    expect((await leave.POST(req(), { params: { id } })).status).toBe(409);
    expect((await member.DELETE(req(), { params: { id, userId: owner.id } })).status).toBe(400);
    // An invitation Eddie sent back when members could invite.
    const token = "E".repeat(43);
    await sql(`insert into together_invitations (board_id, email_normalized, token_hash, invited_by, sent_at, expires_at)
      values ($1, 'pending@example.com', $2, $3, now(), now() + interval '14 days')`,
      [id, createHash("sha256").update(token).digest("hex"), eddie.id]);
    as(owner.id);
    expect((await member.DELETE(req(), { params: { id, userId: eddie.id } })).status).toBe(200);
    expect((await json(await preview.POST(req({ token })))).body).toEqual({ status: "invalid" });
    // Withdrawn outright, not merely unanswerable.
    expect((await sql(`select revoked_at is not null as gone from together_invitations where invited_by = $1`,
      [eddie.id]))[0].gone).toBe(true);
    as(xx.id);
    expect((await leave.POST(req(), { params: { id } })).status).toBe(200);
    expect((await board.GET(req(undefined, "GET"), { params: { id } })).status).toBe(404);   // stale tab
  });
});

describe("invitations", () => {
  it("is usable once, by the account with that address, and leaves its verification alone", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie", { email: "Eddie.Mixed@Example.com" });
    const imposter = await account("Imposter");
    allow(owner.id, eddie.id, imposter.id);
    const id = await newBoard(owner.id);
    const r = await inviteTo(id, owner.id, "  eddie.mixed@example.COM ");
    expect(r.status).toBe(200);
    expect(sent.at(-1)!.to).toBe("eddie.mixed@example.com");
    const token = tokenOf(sent.at(-1)!);

    // The token is not stored; only its hash is.
    const [row] = await sql("select token_hash, sent_at from together_invitations");
    expect(row.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(await sql("select * from together_invitations"))).not.toContain(token);
    expect(row.sent_at).not.toBeNull();

    // Read while signed in as the inviter: the invitation is not for them.
    expect((await json(await preview.POST(req({ token })))).body)
      .toEqual({ status: "ok", board: "Headband Business", inviter: "Meiling", to: "ed••••ed@example.com", forYou: false });

    as(imposter.id);
    expect((await accept.POST(req({ token }))).status).toBe(403);
    as(eddie.id);
    expect((await json(await accept.POST(req({ token })))).body).toEqual({ boardId: id });
    expect((await sql("select email_verified_at from users where id = $1", [eddie.id]))[0].email_verified_at).toBeNull();
    // Single use.
    expect((await accept.POST(req({ token }))).status).toBe(404);
    expect((await json(await preview.POST(req({ token })))).body).toEqual({ status: "invalid" });
  });

  it("answers every unusable token the same way", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    allow(owner.id, eddie.id);
    const id = await newBoard(owner.id);
    const tokens: string[] = [];
    for (const e of ["a@example.com", "b@example.com", "c@example.com"]) {
      await inviteTo(id, owner.id, e);
      tokens.push(tokenOf(sent.at(-1)!));
    }
    // expired, revoked, and on an archived board
    await sql(`update together_invitations set expires_at = now() - interval '1 second' where email_normalized = 'a@example.com'`);
    await sql(`update together_invitations set revoked_at = now() where email_normalized = 'b@example.com'`);
    const answers = [];
    for (const tok of [tokens[0], tokens[1], "A".repeat(43), "short", null]) {
      answers.push((await json(await preview.POST(req({ token: tok })))).body);
    }
    as(owner.id);
    await board.PATCH(req({ archived: true }), { params: { id } });
    answers.push((await json(await preview.POST(req({ token: tokens[2] })))).body);
    expect(new Set(answers.map((a) => JSON.stringify(a)))).toEqual(new Set([JSON.stringify({ status: "invalid" })]));
  });

  it("tells the inviter nothing about whether the address has an account", async () => {
    const owner = await account("Meiling");
    const existing = await account("Eddie", { email: "eddie@example.com" });
    allow(owner.id, existing.id);
    const id = await newBoard(owner.id);
    const a = await inviteTo(id, owner.id, "eddie@example.com");
    const b = await inviteTo(id, owner.id, "nobody-here@example.com");
    expect(a.status).toBe(b.status);
    expect(Object.keys(a.body)).toEqual(Object.keys(b.body));
    // The two emails are the same message apart from the link.
    const strip = (m: { subject: string; text: string }) => m.subject + m.text.replace(/#t=[A-Za-z0-9_-]+/, "");
    expect(strip(sent[0])).toBe(strip(sent[1]));
  });

  it("leaves nothing usable when the email cannot be sent", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie", { email: "eddie@example.com" });
    allow(owner.id, eddie.id);
    const id = await newBoard(owner.id);
    failNextSend = new Error("provider down");
    const r = await inviteTo(id, owner.id, "eddie@example.com");
    expect(r.status).toBe(502);
    const rows = await sql("select sent_at, revoked_at from together_invitations");
    expect(rows).toHaveLength(1);
    expect(rows[0].sent_at).toBeNull();
    expect(rows[0].revoked_at).not.toBeNull();
    expect(sent).toHaveLength(0);
  });

  it("never activates an invitation after the inviter was told it failed, nor reports success for one revoked mid-send", async () => {
    const owner = await account("Meiling");
    allow(owner.id);
    const id = await newBoard(owner.id);
    // The row is withdrawn while the email is in flight: activation finds nothing → failure.
    duringSend = async () => { await sql("update together_invitations set revoked_at = now()"); };
    const r = await inviteTo(id, owner.id, "race@example.com");
    expect(r.status).toBe(502);
    const token = tokenOf(sent.at(-1)!);
    expect((await json(await preview.POST(req({ token })))).body).toEqual({ status: "invalid" });
  });

  it("withdraws the invitation when the activation's answer is lost", async () => {
    const owner = await account("Meiling");
    allow(owner.id);
    const id = await newBoard(owner.id);
    await sql(`create function tg_fail() returns trigger language plpgsql as $$ begin raise exception 'connection lost'; end $$`);
    await sql(`create trigger tg_fail before update of sent_at on together_invitations for each row execute function tg_fail()`);
    const r = await inviteTo(id, owner.id, "lost@example.com");
    expect(r.status).toBe(502);
    const [row] = await sql("select sent_at, revoked_at from together_invitations");
    expect(row.revoked_at).not.toBeNull();
    expect((await json(await preview.POST(req({ token: tokenOf(sent.at(-1)!) })))).body).toEqual({ status: "invalid" });
  });

  it("answers a malformed invitation id as not found", async () => {
    const owner = await account("Meiling");
    allow(owner.id);
    const id = await newBoard(owner.id);
    as(owner.id);
    for (const inviteId of ["-".repeat(36), "x", randomUUID()]) {
      expect((await inviteOne.DELETE(req(), { params: { id, inviteId } })).status).toBe(404);
    }
  });

  it("lets a retry leave exactly one usable invitation", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie", { email: "eddie@example.com" });
    allow(owner.id, eddie.id);
    const id = await newBoard(owner.id);
    await inviteTo(id, owner.id, "eddie@example.com");
    const first = tokenOf(sent.at(-1)!);
    await inviteTo(id, owner.id, "eddie@example.com");
    const second = tokenOf(sent.at(-1)!);
    expect((await json(await preview.POST(req({ token: first })))).body.status).toBe("invalid");
    expect((await json(await preview.POST(req({ token: second })))).body.status).toBe("ok");
    expect((await sql(`select count(*)::int n from together_invitations where accepted_at is null and revoked_at is null`))[0].n).toBe(1);
  });

  it("can be withdrawn by the owner or its sender, and nobody else", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    const xx = await account("Xiaoxuan");
    allow(owner.id, eddie.id, xx.id);
    const id = await newBoard(owner.id);
    await join(id, owner.id, eddie);
    await join(id, owner.id, xx);
    await inviteTo(id, owner.id, "friend@example.com");
    const [{ id: inviteId }] = await sql(`select id from together_invitations where email_normalized = 'friend@example.com'`);
    for (const who of [xx.id, eddie.id]) {
      as(who);
      expect((await inviteOne.DELETE(req(), { params: { id, inviteId } })).status).toBe(404);
    }
    as(owner.id);
    expect((await inviteOne.DELETE(req(), { params: { id, inviteId } })).status).toBe(200);
    // A member's own invitation from before invitations were the owner's: they
    // may still withdraw it (it only takes something away).
    await sql(`insert into together_invitations (board_id, invitee_id, invited_by, sent_at, expires_at)
      values ($1, $2, $3, now(), now() + interval '14 days')`, [id, owner.id, eddie.id]);
    const [{ id: legacy }] = await sql(`select id from together_invitations where invited_by = $1`, [eddie.id]);
    as(eddie.id);
    expect((await inviteOne.DELETE(req(), { params: { id, inviteId: legacy } })).status).toBe(200);
  });

  it("is rate-limited per inviter, in the database", async () => {
    const owner = await account("Meiling");
    allow(owner.id);
    const id = await newBoard(owner.id);
    for (let i = 0; i < invitations.MAX_INVITES_PER_DAY; i++) {
      expect((await inviteTo(id, owner.id, `p${i}@example.com`)).status).toBe(200);
    }
    expect((await inviteTo(id, owner.id, "one-more@example.com")).status).toBe(429);
  });

  it("lets an account outside the preview accept the invitation it was sent — and nothing more", async () => {
    const owner = await account("Meiling");
    const newbie = await account("Newbie", { email: "newbie@example.com", verified: true });
    const imposter = await account("Imposter");
    allow(owner.id);
    const id = await newBoard(owner.id, "Headband Business");
    const unrelated = await newBoard(owner.id, "Private plans");
    await inviteTo(id, owner.id, "newbie@example.com");
    const token = tokenOf(sent.at(-1)!);

    // Holding an emailed invitation to its own (proved) address, the account
    // already sees that one invitation in-app — and nothing else.
    as(newbie.id);
    const waiting = (await json(await home.GET())).body;
    expect(waiting).toMatchObject({ access: "invited", boards: [], people: [] });
    expect(waiting.invitations.map((i: any) => i.board)).toEqual(["Headband Business"]);
    // Someone else outside the preview cannot use it, in-app or by token.
    as(imposter.id);
    expect((await home.GET()).status).toBe(404);
    expect((await respond.POST(req({ id: waiting.invitations[0].id, accept: true }))).status).toBe(404);
    expect((await accept.POST(req({ token }))).status).toBe(403);

    as(newbie.id);
    expect((await json(await accept.POST(req({ token })))).body).toEqual({ boardId: id });
    const h = (await json(await home.GET())).body;
    expect(h).toMatchObject({ access: "invited", people: [], invitations: [] });
    expect(h.boards.map((b: any) => b.name)).toEqual(["Headband Business"]);
    expect(await canSee(newbie.id, id)).toBe(true);
    expect(await canSee(newbie.id, unrelated)).toBe(false);

    // Not the preview: no boards of their own, no inviting anyone, by either route.
    as(newbie.id);
    expect((await boards.POST(req({ name: "Mine" }))).status).toBe(403);
    expect((await invite.POST(req({ email: "friend@example.com" }), { params: { id } })).status).toBe(403);
    expect((await invite.POST(req({ people: [owner.id] }), { params: { id } })).status).toBe(403);
    expect((await json(await board.GET(req(undefined, "GET"), { params: { id } }))).body.canInvite).toBe(false);
    expect(sent).toHaveLength(1);
    // A member may still leave.
    expect((await leave.POST(req(), { params: { id } })).status).toBe(200);
    expect((await home.GET()).status).toBe(404);
  });

  it("lets an invited account answer later in-platform invitations, and keeps access only while something is pending or joined", async () => {
    const owner = await account("Meiling");
    const newbie = await account("Newbie", { email: "newbie@example.com" });
    allow(owner.id);
    const a = await newBoard(owner.id, "A");
    await join(a, owner.id, newbie);
    const b = await newBoard(owner.id, "B", [newbie.id]);
    as(owner.id);
    await member.DELETE(req(), { params: { id: a, userId: newbie.id } });
    // Off every board, but an invitation is waiting: Together shows just that.
    const [w] = await waitingFor(newbie.id);
    expect(w).toMatchObject({ board: "B" });
    expect(await canSee(newbie.id, a)).toBe(false);
    expect(await canSee(newbie.id, b)).toBe(false);
    expect((await answer(newbie.id, w.id, false)).status).toBe(200);
    as(newbie.id);
    expect((await home.GET()).status).toBe(404);
  });

  it("switches off entirely, invitations included, when the preview list is empty", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie", { email: "eddie@example.com" });
    allow(owner.id, eddie.id);
    const id = await newBoard(owner.id);
    await join(await newBoard(owner.id, "Shared"), owner.id, eddie);
    await newBoard(owner.id, "Third", [eddie.id]);
    await inviteTo(id, owner.id, "eddie@example.com");
    const token = tokenOf(sent.at(-1)!);
    const [w] = await waitingFor(eddie.id);
    allow();
    as(eddie.id);
    expect((await home.GET()).status).toBe(404);
    expect((await json(await preview.POST(req({ token })))).body).toEqual({ status: "invalid" });
    expect((await accept.POST(req({ token }))).status).toBe(404);
    expect((await answer(eddie.id, w.id, true)).status).toBe(404);
    expect(await canSee(owner.id, id)).toBe(false);
  });

  it("records counts and nothing anybody wrote", async () => {
    const owner = await account("Meiling", { email: "meiling@example.com" });
    const eddie = await account("Eddie", { email: "eddie@example.com" });
    allow(owner.id, eddie.id);
    const id = await newBoard(owner.id, "Secret Project Name");
    await join(id, owner.id, eddie);
    const text = JSON.stringify(tracked);
    expect(text).not.toMatch(/Secret Project|@example\.com|Meiling|Eddie/);
    const second = await newBoard(owner.id, "Another Secret", [eddie.id]);
    await answer(eddie.id, (await waitingFor(eddie.id))[0].id, false);
    void second;
    const all = JSON.stringify(tracked);
    expect(all).not.toMatch(/Secret|@example\.com|Meiling|Eddie/);
    expect(tracked.map((e) => e.event)).toEqual([
      "together_board_created", "together_invitation_sent", "together_invitation_accepted",
      "together_board_created", "together_invitation_declined"]);
    expect(tracked[1].properties).toEqual({ channel: "email", count: 1 });
    expect(tracked[3].properties).toEqual({ people: 1, emails: 0 });
  });
});

describe("answering an email invitation in-app", () => {
  it("shows an email invitation to the account with that proved address, and Accept joins that one board", async () => {
    const owner = await account("Meiling");
    const reg = await account("Reggie", { email: "reggie@example.com", verified: true });
    allow(owner.id);
    const id = await newBoard(owner.id, "Headband Business");
    const unrelated = await newBoard(owner.id, "Private plans");
    await inviteTo(id, owner.id, "Reggie@Example.com");
    // The email still went out, exactly as for an address with no account.
    expect(sent).toHaveLength(1);

    // The bell's list and the home show the same one invitation.
    as(reg.id);
    const list = (await json(await inviteList.GET())).body.invitations;
    expect(list.map((i: any) => i.board)).toEqual(["Headband Business"]);
    expect(await waitingFor(reg.id)).toMatchObject([{ board: "Headband Business", inviter: "Meiling" }]);

    // Accept in-app — no token, no link.
    expect((await answer(reg.id, list[0].id, true)).body).toEqual({ boardId: id });
    expect(await memberIds(id)).toContain(reg.id);
    expect(await canSee(reg.id, id)).toBe(true);
    expect(await canSee(reg.id, unrelated)).toBe(false);
    // The accepted invitation is spent: its emailed token answers "invalid".
    const token = tokenOf(sent.at(-1)!);
    as(reg.id);
    expect((await accept.POST(req({ token }))).status).toBe(404);
  });

  it("lets the account decline in-app, which voids the emailed link and clears the inviter's pending list", async () => {
    const owner = await account("Meiling");
    const reg = await account("Reggie", { email: "reggie@example.com", verified: true });
    allow(owner.id);
    const id = await newBoard(owner.id);
    await inviteTo(id, owner.id, "reggie@example.com");
    const [w] = await waitingFor(reg.id);
    expect((await answer(reg.id, w.id, false)).status).toBe(200);
    expect(await waitingFor(reg.id)).toEqual([]);
    expect(await memberIds(id)).toEqual([owner.id]);
    as(reg.id);
    expect((await accept.POST(req({ token: tokenOf(sent.at(-1)!) }))).status).toBe(404);
    as(owner.id);
    expect((await json(await board.GET(req(undefined, "GET"), { params: { id } }))).body.invitations).toEqual([]);
  });

  it("shows nothing in-app while the address is unproved; the emailed token stays the only door", async () => {
    const owner = await account("Meiling");
    const shaky = await account("Shaky", { email: "shaky@example.com" });
    await sql(`update users set verification_required = true, email_verified_at = null where id = $1`, [shaky.id]);
    allow(owner.id);
    const id = await newBoard(owner.id);
    await inviteTo(id, owner.id, "shaky@example.com");

    // Unproved: no in-app invitation, no Together access, no in-app answer.
    as(shaky.id);
    expect((await home.GET()).status).toBe(404);
    const [{ id: inviteId }] = await sql(`select id from together_invitations where board_id = $1`, [id]);
    expect((await respond.POST(req({ id: inviteId, accept: true }))).status).toBe(404);

    // Proving the address brings the invitation into the app.
    await sql(`update users set email_verified_at = now() where id = $1`, [shaky.id]);
    expect(await waitingFor(shaky.id)).toMatchObject([{ inviter: "Meiling" }]);
  });

  it("does not trust an unverified exempt account created after the cutoff — verification or the link upgrade it", async () => {
    const owner = await account("Meiling");
    // An account minted while REQUIRE_EMAIL_VERIFICATION was off, after the
    // cutoff: signed in, exempt from verifying, but its address is unproved.
    const later = await account("Later", { email: "later@example.com" });
    await sql(`update users set verification_required = false, email_verified_at = null,
        created_at = timestamptz '2026-10-17 00:00:01+00' where id = $1`, [later.id]);
    allow(owner.id);
    const id = await newBoard(owner.id);
    await inviteTo(id, owner.id, "later@example.com");

    as(later.id);
    expect((await home.GET()).status).toBe(404);
    const [{ id: inviteId }] = await sql(`select id from together_invitations where board_id = $1`, [id]);
    expect((await respond.POST(req({ id: inviteId, accept: true }))).status).toBe(404);

    // An admin-created account is vouched for, and is trusted after the cutoff.
    await sql(`update users set created_via = 'admin' where id = $1`, [later.id]);
    expect(await waitingFor(later.id)).toMatchObject([{ inviter: "Meiling" }]);
    await sql(`update users set created_via = 'self_signup' where id = $1`, [later.id]);
    expect((await home.GET()).status).toBe(404);
    // Verifying the address — the in-app flow — is the ordinary upgrade.
    await sql(`update users set email_verified_at = now() where id = $1`, [later.id]);
    expect(await waitingFor(later.id)).toMatchObject([{ inviter: "Meiling" }]);
    // The emailed link always worked: it proves the inbox itself.
  });

  it("lists invitations only for their account: the bell answers everyone else as not found", async () => {
    const stranger = await account("Stranger");
    const owner = await account("Meiling");
    allow(owner.id);
    await newBoard(owner.id);
    as(stranger.id);
    expect((await inviteList.GET()).status).toBe(404);
    as(null);
    expect((await inviteList.GET()).status).toBe(401);
  });
});

describe("inviting by username", () => {
  const inviteUser = async (boardId: string, from: string, username: string) => {
    as(from);
    return json(await invite.POST(req({ username }), { params: { id: boardId } }));
  };

  it("invites a registered account in-platform — no email — and Accept makes them a member", async () => {
    const owner = await account("Meiling");
    const friend = await account("Friend");
    const [{ username }] = await sql(`select username from users where id = $1`, [friend.id]);
    allow(owner.id);
    const id = await newBoard(owner.id);
    const r = await inviteUser(id, owner.id, username.toUpperCase());   // case does not matter
    expect(r).toMatchObject({ status: 200, body: { invited: 1 } });
    expect(sent).toHaveLength(0);

    const [w] = await waitingFor(friend.id);
    expect(w).toMatchObject({ board: "Headband Business", inviter: "Meiling" });
    expect((await answer(friend.id, w.id, true)).body).toEqual({ boardId: id });
    expect(await memberIds(id)).toContain(friend.id);

    // The channel name only — never the username.
    const sentEvents = tracked.filter((e) => e.event === "together_invitation_sent");
    expect(sentEvents.at(-1)?.properties).toEqual({ channel: "username", count: 1 });
    expect(JSON.stringify(tracked)).not.toContain(username);
  });

  it("says plainly when no account has that username, and skips members and repeats quietly", async () => {
    const owner = await account("Meiling");
    const friend = await account("Friend");
    const [{ username }] = await sql(`select username from users where id = $1`, [friend.id]);
    allow(owner.id);
    const id = await newBoard(owner.id);

    expect((await inviteUser(id, owner.id, "nobody-here")).status).toBe(404);
    expect((await inviteUser(id, owner.id, "")).status).toBe(404);
    expect((await inviteUser(id, owner.id, "two words")).status).toBe(404);

    // Already invited by this inviter: nothing new, said as a count.
    expect((await inviteUser(id, owner.id, username)).body).toEqual({ invited: 1 });
    expect((await inviteUser(id, owner.id, username)).body).toEqual({ invited: 0 });
    // One open invitation per board, invitee and inviter — not a second row.
    expect(await sql(`select count(*)::int n from together_invitations where board_id = $1`, [id]))
      .toMatchObject([{ n: 1 }]);
    // Already a member (the owner themselves): also nothing new.
    const [{ username: own }] = await sql(`select username from users where id = $1`, [owner.id]);
    expect((await inviteUser(id, owner.id, own)).body).toEqual({ invited: 0 });
  });

  it("needs full access and a writable board, like every other way of inviting", async () => {
    const owner = await account("Meiling");
    const member2 = await account("Member", { email: "member@example.com" });
    const outsider = await account("Out");
    const [{ username }] = await sql(`select username from users where id = $1`, [outsider.id]);
    allow(owner.id);
    const id = await newBoard(owner.id);
    await join(id, owner.id, member2);

    as(outsider.id);
    expect((await invite.POST(req({ username }), { params: { id } })).status).toBe(404);
    // A member who is not in the preview may not invite.
    as(member2.id);
    expect((await invite.POST(req({ username }), { params: { id } })).status).toBe(403);
    // An archived space takes no invitations.
    as(owner.id);
    await board.PATCH(req({ archived: true }, "PATCH"), { params: { id } });
    expect((await inviteUser(id, owner.id, username)).status).toBe(409);
  });
});

describe("the invitation preview: masked address and whose it is", () => {
  it("says which account it is for — masked, and never the full address — and whether that is the viewer", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie", { email: "hemeiling90@outlook.com" });
    const other = await account("Other");
    allow(owner.id);
    const id = await newBoard(owner.id);
    await inviteTo(id, owner.id, "HeMeiling90@Outlook.com");
    const token = tokenOf(sent.at(-1)!);
    const view = async (who: string | null) => { as(who); return json(await preview.POST(req({ token }))); };

    const signedOut = await view(null);
    expect(signedOut.body).toEqual({ status: "ok", board: "Headband Business", inviter: "Meiling",
      to: "he••••90@outlook.com", forYou: null });
    expect((await view(eddie.id)).body.forYou).toBe(true);      // the invited account, whatever the case of its address
    expect((await view(other.id)).body.forYou).toBe(false);     // signed in as someone else
    expect((await view(owner.id)).body.forYou).toBe(false);
    for (const r of [signedOut, await view(eddie.id), await view(other.id)]) {
      expect(JSON.stringify(r.body)).not.toMatch(/hemeiling90/i);
    }
    // Viewing writes nothing.
    expect((await sql("select accepted_at, revoked_at from together_invitations"))[0]).toEqual({ accepted_at: null, revoked_at: null });
  });

  it("answers the same way whether or not the invited address has an account", async () => {
    const owner = await account("Meiling");
    await account("Has", { email: "has-account@example.com" });
    const viewer = await account("Viewer");
    allow(owner.id);
    const id = await newBoard(owner.id);
    await inviteTo(id, owner.id, "has-account@example.com");
    const a = tokenOf(sent.at(-1)!);
    await inviteTo(id, owner.id, "no-account@example.com");
    const b = tokenOf(sent.at(-1)!);
    for (const who of [null, viewer.id]) {
      as(who);
      const ra = (await json(await preview.POST(req({ token: a })))).body;
      const rb = (await json(await preview.POST(req({ token: b })))).body;
      expect(Object.keys(ra)).toEqual(Object.keys(rb));
      expect(ra.forYou).toBe(rb.forYou);
    }
  });

  it("gives an unusable token exactly the old answer, signed in or not", async () => {
    const owner = await account("Meiling");
    allow(owner.id);
    const id = await newBoard(owner.id);
    await inviteTo(id, owner.id, "x@example.com");
    const token = tokenOf(sent.at(-1)!);
    await sql("update together_invitations set revoked_at = now()");
    for (const who of [null, owner.id]) {
      as(who);
      for (const t of [token, "A".repeat(43), "short", null]) {
        expect((await json(await preview.POST(req({ token: t })))).body).toEqual({ status: "invalid" });
      }
    }
    allow();   // switched off
    expect((await json(await preview.POST(req({ token })))).body).toEqual({ status: "invalid" });
  });
});

describe("the sidebar's board shortcuts", () => {
  it("lists the account's active boards — owned or joined — by name, first five, with the total", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    const stranger = await account("Stranger");
    allow(owner.id, eddie.id, stranger.id);
    const names = ["Zebra", "apple", "Mango", "banana", "Cherry", "date", "Elder"];
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = await newBoard(owner.id, n);
    const theirs = await newBoard(stranger.id, "Not yours");
    as(owner.id);
    await board.PATCH(req({ archived: true }), { params: { id: ids.Elder } });   // archived: never a shortcut
    const mine = await boardsLib.sidebarBoards(owner.id);
    expect(mine.total).toBe(6);
    expect(mine.boards.map((b) => b.name)).toEqual(["apple", "banana", "Cherry", "date", "Mango"]);
    expect(Object.keys(mine.boards[0]).sort()).toEqual(["id", "name"]);
    expect(mine.boards.map((b) => b.id)).not.toContain(theirs);
    // The sidebar shows the overview's first five, in the same order.
    as(owner.id);
    const tiles = (await json(await home.GET())).body.boards.filter((b: any) => !b.archived).map((b: any) => b.name);
    expect(tiles.slice(0, 5)).toEqual(mine.boards.map((b) => b.name));

    // A member sees a board they joined, exactly as its owner does.
    await join(ids.Zebra, owner.id, eddie);
    expect(await boardsLib.sidebarBoards(eddie.id)).toEqual({ boards: [{ id: ids.Zebra, name: "Zebra" }], total: 1 });
    expect(await boardsLib.sidebarBoards(stranger.id)).toEqual({ boards: [{ id: theirs, name: "Not yours" }], total: 1 });

    // Leaving, and the kill switch, take shortcuts away.
    as(eddie.id);
    await leave.POST(req(), { params: { id: ids.Zebra } });
    expect(await boardsLib.sidebarBoards(eddie.id)).toEqual({ boards: [], total: 0 });
    allow();
    expect(await boardsLib.sidebarBoards(owner.id)).toEqual({ boards: [], total: 0 });
  });
});

describe("account deletion", () => {
  const roles = async (boardId: string) =>
    (await sql(`select p.first_name as who, m.role from together_members m join profiles p on p.id = m.user_id
      where m.board_id = $1 order by m.joined_at, m.user_id`, [boardId])).map((r: any) => `${r.who}:${r.role}`);
  async function team(...names: string[]) {
    const people = [];
    for (const n of names) people.push(await account(n));
    allow(...people.map((p) => p.id));
    const id = await newBoard(people[0].id);
    for (const p of people.slice(1)) {
      await join(id, people[0].id, p);
      await new Promise((r) => setTimeout(r, 5));   // distinct joined_at
    }
    return { id, people };
  }

  it("hands the board to the longest-standing member when the owner is deleted", async () => {
    const { id, people: [owner] } = await team("Meiling", "Eddie", "Xiaoxuan");
    await sql("delete from users where id = $1", [owner.id]);
    expect(await roles(id)).toEqual(["Eddie:owner", "Xiaoxuan:member"]);
    expect((await sql("select created_by from together_boards where id = $1", [id]))[0].created_by).toBeNull();
  });

  it("deletes the board when the owner is deleted and nobody else is on it", async () => {
    const { id, people: [owner] } = await team("Meiling");
    await sql("delete from users where id = $1", [owner.id]);
    expect(await sql("select id from together_boards where id = $1", [id])).toEqual([]);
  });

  it("removes only the membership when a member is deleted", async () => {
    const { id, people: [, eddie] } = await team("Meiling", "Eddie", "Xiaoxuan");
    await sql("delete from users where id = $1", [eddie.id]);
    expect(await roles(id)).toEqual(["Meiling:owner", "Xiaoxuan:member"]);
  });

  it("keeps a board whose creator is deleted after handing ownership on", async () => {
    const { id, people: [owner, eddie] } = await team("Meiling", "Eddie");
    await sql("delete from users where id = $1", [owner.id]);
    const [b] = await sql("select name, created_by from together_boards where id = $1", [id]);
    expect(b).toEqual({ name: "Headband Business", created_by: null });
    expect(await roles(id)).toEqual(["Eddie:owner"]);
    void eddie;
  });

  it("voids invitations sent by a deleted account, and detaches a deleted acceptor", async () => {
    const { id, people: [owner, eddie] } = await team("Meiling", "Eddie");
    await inviteTo(id, eddie.id, "pending@example.com");
    const token = tokenOf(sent.at(-1)!);
    await sql("delete from users where id = $1", [eddie.id]);
    expect((await json(await preview.POST(req({ token })))).body).toEqual({ status: "invalid" });
    const [acc] = await sql(`select accepted_by from together_invitations where accepted_at is not null`);
    expect(acc.accepted_by).toBeNull();
    void owner;
  });

  for (const order of ["owner first", "member first"] as const) {
    it(`survives a bulk delete of the owner and a member together (${order})`, async () => {
      const { id, people: [owner, eddie, xx] } = await team("Meiling", "Eddie", "Xiaoxuan");
      const ids = order === "owner first" ? [owner.id, eddie.id] : [eddie.id, owner.id];
      await sql("delete from users where id = any($1::uuid[])", [ids]);
      expect(await roles(id)).toEqual(["Xiaoxuan:owner"]);
      void xx;
    });
  }

  it("hands on twice in one statement, even when the heir was brought in by someone also being deleted", async () => {
    const { id, people: [owner, eddie, xx] } = await team("Meiling", "Eddie", "Xiaoxuan");
    const yu = await account("Yu");
    allow(owner.id, eddie.id, xx.id, yu.id);
    // Yu was brought in by Eddie, back when members could invite.
    await sql(`insert into together_members (board_id, user_id, role, added_by) values ($1, $2, 'member', $3)`,
      [id, yu.id, eddie.id]);
    expect((await sql("select added_by from together_members where user_id = $1", [yu.id]))[0].added_by).toBe(eddie.id);
    await sql("delete from users where id = any($1::uuid[])", [[owner.id, eddie.id, xx.id]]);
    expect(await roles(id)).toEqual(["Yu:owner"]);
    expect((await sql("select added_by from together_members where user_id = $1", [yu.id]))[0].added_by).toBeNull();
  });

  it("drops pending in-platform invitations to and from a deleted account", async () => {
    const { id, people: [owner, eddie] } = await team("Meiling", "Eddie");
    const second = await newBoard(owner.id, "Second", [eddie.id]);
    expect(await waitingFor(eddie.id)).toHaveLength(1);
    await sql("delete from users where id = $1", [eddie.id]);
    expect((await sql("select count(*)::int n from together_invitations where board_id = $1", [second]))[0].n).toBe(0);
    void id;
  });

  it("deletes the board when every member is deleted in one statement", async () => {
    const { id, people } = await team("Meiling", "Eddie", "Xiaoxuan");
    await sql("delete from users where id = any($1::uuid[])", [people.map((p) => p.id)]);
    expect(await sql("select id from together_boards where id = $1", [id])).toEqual([]);
    expect((await sql("select count(*)::int n from together_members"))[0].n).toBe(0);
  });

  it("never touches other boards or accounts without Together data", async () => {
    const a = await team("Meiling", "Eddie");
    const other = await account("Other");
    allow(...a.people.map((p) => p.id), other.id);
    const b = await newBoard(other.id, "Other board");
    const plain = await account("Plain");
    await sql("delete from users where id = $1", [plain.id]);
    await sql("delete from users where id = $1", [a.people[1].id]);
    expect(await roles(b)).toEqual(["Other:owner"]);
    expect(await roles(a.id)).toEqual(["Meiling:owner"]);
  });
});

describe("Add members: one directory, owner-only, one invitation per person", () => {
  const connect = (a: string, b: string) => sql(
    `insert into together_connections (user_low, user_high) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid))`,
    [a, b]);
  const view = async (who: string, id: string) => {
    as(who);
    return (await json(await board.GET(req(undefined, "GET"), { params: { id } }))).body;
  };
  const usernameOf = async (id: string) => (await sql(`select username from users where id = $1`, [id]))[0].username;

  it("offers the same accepted collaborators in every space the owner has — new ones too — and a space gives no other", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    allow(owner.id);
    await connect(owner.id, eddie.id);
    const a = await newBoard(owner.id, "A");
    const b = await newBoard(owner.id, "B");
    for (const id of [a, b]) {
      expect((await view(owner.id, id)).invitable).toMatchObject([{ id: eddie.id, collaborator: true, pending: false }]);
    }
    // Invite and accept in A only.
    as(owner.id);
    expect((await json(await invite.POST(req({ people: [eddie.id] }), { params: { id: a } }))).body).toEqual({ invited: 1 });
    expect((await view(owner.id, b)).invitable).toMatchObject([{ id: eddie.id, pending: false }]);   // A's is A's
    expect((await answer(eddie.id, (await waitingFor(eddie.id))[0].id, true)).status).toBe(200);
    expect(await canSee(eddie.id, a)).toBe(true);
    expect(await canSee(eddie.id, b)).toBe(false);
    // B still offers him; a space created later does too.
    expect((await view(owner.id, b)).invitable.map((p: any) => p.id)).toEqual([eddie.id]);
    const c = await newBoard(owner.id, "C");
    expect((await view(owner.id, c)).invitable).toMatchObject([{ id: eddie.id, collaborator: true }]);
    // A no longer offers him: he is a member there.
    expect((await view(owner.id, a)).invitable).toEqual([]);
  });

  it("invites several at once, skipping anyone already invited, and lists them as pending", async () => {
    const owner = await account("Meiling");
    const [p1, p2, p3, p4] = await Promise.all(["Ann", "Bo", "Cy", "Di"].map((n) => account(n)));
    allow(owner.id);
    for (const p of [p1, p2, p3, p4]) await connect(owner.id, p.id);
    const id = await newBoard(owner.id);
    as(owner.id);
    expect((await json(await invite.POST(req({ people: [p1.id, p2.id, p3.id] }), { params: { id } }))).body)
      .toEqual({ invited: 3 });
    expect((await json(await invite.POST(req({ people: [p1.id, p4.id] }), { params: { id } }))).body)
      .toEqual({ invited: 1 });
    // By username, someone already invited: nothing new.
    expect((await json(await invite.POST(req({ username: await usernameOf(p2.id) }), { params: { id } }))).body)
      .toEqual({ invited: 0 });
    const v = await view(owner.id, id);
    expect(v.invitable.every((p: any) => p.pending)).toBe(true);
    expect(v.invitable).toHaveLength(4);
    expect((await sql(`select count(*)::int n from together_invitations where board_id = $1 and revoked_at is null`, [id]))[0].n)
      .toBe(4);
  });

  it("counts an invitation emailed to someone's proved address as pending for them", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie", { email: "eddie@example.com", verified: true });
    allow(owner.id);
    await connect(owner.id, eddie.id);
    const id = await newBoard(owner.id);
    expect((await inviteTo(id, owner.id, "eddie@example.com")).status).toBe(200);
    expect((await view(owner.id, id)).invitable).toMatchObject([{ id: eddie.id, pending: true }]);
    as(owner.id);
    expect((await json(await invite.POST(req({ people: [eddie.id] }), { params: { id } }))).body).toEqual({ invited: 0 });
  });

  it("writes one invitation when the same person is invited twice at the same moment", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    allow(owner.id);
    await connect(owner.id, eddie.id);
    const id = await newBoard(owner.id);
    as(owner.id);
    const results = await Promise.all([1, 2].map(() =>
      invite.POST(req({ people: [eddie.id] }), { params: { id } }).then(json)));
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.map((r) => r.body.invited).sort()).toEqual([0, 1]);
    expect((await sql(`select count(*)::int n from together_invitations where board_id = $1 and invitee_id = $2`,
      [id, eddie.id]))[0].n).toBe(1);
  });

  it("gives a member no directory, no usernames and no way to invite — whatever they send", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    const friend = await account("Friend");
    allow(owner.id, eddie.id);
    await connect(eddie.id, friend.id);   // Eddie's own collaborator
    const id = await newBoard(owner.id);
    await join(id, owner.id, eddie);
    const v = await view(eddie.id, id);
    expect(v.canInvite).toBe(false);
    expect(v.invitable).toEqual([]);
    expect(JSON.stringify(v)).not.toContain(await usernameOf(friend.id));
    as(eddie.id);
    for (const body of [{ people: [friend.id] }, { username: await usernameOf(friend.id) }, { email: "x@example.com" }]) {
      expect((await invite.POST(req(body), { params: { id } })).status).toBe(403);
    }
    expect(await sql(`select id from together_invitations where invited_by = $1`, [eddie.id])).toEqual([]);
  });

  it("refuses to name, by id, anyone who is not the owner's collaborator or co-member", async () => {
    const owner = await account("Meiling");
    const stranger = await account("Stranger");
    allow(owner.id);
    const id = await newBoard(owner.id);
    as(owner.id);
    expect((await invite.POST(req({ people: [stranger.id] }), { params: { id } })).status).toBe(400);
    expect(await sql(`select id from together_invitations where invitee_id = $1`, [stranger.id])).toEqual([]);
  });
});
