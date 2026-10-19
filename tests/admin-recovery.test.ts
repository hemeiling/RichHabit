import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The minimal Admin safeguard (UM-5): the app never resets an Admin's password
 * or reissues an Admin's setup link — current or former Admin, the acting one
 * included — while ordinary accounts keep both; an Admin's own Change password
 * still works; and the owner's command-line recovery (`npm run admin:password`)
 * finds username-only accounts, owes a change, ends every session, audits, and
 * produces a hash the app accepts. Through the real routes, against PGlite.
 */

let db: PGlite;
vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__rDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__rDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows)),
}));
vi.mock("@/lib/email/send", () => ({ sendMail: async () => {} }));
vi.mock("@/lib/analytics/track", () => ({ trackEvent: async () => {} }));
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
let userRoute: any, signinRoute: any, changeRoute: any, auth: any, cli: any;
beforeAll(async () => {
  userRoute = await import("../src/app/api/admin/users/[id]/route");
  signinRoute = await import("../src/app/api/auth/signin/route");
  changeRoute = await import("../src/app/api/auth/change-password/route");
  auth = await import("../src/lib/auth");
  cli = await import("../scripts/set-password.mjs");
});
afterAll(async () => { await db?.close(); });
let PW = "";
beforeEach(async () => {
  await db?.close();
  db = await PGlite.create();
  (globalThis as any).__rDb = db;
  await db.exec(SCHEMA);
  jar.clear();
  PW ||= await auth.hashPassword("Verdant-Meadow-42");
});

const make = async (username: string, opts: { role?: "user" | "admin"; email?: string | null } = {}) => {
  const email = opts.email === undefined ? `${username}@example.com` : opts.email;
  const r = await db.query<{ id: string }>(
    `insert into users (email, username, password_hash, role, email_verified_at)
     values ($1, $2, $3, $4::user_role, now()) returning id`, [email, username, PW, opts.role ?? "user"]);
  const id = r.rows[0].id;
  await db.query(`insert into profiles (id) values ($1)`, [id]);
  await db.query(`insert into user_preferences (user_id, locale) values ($1, 'en')`, [id]);
  return id;
};
const signInAs = async (id: string) => { jar.clear(); await auth.createSession(id); };
const act = (id: string, body: Record<string, unknown>): Promise<Response> =>
  userRoute.PATCH(new Request("http://app.test/api/admin/users/x", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), { params: { id } });
const signIn = async (identifier: string, password = "Verdant-Meadow-42") => {
  jar.clear();
  const res: Response = await signinRoute.POST(new Request("http://app.test/api/auth/signin", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier, password }),
  }));
  return res.status;
};
const pendingSetup = (id: string) =>
  db.query(`insert into user_invites (user_id, expires_at) values ($1, now() + interval '7 days')`, [id]);

describe("in the app, an Admin's account cannot be taken over", () => {
  it("Reset password is refused for another Admin, for oneself, and for a former Admin — and changes nothing", async () => {
    const boss = await make("boss", { role: "admin" });
    const deputy = await make("deputy", { role: "admin" });
    const former = await make("former", { role: "admin" });
    await signInAs(boss);
    expect((await act(former, { action: "role", role: "user" })).status).toBe(200);
    for (const target of [deputy, boss, former]) {
      const res = await act(target, { action: "reset_password" });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/password — or a former Administrator's — can't be reset here/);
    }
    expect(await signIn("deputy")).toBe(200);                 // the old passwords still work
    expect(await signIn("former")).toBe(200);
  });

  it("Reissue setup link is refused for an Admin (current or former) who never finished setting up", async () => {
    const boss = await make("boss", { role: "admin" });
    const fresh = await make("freshadmin", { role: "admin" });
    const was = await make("wasadmin", { role: "admin" });
    await pendingSetup(fresh);
    await pendingSetup(was);
    await signInAs(boss);
    await act(was, { action: "role", role: "user" });
    for (const target of [fresh, was]) {
      const res = await act(target, { action: "reissue_setup" });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/setup link — or a former Administrator's — can't be reissued here/);
    }
    const live = await db.query<{ n: number }>(`select count(*)::int as n from user_invites where used_at is null and expires_at > now()`);
    expect(live.rows[0].n).toBe(2);                           // the original links untouched
  });

  it("ordinary accounts keep both actions", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const member = await make("member");
    const reset = await act(member, { action: "reset_password" });
    expect(reset.status).toBe(200);
    expect((await reset.json()).temporaryPassword).toEqual(expect.any(String));
    const newcomer = await make("newcomer");
    await pendingSetup(newcomer);
    const reissue = await act(newcomer, { action: "reissue_setup" });
    expect(reissue.status).toBe(200);
    expect((await reissue.json()).setupToken).toEqual(expect.any(String));
  });

  it("an Admin's own Change password still works", async () => {
    const boss = await make("boss", { role: "admin" });
    await signInAs(boss);
    const res: Response = await changeRoute.POST(new Request("http://app.test/api/auth/change-password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current: "Verdant-Meadow-42", next: "Quiet-Harbour-Lantern-7" }),
    }));
    expect(res.status).toBe(200);
    expect(await signIn("boss", "Quiet-Harbour-Lantern-7")).toBe(200);
  });
});

describe("the owner's command-line recovery (npm run admin:password)", () => {
  const client = () => ({ query: (sql: string, params?: unknown[]) => db.query(sql, params as any[]) });

  it("recovers a username-only Admin: temporary password, change owed, every session ended, audited", async () => {
    const claire = await make("claire", { role: "admin", email: null });
    jar.clear(); await auth.createSession(claire);
    const hash = await cli.hashPassword("Temporary-Lantern-91");
    expect(await auth.verifyPassword("Temporary-Lantern-91", hash)).toBe(true);   // the app accepts its hash
    expect(await cli.recoverAccount(client(), "Claire", hash)).toBe("claire");
    const u = (await db.query<any>(`select must_change_password from users where id = $1`, [claire])).rows[0];
    expect(u.must_change_password).toBe(true);
    expect((await db.query<any>(`select count(*)::int as n from sessions where user_id = $1`, [claire])).rows[0].n).toBe(0);
    const a = (await db.query<any>(`select admin_email, action, details from admin_audit_log`)).rows;
    expect(a).toEqual([{ admin_email: "npm run admin:password", action: "password_reset_requested",
      details: { via: "command line", mustChange: true, sessionsEnded: true } }]);
    expect(JSON.stringify(a)).not.toContain("Temporary-Lantern-91");
    expect(await signIn("claire", "Temporary-Lantern-91")).toBe(200);
    expect(await signIn("claire")).toBe(401);                  // the old password is gone
  });

  it("finds an account by email too, and refuses an unknown one without changing anything", async () => {
    const member = await make("member");
    const hash = await cli.hashPassword("Temporary-Lantern-92");
    expect(await cli.recoverAccount(client(), "MEMBER@example.com", hash)).toBe("member");
    expect(await cli.recoverAccount(client(), "nobody", hash)).toBeNull();
    expect((await db.query<any>(`select count(*)::int as n from admin_audit_log`)).rows[0].n).toBe(1);
    void member;
  });
});
