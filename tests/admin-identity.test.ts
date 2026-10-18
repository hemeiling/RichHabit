import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Admin username and email editing (UM-5), end to end through the real routes
 * against PGlite. What must hold: only an admin can do it; usernames and
 * addresses are checked and must be free; an email change clears the
 * verified mark, spends every outstanding reset and verification link and any
 * pending Google link handshake, sends a confirmation to the new address and
 * a notice to the old one, and audits both addresses MASKED; password
 * sign-in pauses until the new address is confirmed for accounts that
 * registered under verification — and resumes once it is; a linked Google
 * identity keeps signing in to the same account; an unlinked Google account
 * that uses the new (or old) address is never linked automatically; and no
 * habit, priority or other record moves.
 */

let db: PGlite;
vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__iDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__iDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows)),
}));
const sent: { to: string; subject: string; text: string }[] = [];
/** Set to an address to make the mail provider fail for it once. */
let failFor: string | null = null;
vi.mock("@/lib/email/send", () => ({
  sendMail: async (m: any) => {
    if (failFor && m.to === failFor) { failFor = null; throw new Error("provider down"); }
    sent.push(m);
  },
}));
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
let userRoute: any, signinRoute: any, auth: any, verify: any, google: any, together: any;

beforeAll(async () => {
  together = await import("../src/lib/together/access");
  userRoute = await import("../src/app/api/admin/users/[id]/route");
  signinRoute = await import("../src/app/api/auth/signin/route");
  auth = await import("../src/lib/auth");
  verify = await import("../src/lib/email/verify");
  google = await import("../src/lib/auth/googleAccount");
});
afterAll(async () => { await db?.close(); });
let PW = "";
beforeEach(async () => {
  await db?.close();
  db = await PGlite.create();
  (globalThis as any).__iDb = db;
  await db.exec(SCHEMA);
  jar.clear();
  sent.length = 0;
  failFor = null;
  PW ||= await auth.hashPassword("Verdant-Meadow-42");
});

const make = async (username: string, opts: { role?: "user" | "admin"; vr?: boolean; verified?: boolean } = {}) => {
  const r = await db.query<{ id: string }>(
    `insert into users (email, username, password_hash, role, created_via, verification_required, email_verified_at)
     values ($1, $2, $3, $4::user_role, 'self_signup', $5, $6) returning id`,
    [`${username}@example.com`, username, PW, opts.role ?? "user", opts.vr ?? false, opts.verified === false ? null : new Date()]);
  const id = r.rows[0].id;
  await db.query(`insert into profiles (id) values ($1)`, [id]);
  await db.query(`insert into user_preferences (user_id, locale) values ($1, 'en')`, [id]);
  return id;
};
const signInAs = async (id: string) => { jar.clear(); await auth.createSession(id); };
const edit = (id: string, body: Record<string, unknown>): Promise<Response> =>
  userRoute.PATCH(new Request("http://app.test/api/admin/users/x", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "identity", ...body }),
  }), { params: { id } });
const signIn = async (identifier: string) => {
  jar.clear();
  const res: Response = await signinRoute.POST(new Request("http://app.test/api/auth/signin", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password: "Verdant-Meadow-42" }),
  }));
  return res.status;
};
const user = async (id: string) => (await db.query<any>(
  `select username, email, email_verified_at from users where id = $1`, [id])).rows[0];

describe("the door", () => {
  it("anyone who is not an admin gets 404 and nothing changes", async () => {
    const target = await make("target");
    expect((await edit(target, { username: "renamed" })).status).toBe(404);
    await signInAs(await make("mallory"));
    expect((await edit(target, { email: "evil@example.com" })).status).toBe(404);
    expect((await user(target)).username).toBe("target");
  });
});

describe("usernames", () => {
  it("renames with the house rules, refuses a taken or malformed one, and audits from → to", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("oldname");
    await make("taken");
    expect((await edit(target, { username: "taken" })).status).toBe(409);
    expect((await edit(target, { username: "x" })).status).toBe(400);
    expect((await edit(target, { username: "bad name!" })).status).toBe(400);
    expect((await edit(target, { username: "NewName" })).status).toBe(200);
    expect((await user(target)).username).toBe("newname");
    expect(await signIn("newname")).toBe(200);
    expect(await signIn("oldname")).toBe(401);
    const a = (await db.query<any>(`select action, details from admin_audit_log order by id`)).rows;
    expect(a).toEqual([{ action: "user_username_changed", details: { from: "oldname", to: "newname" } }]);
    expect(sent).toEqual([]);                             // a rename sends no mail
  });
});

describe("email changes", () => {
  it("clears verification, spends old links and handshakes, mails both addresses, and audits masked", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("mover", { vr: true });
    await db.query(`insert into password_resets (user_id, token_hash, expires_at) values ($1, 'r', now() + interval '1 hour')`, [target]);
    await db.query(`insert into email_verifications (user_id, token_hash, email, expires_at) values ($1, 'v', 'mover@example.com', now() + interval '1 hour')`, [target]);
    await db.query(`insert into google_pending (token_hash, purpose, provider_user_id, email_normalized, email_verified, user_id, expires_at)
                    values (repeat('a', 64), 'link', 'g-old', 'mover@example.com', true, $1, now() + interval '10 minutes')`, [target]);

    const res = await edit(target, { email: "Mover.New@Example.com" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ email: "mover.new@example.com", emailChanged: true, signInPaused: true, confirmationSent: true });

    const u = await user(target);
    expect(u.email).toBe("mover.new@example.com");
    expect(u.email_verified_at).toBeNull();
    const open = async (t: string) => (await db.query<any>(`select count(*)::int as n from ${t} where user_id = $1 and consumed_at is null`, [target])).rows[0].n;
    // Only the confirmation just sent to the NEW address remains live.
    expect(await open("password_resets")).toBe(0);
    const liveVerifications = (await db.query<any>(`select email from email_verifications where user_id = $1 and consumed_at is null`, [target])).rows;
    expect(liveVerifications).toEqual([{ email: "mover.new@example.com" }]);
    expect((await db.query<any>(`select count(*)::int as n from google_pending where user_id = $1`, [target])).rows[0].n).toBe(0);

    expect(sent.map((m) => m.to).sort()).toEqual(["mover.new@example.com", "mover@example.com"]);
    const notice = sent.find((m) => m.to === "mover@example.com")!;
    expect(notice.subject).toMatch(/sign-in email was changed/);
    // The old inbox may no longer be theirs: it learns nothing of the new address, and gets no link.
    expect(notice.text).not.toMatch(/mover\.new|mo••••ew|@example\.com/);
    expect(notice.text).not.toMatch(/token=|https?:/);

    const a = (await db.query<any>(`select details from admin_audit_log where action = 'user_email_changed'`)).rows[0];
    expect(a.details).toEqual({ from: "m••••@example.com", to: "mo••••ew@example.com", verificationCleared: true });   // "mover" is short: one character shown
    expect(JSON.stringify(a.details)).not.toContain("mover@example.com");
  });

  it("pauses password sign-in until the new address is confirmed, then lets them back in", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("strict", { vr: true });
    expect(await signIn("strict")).toBe(200);
    await signInAs((await db.query<any>(`select id from users where username = 'boss'`)).rows[0].id);
    await edit(target, { email: "strict.new@example.com" });
    expect(await signIn("strict")).toBe(403);               // awaiting verification
    const mail = sent.find((m) => m.to === "strict.new@example.com")!;
    const token = decodeURIComponent(mail.text.match(/#token=([^\s"<]+)/)![1]);
    expect((await verify.redeem(token)).status).toBe("ok");
    expect(await signIn("strict")).toBe(200);
    expect(await signIn("strict.new@example.com")).toBe(200);
  });

  it("an account from before verification keeps signing in — and is still asked to confirm", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("legacy", { vr: false });
    const body = await (await edit(target, { email: "legacy.new@example.com" })).json();
    expect(body.signInPaused).toBe(false);
    expect(await signIn("legacy")).toBe(200);
    expect(sent.some((m) => m.to === "legacy.new@example.com")).toBe(true);
  });

  it("refuses a malformed address, or one another account uses, and changes nothing", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("stay");
    await make("other");
    expect((await edit(target, { email: "not-an-address" })).status).toBe(400);
    expect((await edit(target, { email: "OTHER@example.com" })).status).toBe(409);
    expect((await edit(target, { email: "stay@example.com" })).status).toBe(400);   // nothing to change
    expect((await user(target)).email).toBe("stay@example.com");
    expect(sent).toEqual([]);
  });
});

describe("hardening from the security review", () => {
  const sha = (t: string) => createHash("sha256").update(t).digest("hex");
  const bossId = async () => (await db.query<any>(`select id from users where username = 'boss'`)).rows[0].id;

  it("an Admin cannot change their own email here (another Admin can); renaming themselves is fine", async () => {
    const boss = await make("boss", { role: "admin" });
    await signInAs(boss);
    const res = await edit(boss, { email: "boss.typo@example.com" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/can't change their own email/);
    expect((await user(boss)).email).toBe("boss@example.com");
    expect((await edit(boss, { username: "bossy" })).status).toBe(200);
    const deputy = await make("deputy", { role: "admin" });
    await signInAs(deputy);
    expect((await edit(boss, { email: "boss.new@example.com" })).status).toBe(200);
  });

  it("expires the account's unused setup links with the old address", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("invited");
    await db.query(`insert into user_invites (user_id, expires_at) values ($1, now() + interval '7 days')`, [target]);
    await edit(target, { email: "invited.new@example.com" });
    const [{ live }] = (await db.query<any>(`select count(*)::int as live from user_invites
      where user_id = $1 and used_at is null and expires_at > now()`, [target])).rows;
    expect(live).toBe(0);
  });

  it("never stores a full address in the audit row, even for an account without a username", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const r = await db.query<{ id: string }>(`insert into users (email, password_hash) values ('nameless@example.com', $1) returning id`, [PW]);
    await db.query(`insert into profiles (id) values ($1)`, [r.rows[0].id]);
    expect((await edit(r.rows[0].id, { email: "nameless.new@example.com" })).status).toBe(200);
    const row = (await db.query<any>(`select target_email, details from admin_audit_log where action = 'user_email_changed'`)).rows[0];
    expect(row.target_email).toBe("na••••ss@example.com");
    expect(JSON.stringify(row)).not.toContain("nameless@example.com");
    expect(JSON.stringify(row)).not.toContain("nameless.new@example.com");
  });

  it("Together does not treat an Admin-set address as proved until the person confirms it", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    // Admin-created and never asked to verify: the grandfathered arm trusts its address.
    const r = await db.query<{ id: string }>(`insert into users (email, username, password_hash, created_via)
      values ('vouched@example.com', 'vouched', $1, 'admin') returning id`, [PW]);
    const id = r.rows[0].id;
    await db.query(`insert into profiles (id) values ($1)`, [id]);
    await db.query(`insert into user_preferences (user_id, locale) values ($1, 'en')`, [id]);
    const addressed = async (to: string) => (await db.query<any>(
      // `is true`: a WHERE clause treats NULL (no named invitee) as not matching, the same as false.
      `with i as (select null::uuid as invitee_id, $2::text as email_normalized) select (${together.addressedTo("$1")}) is true as ok from i`,
      [id, to])).rows[0].ok;
    expect(await addressed("vouched@example.com")).toBe(true);
    await edit(id, { email: "victim@example.com" });
    expect(await addressed("victim@example.com")).toBe(false);   // nobody has shown they read that inbox
    const mail = sent.find((m) => m.to === "victim@example.com")!;
    const token = decodeURIComponent(mail.text.match(/#token=([^\s"<]+)/)![1]);
    expect((await verify.redeem(token)).status).toBe("ok");
    expect(await addressed("victim@example.com")).toBe(true);     // proved now
  });

  it("a confirmation link sent to a PREVIOUS address never verifies the new one", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("raced", { vr: false, verified: false });
    await edit(target, { email: "raced.new@example.com" });
    // A link minted for the old address a moment after the change (the race the review traced).
    await db.query(`insert into email_verifications (user_id, token_hash, email, expires_at)
                    values ($1, $2, 'raced@example.com', now() + interval '1 hour')`, [target, sha("stale-link")]);
    expect((await verify.redeem("stale-link")).status).toBe("invalid");
    expect((await user(target)).email_verified_at).toBeNull();
  });

  it("says so when the confirmation email could not be sent", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("unlucky");
    failFor = "unlucky.new@example.com";
    const body = await (await edit(target, { email: "unlucky.new@example.com" })).json();
    expect(body).toMatchObject({ emailChanged: true, confirmationSent: false });
    expect((await user(target)).email).toBe("unlucky.new@example.com");   // the change itself stands
    void bossId;
  });

  it("refuses addresses with whitespace or control characters (a NUL used to be a 500)", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("clean");
    for (const bad of ["a\tb@example.com", "a\nb@example.com", "ab@exa\u0000mple.com", "a b@example.com"]) {
      expect((await edit(target, { email: bad })).status).toBe(400);
    }
    expect((await user(target)).email).toBe("clean@example.com");
  });
});

describe("Google stays safe", () => {
  it("a linked Google identity still lands in the same account; an unlinked Google account is never linked by address", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("dual");
    await db.query(`insert into auth_identities (user_id, provider, provider_user_id) values ($1, 'google', 'g-dual')`, [target]);
    await edit(target, { email: "dual.new@example.com" });

    const linked = await google.gateGoogleIdentity({ sub: "g-dual", email: "anything@gmail.com", emailVerified: true });
    expect(linked).toMatchObject({ kind: "signin", userId: target });

    // A different Google account using the NEW address: offered the password-confirmed
    // link step for this account, never a session.
    const stranger = await google.gateGoogleIdentity({ sub: "g-stranger", email: "dual.new@example.com", emailVerified: true });
    expect(stranger.kind).toBe("link");
    // And one using the OLD address now matches no account at all.
    const oldAddress = await google.gateGoogleIdentity({ sub: "g-old-owner", email: "dual@example.com", emailVerified: true });
    expect(oldAddress.kind).toBe("signup");
    expect((await db.query<any>(`select count(*)::int as n from auth_identities`)).rows[0].n).toBe(1);
  });
});

describe("nothing the person built moves", () => {
  it("habits, priorities, plan and sessions are untouched by a rename and an email change", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("builder");
    await db.query(`insert into habits (user_id, name, category, kind) values ($1, 'Stretch', 'morning', 'good')`, [target]);
    await db.query(`insert into priorities (user_id, body, category, created_on) values ($1, 'Ship it', 'urgent_important', current_date)`, [target]);
    await db.query(`insert into user_plans (user_id, plan, source) values ($1, 'pro', 'gifted')`, [target]);
    jar.clear(); await auth.createSession(target); const theirSession = jar.get([...jar.keys()][0]);
    await signInAs((await db.query<any>(`select id from users where username = 'boss'`)).rows[0].id);
    const snap = async () => (await db.query<any>(`select
      (select md5(string_agg(h::text, '|')) from habits h where user_id = $1) h,
      (select md5(string_agg(p::text, '|')) from priorities p where user_id = $1) p,
      (select md5(string_agg(up::text, '|')) from user_plans up where user_id = $1) pl,
      (select count(*)::int from sessions where user_id = $1) s`, [target])).rows[0];
    const before = await snap();
    await edit(target, { username: "builder2", email: "builder2@example.com" });
    expect(await snap()).toEqual(before);
    expect(theirSession).toBeTruthy();
  });
});
