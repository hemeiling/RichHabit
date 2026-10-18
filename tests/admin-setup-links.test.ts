import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reissuing setup links (UM-4), end to end through the real admin route and
 * the real setup redemption route against PGlite. What must hold: only an
 * admin can reissue; only for an account that was invited and never finished
 * setting up (not disabled); the replacement is returned once and expires;
 * every earlier link stops working the moment it is issued; the new link works
 * exactly once and an expired one never; the audit entry and every log line
 * are free of tokens.
 */

let db: PGlite;
vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__sDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__sDb as PGlite).transaction(async (tx: any) =>
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
let usersRoute: any, userRoute: any, setupRoute: any, auth: any;
const logged: string[] = [];

beforeAll(async () => {
  usersRoute = await import("../src/app/api/admin/users/route");
  userRoute = await import("../src/app/api/admin/users/[id]/route");
  setupRoute = await import("../src/app/api/auth/setup/route");
  auth = await import("../src/lib/auth");
});
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db?.close();
  db = await PGlite.create();
  (globalThis as any).__sDb = db;
  await db.exec(SCHEMA);
  jar.clear();
  logged.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); });
  }
});
afterEach(() => { vi.restoreAllMocks(); });

const post = (url: string, body: unknown) => new Request(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const reissue = (id: string): Promise<Response> =>
  userRoute.PATCH(new Request("http://app.test/api/admin/users/x", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reissue_setup" }),
  }), { params: { id } });
const redeem = async (token: string) => {
  const res: Response = await setupRoute.POST(post("http://app.test/api/auth/setup", { token, password: "Verdant-Meadow-42" }));
  return res.status;
};
const makeAdmin = async () => {
  const hash = await auth.hashPassword("Verdant-Meadow-42");
  const r = await db.query<{ id: string }>(
    `insert into users (email, username, password_hash, role, created_via)
     values ('boss@example.com', 'boss', $1, 'admin', 'admin') returning id`, [hash]);
  return r.rows[0].id;
};
const signInAs = async (id: string) => { jar.clear(); await auth.createSession(id); };
/** An account created the way an admin does it, with a setup link. */
const invite = async (username: string) => {
  const res: Response = await usersRoute.POST(post("http://app.test/api/admin/users",
    { username, credential: "invite", seedHabits: false }));
  const body = await res.json();
  return { id: body.id as string, token: body.setupToken as string };
};

describe("reissuing", () => {
  it("expires every earlier link at once; the new link works exactly once; nothing secret is logged or audited", async () => {
    const boss = await makeAdmin();
    await signInAs(boss);
    const { id, token: first } = await invite("newcomer");

    const res = await reissue(id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.setupToken).toBeTruthy();
    expect(body.setupToken).not.toBe(first);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    expect(await redeem(first)).toBe(400);              // the earlier link died
    expect(await redeem(body.setupToken)).toBe(200);    // the new one works…
    expect(await redeem(body.setupToken)).toBe(400);    // …once

    await signInAs(boss);
    const audits = (await db.query<any>(`select action, details from admin_audit_log order by id`)).rows;
    expect(audits.map((a) => a.action)).toEqual(["user_created", "setup_link_reissued"]);
    expect(audits[1].details.replaced).toBe(1);
    const everything = JSON.stringify(audits) + logged.join("\n");
    expect(everything).not.toContain(first);
    expect(everything).not.toContain(body.setupToken);
  });

  it("issuing twice leaves only the newest link alive", async () => {
    await signInAs(await makeAdmin());
    const { id } = await invite("twice");
    const a = (await (await reissue(id)).json()).setupToken;
    const b = (await (await reissue(id)).json()).setupToken;
    expect(await redeem(a)).toBe(400);
    expect(await redeem(b)).toBe(200);
  });

  it("an expired link never works, reissued or not", async () => {
    await signInAs(await makeAdmin());
    const { id, token } = await invite("late");
    await db.query(`update user_invites set expires_at = now() - interval '1 minute' where user_id = $1`, [id]);
    expect(await redeem(token)).toBe(400);
    const fresh = (await (await reissue(id)).json()).setupToken;
    await db.query(`update user_invites set expires_at = now() - interval '1 minute' where token = $1`, [fresh]);
    expect(await redeem(fresh)).toBe(400);
  });
});

describe("who can, and for whom", () => {
  it("is refused for an account that already set up, one made with a password, and a disabled one", async () => {
    await signInAs(await makeAdmin());
    const done = await invite("finished");
    expect(await redeem(done.token)).toBe(200);
    await signInAs((await db.query<any>(`select id from users where username = 'boss'`)).rows[0].id);
    expect((await reissue(done.id)).status).toBe(409);

    const pw: Response = await usersRoute.POST(post("http://app.test/api/admin/users",
      { username: "haspassword", credential: "temporary", seedHabits: false }));
    expect((await reissue((await pw.json()).id)).status).toBe(409);

    const off = await invite("switchedoff");
    await db.query(`update users set disabled_at = now() where id = $1`, [off.id]);
    expect((await reissue(off.id)).status).toBe(409);
    expect(await redeem(off.token)).toBe(400);          // and its old link stays useless
  });

  it("anyone who is not an admin gets 404, and nothing is issued", async () => {
    await signInAs(await makeAdmin());
    const { id } = await invite("target");
    jar.clear();
    expect((await reissue(id)).status).toBe(404);
    const count = (await db.query<any>(`select count(*)::int as n from user_invites where user_id = $1`, [id])).rows[0].n;
    expect(count).toBe(1);
  });
});
