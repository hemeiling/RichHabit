import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Membership administration (UM-3), end to end through the real admin route
 * against PGlite. What must hold: only an admin reaches it; complimentary
 * Advanced is recorded as `gifted`, with an optional expiry the shared
 * entitlement rule honours; an Advanced plan's expiry and note can change
 * without touching its source; revoking returns the account to Free and
 * keeps where the plan came from; admin accounts hold no plan; a
 * grandfathered row changes only with the username typed back AND a reason;
 * every change audits the complete row before and after; and no other
 * account's plan — above all the grandfathered ones — moves.
 */

let db: PGlite;
vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__pDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__pDb as PGlite).transaction(async (tx: any) =>
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
let userRoute: any, auth: any, actorMod: any, ent: any;

beforeAll(async () => {
  userRoute = await import("../src/app/api/admin/users/[id]/route");
  auth = await import("../src/lib/auth");
  actorMod = await import("../src/lib/entitlements/actor");
  ent = await import("../src/lib/entitlements");
});
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db?.close();
  db = await PGlite.create();
  (globalThis as any).__pDb = db;
  await db.exec(SCHEMA);
  jar.clear();
});

const make = async (username: string, role: "user" | "admin" = "user") => {
  const r = await db.query<{ id: string }>(
    `insert into users (email, username, password_hash, role, created_via)
     values ($1, $2, 'scrypt$x$y', $3::user_role, 'admin') returning id`,
    [`${username}@example.com`, username, role]);
  return r.rows[0].id;
};
const signInAs = async (id: string) => { jar.clear(); await auth.createSession(id); };
const plan = (id: string, body: Record<string, unknown>): Promise<Response> =>
  userRoute.PATCH(new Request("http://app.test/api/admin/users/x", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "plan", ...body }),
  }), { params: { id } });
const row = async (id: string) => (await db.query<any>(
  `select plan, source, expires_at, note, granted_by::text as granted_by from user_plans where user_id = $1`, [id])).rows[0];
const audits = async () => (await db.query<any>(
  `select action, target_id::text as target, details from admin_audit_log order by id`)).rows;
const unlimited = async (id: string) =>
  ent.limitFor(await actorMod.getActor(id), "activeHabits") === null;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const grandfather = async (id: string) => db.query(
  `insert into user_plans (user_id, plan, source) values ($1, 'pro', 'grandfathered')`, [id]);

describe("the door", () => {
  it("signed-out and ordinary accounts get 404 and change nothing", async () => {
    const target = await make("member");
    expect((await plan(target, { op: "grant" })).status).toBe(404);
    await signInAs(await make("mallory"));
    expect((await plan(target, { op: "grant" })).status).toBe(404);
    expect(await row(target)).toBeUndefined();
    expect(await audits()).toEqual([]);
  });
});

describe("complimentary Advanced", () => {
  it("grant records gifted, unlocks Advanced at once, and audits before (none) and after", async () => {
    const boss = await make("boss", "admin");
    const member = await make("member");
    await signInAs(boss);
    expect(await unlimited(member)).toBe(false);

    const res = await plan(member, { op: "grant", note: "Early tester" });
    expect(res.status).toBe(200);
    expect(await row(member)).toMatchObject({ plan: "pro", source: "gifted", note: "Early tester", granted_by: boss, expires_at: null });
    expect(await unlimited(member)).toBe(true);           // the very next request sees it

    const [a] = await audits();
    expect(a.action).toBe("plan_granted");
    expect(a.details.before).toBeNull();
    expect(a.details.after).toMatchObject({ plan: "pro", source: "gifted", note: "Early tester" });
  });

  it("an expiry holds through its last day, a past one is refused, and expiry returns the account to Free", async () => {
    await signInAs(await make("boss", "admin"));
    const member = await make("member");
    expect((await plan(member, { op: "grant", expiresOn: day(-1) })).status).toBe(400);
    expect(await row(member)).toBeUndefined();

    expect((await plan(member, { op: "grant", expiresOn: day(0) })).status).toBe(200);
    expect(await unlimited(member)).toBe(true);           // through the end of today

    await db.query(`update user_plans set expires_at = now() - interval '1 minute' where user_id = $1`, [member]);
    expect(await unlimited(member)).toBe(false);          // the shared rule: expired is Free
    expect((await plan(member, { op: "modify", note: "x" })).status).toBe(409);   // nothing to change
    expect((await plan(member, { op: "grant" })).status).toBe(200);               // grant anew
    expect(await unlimited(member)).toBe(true);
  });

  it("modify changes expiry and note and never the source; granting twice is refused", async () => {
    await signInAs(await make("boss", "admin"));
    const member = await make("member");
    await plan(member, { op: "grant", note: "first" });
    expect((await plan(member, { op: "grant" })).status).toBe(409);
    expect((await plan(member, { op: "modify", expiresOn: day(30), note: "renewed" })).status).toBe(200);
    const r = await row(member);
    expect(r).toMatchObject({ plan: "pro", source: "gifted", note: "renewed" });
    expect(new Date(r.expires_at).toISOString().slice(0, 10)).toBe(day(30));
    const changed = (await audits()).at(-1);
    expect(changed.action).toBe("plan_changed");
    expect(changed.details.before.note).toBe("first");
    expect(changed.details.after.note).toBe("renewed");
  });

  it("revoke returns the account to Free and keeps where the plan came from", async () => {
    await signInAs(await make("boss", "admin"));
    const member = await make("member");
    await plan(member, { op: "grant" });
    expect((await plan(member, { op: "revoke" })).status).toBe(200);
    expect(await row(member)).toMatchObject({ plan: "free", source: "gifted" });
    expect(await unlimited(member)).toBe(false);
    expect((await plan(member, { op: "revoke" })).status).toBe(409);   // already Free
    const revoked = (await audits()).at(-1);
    expect(revoked.action).toBe("plan_revoked");
    expect(revoked.details.before.plan).toBe("pro");
    expect(revoked.details.after.plan).toBe("free");
  });
});

describe("protections", () => {
  it("admin accounts hold no plan: refused, nothing written", async () => {
    const boss = await make("boss", "admin");
    const colleague = await make("colleague", "admin");
    await signInAs(boss);
    expect((await plan(colleague, { op: "grant" })).status).toBe(409);
    expect(await row(colleague)).toBeUndefined();
    expect(await audits()).toEqual([]);
    expect((await plan(randomUUID(), { op: "grant" })).status).toBe(404);
  });

  it("a grandfathered plan changes only with the username typed back and a reason, both recorded", async () => {
    await signInAs(await make("boss", "admin"));
    const early = await make("pioneer");
    await grandfather(early);
    const untouched = async () => expect(await row(early)).toMatchObject({ plan: "pro", source: "grandfathered", expires_at: null });

    expect((await plan(early, { op: "modify", note: "x", reason: "tidy" })).status).toBe(409);            // no confirmation
    await untouched();
    expect((await plan(early, { op: "revoke", confirm: "someone-else", reason: "tidy" })).status).toBe(409); // wrong name
    await untouched();
    expect((await plan(early, { op: "revoke", confirm: "pioneer" })).status).toBe(400);                    // no reason
    await untouched();
    expect((await plan(early, { op: "grant", confirm: "pioneer", reason: "x" })).status).toBe(409);        // already Advanced
    await untouched();
    expect(await audits()).toEqual([]);

    expect((await plan(early, { op: "modify", note: "Founding member", confirm: "PIONEER", reason: "Annotating" })).status).toBe(200);
    expect(await row(early)).toMatchObject({ plan: "pro", source: "grandfathered", note: "Founding member", expires_at: null });
    const a = (await audits()).at(-1);
    expect(a.details.reason).toBe("Annotating");
    expect(a.details.before.source).toBe("grandfathered");
  });

  it("changing one account's plan leaves every other plan — the grandfathered ones above all — byte-identical", async () => {
    await signInAs(await make("boss", "admin"));
    const pioneers = [await make("p1"), await make("p2"), await make("p3")];
    for (const p of pioneers) await grandfather(p);
    const before = (await db.query<any>(`select md5(string_agg(up::text, '|' order by user_id)) as h from user_plans up`)).rows[0].h;
    const member = await make("member");
    await plan(member, { op: "grant" });
    await plan(member, { op: "modify", note: "n" });
    await plan(member, { op: "revoke" });
    const after = (await db.query<any>(
      `select md5(string_agg(up::text, '|' order by user_id)) as h from user_plans up where user_id <> $1`, [member])).rows[0].h;
    expect(after).toBe(before);
  });
});
