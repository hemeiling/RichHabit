import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The admin operations that CHANGE accounts, end to end against the real
 * routes and the real data layer (PGlite): create, disable/enable, role,
 * password reset, delete, and the bulk forms. The read side has its own
 * suite (admin-users); until now the write side had none, and these are the
 * operations where a defect costs someone their account.
 *
 * What must hold: every door answers 404 to anyone who is not an admin —
 * signed out or signed in alike — and changes nothing; every change writes
 * the audit entry that says who did what to whom; the protections (your own
 * account, the last active admin) refuse rather than destroy; a credential
 * leaves the server exactly once, in the response to the admin who asked,
 * and never reaches the audit log.
 */

// ── the app's surroundings ───────────────────────────────────────────────────
let db: PGlite;
vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__aDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__aDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows)),
}));
const sent: { to: string }[] = [];
vi.mock("@/lib/email/send", () => ({ sendMail: async (m: any) => { sent.push(m); } }));
const tracked: { event: string }[] = [];
vi.mock("@/lib/analytics/track", () => ({ trackEvent: async (e: any) => { tracked.push(e); } }));

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, opts?: { expires?: Date; maxAge?: number }) => {
      if ((opts?.expires && opts.expires.getTime() <= Date.now()) || opts?.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
  }),
  headers: () => new Map(),
}));

process.env.APP_URL = "http://app.test";

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");

let usersRoute: any, userRoute: any, bulkRoute: any, signinRoute: any, auth: any, services: any;

beforeAll(async () => {
  usersRoute = await import("../src/app/api/admin/users/route");
  userRoute = await import("../src/app/api/admin/users/[id]/route");
  bulkRoute = await import("../src/app/api/admin/users/bulk/route");
  signinRoute = await import("../src/app/api/auth/signin/route");
  auth = await import("../src/lib/auth");
  services = await import("../src/lib/admin/users");
});
afterAll(async () => { await db?.close(); });

let PW_HASH = "";
beforeEach(async () => {
  await db?.close();
  db = await PGlite.create();
  (globalThis as any).__aDb = db;
  await db.exec(SCHEMA);
  jar.clear();
  sent.length = 0;
  tracked.length = 0;
  PW_HASH ||= await auth.hashPassword("Verdant-Meadow-42");
});

// ── the cast ─────────────────────────────────────────────────────────────────
const make = async (username: string, opts: { role?: "user" | "admin"; disabled?: boolean; email?: string } = {}) => {
  const r = await db.query<{ id: string }>(
    `insert into users (email, username, password_hash, role, disabled_at, created_via)
     values ($1, $2, $3, $4::user_role, $5, 'admin') returning id`,
    [opts.email ?? `${username}@example.com`, username, PW_HASH, opts.role ?? "user",
      opts.disabled ? new Date() : null]);
  const id = r.rows[0].id;
  await db.query(`insert into profiles (id) values ($1)`, [id]);
  return id;
};
const signInAs = async (id: string) => { jar.clear(); await auth.createSession(id); };

const post = (url: string, body: unknown) => new Request(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const patch = (body: unknown) => new Request("http://app.test/api/admin/users/x", {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const createBody = (over: Record<string, unknown> = {}) => ({
  username: "newling", role: "user", credential: "temporary", seedHabits: false, ...over,
});

const audits = async () => (await db.query<any>(
  `select admin_email, target_id::text, target_email, action, details
     from admin_audit_log order by created_at, id`)).rows;
const userRow = async (id: string) => (await db.query<any>(
  `select username, role::text as role, disabled_at, must_change_password, password_hash
     from users where id = $1`, [id])).rows[0];
const canSignIn = async (identifier: string, password: string) => {
  jar.clear();
  const res: Response = await signinRoute.POST(post("http://app.test/api/auth/signin", { identifier, password }));
  return res.status;
};

// ── the door ─────────────────────────────────────────────────────────────────
describe("the door", () => {
  it("every write route answers 404 to the signed-out and changes nothing", async () => {
    const target = await make("bystander");
    const calls: Promise<Response>[] = [
      usersRoute.POST(post("http://app.test/api/admin/users", createBody())),
      userRoute.PATCH(patch({ action: "disable" }), { params: { id: target } }),
      userRoute.DELETE(new Request("http://app.test", { method: "DELETE" }), { params: { id: target } }),
      bulkRoute.POST(post("http://app.test/api/admin/users/bulk", { action: "delete", ids: [target] })),
    ];
    for (const c of calls) expect((await c).status).toBe(404);
    expect(await userRow(target)).toBeTruthy();
    expect(await audits()).toEqual([]);
  });

  it("…and the same 404 to an ordinary signed-in account — admin is read from the role column, not the client", async () => {
    const target = await make("bystander");
    const mallory = await make("mallory");
    await signInAs(mallory);
    const tries: [string, Promise<Response>][] = [
      ["create", usersRoute.POST(post("http://app.test/api/admin/users", createBody()))],
      ["promote self", userRoute.PATCH(patch({ action: "role", role: "admin" }), { params: { id: mallory } })],
      ["delete", userRoute.DELETE(new Request("http://app.test", { method: "DELETE" }), { params: { id: target } })],
      ["bulk", bulkRoute.POST(post("http://app.test/api/admin/users/bulk", { action: "disable", ids: [target] }))],
    ];
    for (const [, t] of tries) expect((await t).status).toBe(404);
    expect((await userRow(mallory)).role).toBe("user");
    expect((await userRow(target)).disabled_at).toBeNull();
    expect(await audits()).toEqual([]);
  });
});

// ── creating accounts ────────────────────────────────────────────────────────
describe("create", () => {
  it("a temporary credential works exactly once as handed back, must be changed, and never reaches the log", async () => {
    const boss = await make("boss", { role: "admin" });
    await signInAs(boss);
    const res: Response = await usersRoute.POST(post("http://app.test/api/admin/users", createBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.temporaryPassword).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$|^[a-z2-9-]{8,}$/i);

    const made = await userRow(body.id);
    expect(made.role).toBe("user");
    expect(made.must_change_password).toBe(true);
    expect(await canSignIn("newling", body.temporaryPassword)).toBe(200);
    expect(await canSignIn("newling", "Wrong-Meadow-99")).toBe(401);

    const log = await audits();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "user_created", admin_email: "boss@example.com", target_id: body.id });
    expect(log[0].details.credential).toBe("temporary");
    expect(JSON.stringify(log)).not.toContain(body.temporaryPassword);
  });

  it("an invite returns a single setup token row created by this admin; creating an admin gets its own action", async () => {
    const boss = await make("boss", { role: "admin" });
    await signInAs(boss);
    const res: Response = await usersRoute.POST(post("http://app.test/api/admin/users",
      createBody({ username: "invited", credential: "invite" })));
    const body = await res.json();
    expect(body.setupToken).toBeTruthy();
    const invites = (await db.query<any>(
      `select user_id::text as uid, created_by::text as by, used_at from user_invites`)).rows;
    expect(invites).toEqual([{ uid: body.id, by: boss, used_at: null }]);

    const res2: Response = await usersRoute.POST(post("http://app.test/api/admin/users",
      createBody({ username: "colleague", role: "admin", credential: "invite" })));
    expect(res2.status).toBe(200);
    expect((await audits()).map((a) => a.action)).toEqual(["user_created", "admin_account_created"]);
  });

  it("a taken address is a 409 with no account and no audit entry", async () => {
    const boss = await make("boss", { role: "admin" });
    await make("existing", { email: "taken@example.com" });
    await signInAs(boss);
    const res: Response = await usersRoute.POST(post("http://app.test/api/admin/users",
      createBody({ username: "another", email: "taken@example.com" })));
    expect(res.status).toBe(409);
    expect((await db.query<any>(`select count(*)::int as n from users`)).rows[0].n).toBe(2);
    expect(await audits()).toEqual([]);
  });
});

// ── disabling, enabling, deleting ────────────────────────────────────────────
describe("disable, enable, delete", () => {
  it("disabling ends the sessions and is audited; enabling brings the account back", async () => {
    const boss = await make("boss", { role: "admin" });
    const target = await make("meek");
    await signInAs(target);              // the target is signed in somewhere
    await signInAs(boss);
    expect((await userRoute.PATCH(patch({ action: "disable" }), { params: { id: target } })).status).toBe(200);
    expect((await userRow(target)).disabled_at).not.toBeNull();
    const sessions = (await db.query<any>(`select count(*)::int as n from sessions where user_id = $1`, [target])).rows[0];
    expect(sessions.n).toBe(0);
    expect(await canSignIn("meek", "Verdant-Meadow-42")).toBe(403);

    await signInAs(boss);                // canSignIn borrows the one cookie jar
    expect((await userRoute.PATCH(patch({ action: "enable" }), { params: { id: target } })).status).toBe(200);
    expect((await userRow(target)).disabled_at).toBeNull();
    expect(await canSignIn("meek", "Verdant-Meadow-42")).toBe(200);
    await signInAs(boss);
    expect((await audits()).map((a) => a.action)).toEqual(["user_disabled", "user_enabled"]);
  });

  it("you cannot disable or delete the account you are signed in with", async () => {
    const boss = await make("boss", { role: "admin" });
    await signInAs(boss);
    expect((await userRoute.PATCH(patch({ action: "disable" }), { params: { id: boss } })).status).toBe(409);
    expect((await userRoute.DELETE(new Request("http://app.test", { method: "DELETE" }), { params: { id: boss } })).status).toBe(409);
    expect((await userRow(boss)).disabled_at).toBeNull();
    expect(await audits()).toEqual([]);
  });

  it("deleting removes the account and what it owns, detaches analytics, and audits by address first", async () => {
    const boss = await make("boss", { role: "admin" });
    const target = await make("leaver");
    await db.query(`insert into habits (user_id, name, category, kind) values ($1, 'Stretch', 'morning', 'good')`, [target]);
    await db.query(`insert into user_sessions (user_id) values ($1)`, [target]);
    await signInAs(boss);
    expect((await userRoute.DELETE(new Request("http://app.test", { method: "DELETE" }), { params: { id: target } })).status).toBe(200);

    expect(await userRow(target)).toBeUndefined();
    expect((await db.query<any>(`select count(*)::int as n from habits`)).rows[0].n).toBe(0);
    const detached = (await db.query<any>(`select user_id from user_sessions`)).rows;
    expect(detached).toEqual([{ user_id: null }]);
    const log = await audits();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "user_deleted", target_email: "leaver@example.com" });
  });
});

// ── roles ────────────────────────────────────────────────────────────────────
describe("roles", () => {
  it("promotion and demotion write one column, audit from→to, and touch nothing the person built", async () => {
    const boss = await make("boss", { role: "admin" });
    const target = await make("rising");
    await db.query(`insert into habits (user_id, name, category, kind) values ($1, 'Read', 'nighttime', 'good')`, [target]);
    const before = (await db.query<any>(`select md5(string_agg(h::text, '|' order by h.id)) as h from habits h`)).rows[0].h;
    await signInAs(boss);

    expect((await userRoute.PATCH(patch({ action: "role", role: "admin" }), { params: { id: target } })).status).toBe(200);
    expect((await userRow(target)).role).toBe("admin");
    expect((await userRoute.PATCH(patch({ action: "role", role: "user" }), { params: { id: target } })).status).toBe(200);
    expect((await userRow(target)).role).toBe("user");

    expect((await db.query<any>(`select md5(string_agg(h::text, '|' order by h.id)) as h from habits h`)).rows[0].h).toBe(before);
    const log = await audits();
    expect(log.map((a) => [a.action, a.details.from, a.details.to])).toEqual([
      ["user_role_changed", "user", "admin"], ["user_role_changed", "admin", "user"]]);
  });

  it("you cannot remove your own admin role, and setting the role an account already has audits nothing", async () => {
    const boss = await make("boss", { role: "admin" });
    await signInAs(boss);
    expect((await userRoute.PATCH(patch({ action: "role", role: "user" }), { params: { id: boss } })).status).toBe(409);
    expect((await userRow(boss)).role).toBe("admin");
    expect((await userRoute.PATCH(patch({ action: "role", role: "admin" }), { params: { id: boss } })).status).toBe(200);
    expect(await audits()).toEqual([]);
  });
});

// ── password reset ───────────────────────────────────────────────────────────
describe("password reset", () => {
  it("the old password dies, the new one is owed a change, sessions end, and the log never sees it", async () => {
    const boss = await make("boss", { role: "admin" });
    const target = await make("lockedout");
    await signInAs(target);
    await signInAs(boss);
    const res: Response = await userRoute.PATCH(patch({ action: "reset_password" }), { params: { id: target } });
    expect(res.status).toBe(200);
    const { temporaryPassword } = await res.json();
    expect(temporaryPassword).toBeTruthy();

    expect((await db.query<any>(`select count(*)::int as n from sessions where user_id = $1`, [target])).rows[0].n).toBe(0);
    expect(await canSignIn("lockedout", "Verdant-Meadow-42")).toBe(401);
    expect(await canSignIn("lockedout", temporaryPassword)).toBe(200);
    expect((await userRow(target)).must_change_password).toBe(true);

    await signInAs(boss);
    const log = await audits();
    expect(log.map((a) => a.action)).toEqual(["password_reset_requested"]);
    expect(JSON.stringify(log)).not.toContain(temporaryPassword);
  });
});

// ── bulk operations ──────────────────────────────────────────────────────────
describe("bulk", () => {
  it("one request: deletes what it may, skips self and the unknown by name, audits each deletion as bulk", async () => {
    const boss = await make("boss", { role: "admin" });
    const a = await make("alpha");
    const b = await make("beta");
    const ghost = randomUUID();
    await signInAs(boss);
    const res: Response = await bulkRoute.POST(post("http://app.test/api/admin/users/bulk",
      { action: "delete", ids: [a, b, boss, ghost] }));
    const body = await res.json();
    expect(body.deleted).toBe(2);
    expect(body.skipped.map((s: any) => s.reason).sort()).toEqual(["not_found", "self"]);
    expect((await db.query<any>(`select count(*)::int as n from users`)).rows[0].n).toBe(1);
    const log = await audits();
    expect(log.map((l) => [l.action, l.details.bulk])).toEqual([["user_deleted", true], ["user_deleted", true]]);
  });

  it("bulk disable protects the set's last active admin — counted against everything being disabled at once", async () => {
    /*
     * Reachable only mid-race in production (the caller is an active admin,
     * so single requests always leave them standing); the service is called
     * directly here, as the caller whose own row just went inactive.
     */
    const ghostAdmin = { id: await make("ghost", { role: "admin", disabled: true }), email: "ghost@example.com" };
    const a = await make("adminA", { role: "admin" });
    const b = await make("adminB", { role: "admin" });
    const result = await services.bulkSetDisabled(ghostAdmin, [a, b], true);
    expect(result.skipped.map((s: any) => s.reason)).toEqual(["last_admin"]);
    const active = (await db.query<any>(
      `select count(*)::int as n from users where role = 'admin' and disabled_at is null`)).rows[0];
    expect(active.n).toBe(1);

    const del = await services.bulkDeleteAccounts(ghostAdmin,
      (await db.query<any>(`select id::text as id from users where role = 'admin' and disabled_at is null`)).rows.map((r: any) => r.id));
    expect(del.deleted).toBe(0);
    expect(del.skipped.map((s: any) => s.reason)).toEqual(["last_admin"]);
  });

  it("bulk enable turns accounts back on and audits each one", async () => {
    const boss = await make("boss", { role: "admin" });
    const a = await make("alpha", { disabled: true });
    const b = await make("beta", { disabled: true });
    await signInAs(boss);
    const res: Response = await bulkRoute.POST(post("http://app.test/api/admin/users/bulk",
      { action: "enable", ids: [a, b] }));
    expect(res.status).toBe(200);
    const rows = (await db.query<any>(`select count(*)::int as n from users where disabled_at is null`)).rows[0];
    expect(rows.n).toBe(3);
    expect((await audits()).map((l) => l.action)).toEqual(["user_enabled", "user_enabled"]);
  });
});
