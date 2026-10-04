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
const members = await import("../src/app/api/together/boards/[id]/members/route");
const member = await import("../src/app/api/together/boards/[id]/members/[userId]/route");
const leave = await import("../src/app/api/together/boards/[id]/leave/route");
const invite = await import("../src/app/api/together/boards/[id]/invitations/route");
const inviteOne = await import("../src/app/api/together/boards/[id]/invitations/[inviteId]/route");
const preview = await import("../src/app/api/together/invitations/preview/route");
const accept = await import("../src/app/api/together/invitations/accept/route");

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

beforeEach(async () => {
  await use();
  sent.length = 0;
  tracked.length = 0;
  signedIn = null;
  failNextSend = null;
  duringSend = null;
});

describe("the preview gate", () => {
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
    expect((await members.POST(req({ people: [stranger.id] }), params)).status).toBe(404);
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
    expect((await members.POST(req({ people: [] }), { params: { id } })).status).toBe(200);   // nothing to add
    // A member may invite.
    expect((await inviteTo(id, eddie.id, "friend@example.com")).status).toBe(200);
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
    expect((await inviteTo(id, eddie.id, "late@example.com")).status).toBe(409);
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
  it("derives People from shared boards, and adds only People without an invitation", async () => {
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

    // A new board with a collaborator ticked: Eddie is on it straight away.
    const second = await newBoard(owner.id, "Home Projects", [eddie.id]);
    as(eddie.id);
    expect((await json(await home.GET())).body.boards.map((b: any) => b.name).sort())
      .toEqual(["Headband Business", "Home Projects"]);

    // Somebody you share nothing with cannot be added that way.
    as(owner.id);
    expect((await boards.POST(req({ name: "Sneaky", people: [stranger.id] }))).status).toBe(400);
    expect((await members.POST(req({ people: [stranger.id] }), { params: { id: second } })).status).toBe(400);
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

  it("shows a pending address only to the owner and to whoever sent it", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie");
    const xx = await account("Xiaoxuan");
    allow(owner.id, eddie.id, xx.id);
    const id = await newBoard(owner.id);
    await join(id, owner.id, eddie);
    await join(id, owner.id, xx);
    await inviteTo(id, eddie.id, "eddies-friend@example.com");
    const view = async (who: string) => { as(who); return (await json(await board.GET(req(undefined, "GET"), { params: { id } }))).body; };
    expect((await view(owner.id)).invitations.map((i: any) => i.email)).toEqual(["eddies-friend@example.com"]);
    expect((await view(eddie.id)).invitations.map((i: any) => i.email)).toEqual(["eddies-friend@example.com"]);
    const x = await view(xx.id);
    expect(x.invitations).toEqual([]);
    expect(x.otherInvitations).toBe(1);
    expect(JSON.stringify(x)).not.toContain("eddies-friend");
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
    await inviteTo(id, eddie.id, "pending@example.com");
    const token = tokenOf(sent.at(-1)!);
    as(owner.id);
    expect((await member.DELETE(req(), { params: { id, userId: eddie.id } })).status).toBe(200);
    expect((await json(await preview.POST(req({ token })))).body).toEqual({ status: "invalid" });
    as(xx.id);
    expect((await leave.POST(req(), { params: { id } })).status).toBe(200);
    expect((await board.GET(req(undefined, "GET"), { params: { id } })).status).toBe(404);   // stale tab
  });
});

describe("invitations", () => {
  it("is usable once, by the account with that address, and verifies the address", async () => {
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

    expect((await json(await preview.POST(req({ token })))).body)
      .toEqual({ status: "ok", board: "Headband Business", inviter: "Meiling" });

    as(imposter.id);
    expect((await accept.POST(req({ token }))).status).toBe(403);
    as(eddie.id);
    expect((await json(await accept.POST(req({ token })))).body).toEqual({ boardId: id });
    expect((await sql("select email_verified_at from users where id = $1", [eddie.id]))[0].email_verified_at).not.toBeNull();
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
    await inviteTo(id, eddie.id, "friend@example.com");
    const [{ id: inviteId }] = await sql(`select id from together_invitations where email_normalized = 'friend@example.com'`);
    as(xx.id);
    expect((await inviteOne.DELETE(req(), { params: { id, inviteId } })).status).toBe(404);
    as(eddie.id);
    expect((await inviteOne.DELETE(req(), { params: { id, inviteId } })).status).toBe(200);
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

  it("refuses an account outside the preview, even with a valid token", async () => {
    const owner = await account("Meiling");
    const eddie = await account("Eddie", { email: "eddie@example.com" });
    allow(owner.id);
    const id = await newBoard(owner.id);
    await inviteTo(id, owner.id, "eddie@example.com");
    as(eddie.id);
    expect((await accept.POST(req({ token: tokenOf(sent.at(-1)!) }))).status).toBe(404);
    expect((await sql("select count(*)::int n from together_members where board_id = $1", [id]))[0].n).toBe(1);
  });

  it("records counts and nothing anybody wrote", async () => {
    const owner = await account("Meiling", { email: "meiling@example.com" });
    const eddie = await account("Eddie", { email: "eddie@example.com" });
    allow(owner.id, eddie.id);
    const id = await newBoard(owner.id, "Secret Project Name");
    await join(id, owner.id, eddie);
    const text = JSON.stringify(tracked);
    expect(text).not.toMatch(/Secret Project|@example\.com|Meiling|Eddie/);
    expect(tracked.map((e) => e.event)).toEqual(
      ["together_board_created", "together_invitation_sent", "together_invitation_accepted"]);
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
    await inviteTo(id, eddie.id, yu.email);
    as(yu.id);
    await accept.POST(req({ token: tokenOf(sent.at(-1)!) }));
    expect((await sql("select added_by from together_members where user_id = $1", [yu.id]))[0].added_by).toBe(eddie.id);
    await sql("delete from users where id = any($1::uuid[])", [[owner.id, eddie.id, xx.id]]);
    expect(await roles(id)).toEqual(["Yu:owner"]);
    expect((await sql("select added_by from together_members where user_id = $1", [yu.id]))[0].added_by).toBeNull();
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
