import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Global collaborators through the real routes against real Postgres
 * (PGlite). The properties that matter: nobody connects without accepting
 * (mutual requests being the one self-evident exception); any admitted
 * account manages its own connections while space powers stay where they
 * were; a connection grants no space access but makes its holder invitable
 * to any space in one tick; removal deletes exactly the connection; the
 * email channel reveals nothing about any address; and analytics hear
 * channel names, never a person.
 */

let db: PGlite;
const open: PGlite[] = [];
vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__tcDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__tcDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows)),
}));
let signedIn: string | null = null;
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => (signedIn ? { id: signedIn, email: "x" } : null) }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined }), headers: () => new Map() }));
const tracked: { event: string; properties?: Record<string, unknown> }[] = [];
vi.mock("@/lib/analytics/track", () => ({ trackEvent: async (e: any) => { tracked.push(e); } }));

process.env.APP_URL = "http://localhost:3000";
const connectionsLib = await import("../src/lib/together/connections");
const sent: { to: string; subject: string; text: string }[] = [];
connectionsLib.setConnectionSenderForTests(async (m) => { sent.push(m as any); });

const connections = await import("../src/app/api/together/connections/route");
const respond = await import("../src/app/api/together/connections/respond/route");
const withdrawRoute = await import("../src/app/api/together/connections/invitations/route");
const acceptRoute = await import("../src/app/api/together/connections/accept/route");
const previewRoute = await import("../src/app/api/together/connections/preview/route");
const bell = await import("../src/app/api/together/invitations/route");
const home = await import("../src/app/api/together/home/route");
const boards = await import("../src/app/api/together/boards/route");
const invite = await import("../src/app/api/together/boards/[id]/invitations/route");
const board = await import("../src/app/api/together/boards/[id]/route");

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const sql = async (text: string, params: unknown[] = []) => (await db.query<any>(text, params as any[])).rows;
const as = (id: string | null) => { signedIn = id; };
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) });
const req = (body?: unknown, method = "POST") =>
  new Request("http://x/api", { method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" } });
const allow = (...ids: string[]) => { process.env.TOGETHER_PREVIEW_USER_IDS = ids.join(","); };
const tokenOf = (m: { text: string }) => m.text.match(/#c=([A-Za-z0-9_-]{43})/)![1];

async function account(name: string, email = `${name.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`) {
  const [u] = await sql(`insert into users (email, username, password_hash)
    values ($1, $2, 'x') returning id`, [email, `${name.toLowerCase()}${randomUUID().slice(0, 4)}`]);
  await sql(`insert into profiles (id, first_name) values ($1, $2)`, [u.id, name]);
  await sql(`insert into user_preferences (user_id, locale) values ($1, 'en')`, [u.id]);
  return { id: u.id as string, email };
}
const usernameOf = async (id: string) => (await sql("select username from users where id = $1", [id]))[0].username;
const connect = async (from: string, toUsername: string) => {
  as(from);
  return json(await connections.POST(req({ username: toUsername })));
};
const requestsFor = async (who: string) => {
  as(who);
  const r = await json(await bell.GET());
  return (r.body?.invitations ?? []).filter((i: any) => i.kind === "connection");
};
const collaboratorsOf = async (who: string) => {
  as(who);
  return (await json(await home.GET())).body?.collaborators ?? [];
};

beforeEach(async () => {
  db = await PGlite.create();
  open.push(db);
  await db.exec(SCHEMA);
  (globalThis as any).__tcDb = db;
  sent.length = 0;
  tracked.length = 0;
  signedIn = null;
});
afterAll(async () => { for (const d of open) await d.close(); });

describe("connecting", () => {
  it("connects only by acceptance, shows up for both, and the bell carries the request", async () => {
    const ada = await account("Ada"), bea = await account("Bea");
    allow(ada.id);
    expect((await connect(ada.id, await usernameOf(bea.id))).body).toEqual({ invited: 1, connected: false });
    // Not connected yet; the request waits in Bea's bell and home.
    expect(await collaboratorsOf(ada.id)).toEqual([]);
    const [w] = await requestsFor(bea.id);
    expect(w).toMatchObject({ kind: "connection", inviter: "Ada" });

    as(bea.id);
    expect((await json(await respond.POST(req({ id: w.id, accept: true })))).body).toEqual({ connected: true });
    expect((await collaboratorsOf(ada.id)).map((p: any) => p.name)).toEqual(["Bea"]);
    expect((await collaboratorsOf(bea.id)).map((p: any) => p.name)).toEqual(["Ada"]);
    expect(await requestsFor(bea.id)).toEqual([]);
  });

  it("a mutual request is the handshake itself", async () => {
    const ada = await account("Ada"), bea = await account("Bea");
    allow(ada.id, bea.id);
    await connect(ada.id, await usernameOf(bea.id));
    expect((await connect(bea.id, await usernameOf(ada.id))).body).toEqual({ invited: 0, connected: true });
    expect((await collaboratorsOf(ada.id)).map((p: any) => p.name)).toEqual(["Bea"]);
  });

  it("declining answers quietly, holds a quiet week, and reveals nothing to the asker", async () => {
    const ada = await account("Ada"), bea = await account("Bea");
    allow(ada.id);
    await connect(ada.id, await usernameOf(bea.id));
    const [w] = await requestsFor(bea.id);
    as(bea.id);
    expect((await respond.POST(req({ id: w.id, accept: false }))).status).toBe(200);
    expect(await requestsFor(bea.id)).toEqual([]);
    // Asking again inside the quiet week: nothing new, same calm answer.
    expect((await connect(ada.id, await usernameOf(bea.id))).body).toEqual({ invited: 0, connected: false });
  });

  it("an invited-tier member may manage connections; space powers stay full-tier", async () => {
    const owner = await account("Owner"), member = await account("Member"), other = await account("Other");
    allow(owner.id);
    as(owner.id);
    const id = (await json(await boards.POST(req({ name: "Headband", people: [] })))).body.id;
    await sql(`insert into together_members (board_id, user_id, role, added_by) values ($1, $2, 'member', $3)`,
      [id, member.id, owner.id]);
    // The member is not on the preview list, but their connections are theirs.
    expect((await connect(member.id, await usernameOf(other.id))).body).toEqual({ invited: 1, connected: false });
    // Space invitations remain preview-only for them.
    as(member.id);
    expect((await invite.POST(req({ username: await usernameOf(other.id) }), { params: { id } })).status).toBe(403);
    // The request above admits Other to Together (the invited tier), where
    // they may answer it — and manage connections of their own, which is how
    // mutuality works. What they still cannot do is anything with spaces.
    const [w] = await requestsFor(other.id);
    expect(w).toMatchObject({ kind: "connection" });
    as(other.id);
    expect((await boards.POST(req({ name: "Mine", people: [] }))).status).toBe(403);
    // A total stranger, whom nobody has asked anything, stays outside entirely.
    const stranger = await account("Stranger");
    as(stranger.id);
    expect((await connections.POST(req({ username: await usernameOf(owner.id) }))).status).toBe(404);
  });

  it("withdrawing an open request is the sender's, and only the sender's", async () => {
    const ada = await account("Ada"), bea = await account("Bea");
    allow(ada.id);
    await connect(ada.id, await usernameOf(bea.id));
    as(ada.id);
    const mine = (await json(await home.GET())).body.sentConnections;
    expect(mine).toHaveLength(1);
    as(bea.id);
    expect((await withdrawRoute.DELETE(new Request(`http://x/api?id=${mine[0].id}`, { method: "DELETE" }))).status).toBe(404);
    as(ada.id);
    expect((await withdrawRoute.DELETE(new Request(`http://x/api?id=${mine[0].id}`, { method: "DELETE" }))).status).toBe(200);
    expect(await requestsFor(bea.id)).toEqual([]);
  });
});

describe("what a connection is, and is not", () => {
  it("grants no space access, but makes its holder invitable in one tick — and removal keeps memberships", async () => {
    const owner = await account("Owner"), friend = await account("Friend");
    allow(owner.id);
    as(owner.id);
    const id = (await json(await boards.POST(req({ name: "Headband", people: [] })))).body.id;
    // Connect the two (no shared space).
    await connect(owner.id, await usernameOf(friend.id));
    const [w] = await requestsFor(friend.id);
    as(friend.id);
    await respond.POST(req({ id: w.id, accept: true }));
    // No access to the space from the connection alone.
    expect((await board.GET(req(undefined, "GET"), { params: { id } })).status).toBe(404);
    // But the owner can now invite them by tick: they are in `invitable`.
    as(owner.id);
    const view = (await json(await board.GET(req(undefined, "GET"), { params: { id } }))).body;
    expect(view.invitable).toMatchObject([{ name: "Friend", collaborator: true }]);
    const invited = (await json(await invite.POST(req({ people: [friend.id] }), { params: { id } }))).body;
    expect(invited).toEqual({ invited: 1 });
    // Friend accepts the SPACE invitation; now a member.
    as(friend.id);
    const spaceInv = ((await json(await bell.GET())).body.invitations as any[]).find((i) => i.kind === "space");
    const respondSpace = await import("../src/app/api/together/invitations/respond/route");
    await respondSpace.POST(req({ id: spaceInv.id, accept: true }));
    expect((await board.GET(req(undefined, "GET"), { params: { id } })).status).toBe(200);
    // Removing the collaborator leaves the membership standing.
    as(owner.id);
    expect((await connections.DELETE(new Request(`http://x/api?userId=${friend.id}`, { method: "DELETE" }))).status).toBe(200);
    expect(await collaboratorsOf(owner.id)).toEqual([]);
    as(friend.id);
    expect((await board.GET(req(undefined, "GET"), { params: { id } })).status).toBe(200);
  });
});

describe("the email channel", () => {
  it("answers identically whether or not the address has an account, and the token connects only the named inbox", async () => {
    const ada = await account("Ada");
    const casey = await account("Casey", "casey@example.com");
    allow(ada.id);
    as(ada.id);
    const a = await json(await connections.POST(req({ email: "casey@example.com" })));
    const b = await json(await connections.POST(req({ email: "nobody-here@example.com" })));
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
    expect(sent).toHaveLength(2);
    expect(sent.every((m) => /wants to collaborate/.test(m.subject))).toBe(true);

    // Casey accepts by the link, as the signed-in holder of that address.
    const token = tokenOf(sent[0]);
    const preview = await json(await previewRoute.POST(req({ token })));
    expect(preview.body).toMatchObject({ status: "ok", inviter: "Ada", to: "c••••@example.com" });
    const thief = await account("Thief");
    as(thief.id);
    expect((await acceptRoute.POST(req({ token }))).status).toBe(403);
    as(casey.id);
    expect((await json(await acceptRoute.POST(req({ token })))).body).toEqual({ connected: true });
    expect((await collaboratorsOf(ada.id)).map((p: any) => p.name)).toEqual(["Casey"]);
    // Spent: the same token is done.
    expect((await acceptRoute.POST(req({ token }))).status).toBe(404);
  });

  it("one's own address and an already-connected address are pretend-sent, revealing nothing", async () => {
    const ada = await account("Ada", "ada@example.com");
    const bea = await account("Bea", "bea@example.com");
    allow(ada.id, bea.id);
    await connect(ada.id, await usernameOf(bea.id));
    await connect(bea.id, await usernameOf(ada.id));   // mutual → connected
    sent.length = 0;
    as(ada.id);
    expect((await connections.POST(req({ email: "ada@example.com" }))).status).toBe(200);
    expect((await connections.POST(req({ email: "bea@example.com" }))).status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(await sql("select count(*)::int n from together_connection_invitations where email_normalized is not null"))
      .toEqual([{ n: 0 }]);
  });
});

describe("privacy of the records", () => {
  it("analytics hear channels and events, never names, usernames or addresses", async () => {
    const ada = await account("Ada"), bea = await account("Bea", "bea-priv@example.com");
    allow(ada.id);
    await connect(ada.id, await usernameOf(bea.id));
    const [w] = await requestsFor(bea.id);
    as(bea.id);
    await respond.POST(req({ id: w.id, accept: true }));
    as(ada.id);
    await connections.DELETE(new Request(`http://x/api?userId=${bea.id}`, { method: "DELETE" }));
    const text = JSON.stringify(tracked);
    expect(text).not.toMatch(/Ada|Bea|bea-priv|@example\.com/);
    expect(tracked.map((e) => e.event)).toEqual([
      "together_connection_requested", "together_connection_accepted", "together_connection_removed"]);
  });
});
