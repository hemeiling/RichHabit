import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Admin username and email editing (UM-5), end to end through the real routes
 * against PGlite. What must hold: only an admin can do it; usernames and
 * addresses are checked and must be free; an email change is a REQUEST that
 * takes effect only when the new address is confirmed — until then the
 * account keeps its address, its sign-in, its sessions and its place under
 * the cap, however full the cap becomes; the request spends every outstanding
 * reset, verification and setup link and any pending Google link handshake,
 * sends a change confirmation to the new address and a link-free notice to
 * the current one, and is audited MASKED (as is the confirmation, attributed
 * to the requesting Admin); an Admin's email — or a former Admin's — cannot
 * be changed at all; a request can be cancelled, is superseded by a newer
 * one, and fails cleanly if another account takes the address first; a link
 * for an old address never moves the account back; a linked Google identity
 * keeps signing in to the same account; and no habit, priority or other
 * record moves.
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
let userRoute: any, signinRoute: any, auth: any, verify: any, google: any, together: any, capacity: any, admin: any;

beforeAll(async () => {
  together = await import("../src/lib/together/access");
  userRoute = await import("../src/app/api/admin/users/[id]/route");
  signinRoute = await import("../src/app/api/auth/signin/route");
  auth = await import("../src/lib/auth");
  verify = await import("../src/lib/email/verify");
  google = await import("../src/lib/auth/googleAccount");
  capacity = await import("../src/lib/db/capacity");
  admin = await import("../src/lib/admin/users");
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
const LIMIT = process.env.EARLY_ACCESS_USER_LIMIT;
afterEach(() => {
  if (LIMIT === undefined) delete process.env.EARLY_ACCESS_USER_LIMIT;
  else process.env.EARLY_ACCESS_USER_LIMIT = LIMIT;
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
const idOf = async (username: string) => (await db.query<any>(`select id from users where username = $1`, [username])).rows[0].id;
const signInAs = async (id: string) => { jar.clear(); await auth.createSession(id); };
const patch = (id: string, body: Record<string, unknown>): Promise<Response> =>
  userRoute.PATCH(new Request("http://app.test/api/admin/users/x", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), { params: { id } });
const edit = (id: string, body: Record<string, unknown>) => patch(id, { action: "identity", ...body });
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
/** The token from the newest mail to `to`. */
const linkFor = (to: string) => {
  const mail = [...sent].reverse().find((m) => m.to === to)!;
  return decodeURIComponent(mail.text.match(/#token=([^\s"<&]+)/)![1]);
};
const audit = async () => (await db.query<any>(
  `select action, admin_email, target_email, details from admin_audit_log order by id`)).rows;

describe("the door", () => {
  it("anyone who is not an admin gets 404 and nothing changes", async () => {
    const target = await make("target");
    expect((await edit(target, { username: "renamed" })).status).toBe(404);
    await signInAs(await make("mallory"));
    expect((await edit(target, { email: "evil@example.com" })).status).toBe(404);
    expect((await patch(target, { action: "cancel_email_change" })).status).toBe(404);
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

  it("an Admin's username can still be corrected — only the email is protected", async () => {
    const boss = await make("boss", { role: "admin" });
    await signInAs(boss);
    expect((await edit(boss, { username: "bossy" })).status).toBe(200);
    expect((await edit(await make("deputy", { role: "admin" }), { username: "deputy2" })).status).toBe(200);
  });
});

describe("an email change is a request, confirmed from the new inbox", () => {
  it("changes nothing yet, spends old links and handshakes, mails both addresses, and audits masked", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("mover", { vr: true });
    const before = await user(target);
    await db.query(`insert into password_resets (user_id, token_hash, expires_at) values ($1, 'r', now() + interval '1 hour')`, [target]);
    await db.query(`insert into email_verifications (user_id, token_hash, email, expires_at) values ($1, 'v', 'mover@example.com', now() + interval '1 hour')`, [target]);
    await db.query(`insert into user_invites (user_id, expires_at) values ($1, now() + interval '7 days')`, [target]);
    await db.query(`insert into google_pending (token_hash, purpose, provider_user_id, email_normalized, email_verified, user_id, expires_at)
                    values (repeat('a', 64), 'link', 'g-old', 'mover@example.com', true, $1, now() + interval '10 minutes')`, [target]);

    const res = await edit(target, { email: "Mover.New@Example.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      email: "mover@example.com", emailChangeRequested: true, pendingEmail: "mover.new@example.com", confirmationSent: true,
    });

    // The account itself is exactly as it was: address, verified mark.
    expect(await user(target)).toEqual(before);
    const count = async (sql: string) => (await db.query<any>(sql, [target])).rows[0].n;
    expect(await count(`select count(*)::int as n from password_resets where user_id = $1 and consumed_at is null`)).toBe(0);
    expect(await count(`select count(*)::int as n from user_invites where user_id = $1 and used_at is null and expires_at > now()`)).toBe(0);
    expect(await count(`select count(*)::int as n from google_pending where user_id = $1`)).toBe(0);
    // Only the change link to the NEW address remains live.
    const live = (await db.query<any>(`select email, starts_with(token_hash, 'change:') as change
      from email_verifications where user_id = $1 and consumed_at is null`, [target])).rows;
    expect(live).toEqual([{ email: "mover.new@example.com", change: true }]);

    expect(sent.map((m) => m.to).sort()).toEqual(["mover.new@example.com", "mover@example.com"]);
    const confirmation = sent.find((m) => m.to === "mover.new@example.com")!;
    expect(confirmation.subject).toMatch(/new sign-in email/);
    expect(confirmation.text).toMatch(/\/verify#token=[^\s]+&for=change/);
    const notice = sent.find((m) => m.to === "mover@example.com")!;
    expect(notice.subject).toMatch(/change to your RichHabit sign-in email was requested/);
    // The current inbox may no longer be theirs: it learns nothing of the new address, and gets no link.
    expect(notice.text).not.toMatch(/mover\.new|mo••••ew|@example\.com/);
    expect(notice.text).not.toMatch(/token=|https?:/);

    expect(await audit()).toEqual([{
      action: "user_email_change_requested", admin_email: "boss@example.com", target_email: "mover",
      details: { from: "m••••@example.com", to: "mo••••ew@example.com" },   // "mover" is short: one character shown
    }]);
    expect((await admin.identityFor(target)).pendingEmail.email).toBe("mover.new@example.com");
  });

  it("they keep signing in — sessions too — until the link is used; then the new address is theirs", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("strict", { vr: true });
    jar.clear(); await auth.createSession(target); const theirs = [...jar.entries()][0];
    await signInAs(await idOf("boss"));
    await edit(target, { email: "strict.new@example.com" });

    expect(await signIn("strict")).toBe(200);                       // username
    expect(await signIn("strict@example.com")).toBe(200);           // the address still in force
    expect(await signIn("strict.new@example.com")).toBe(401);       // not theirs yet
    jar.clear(); jar.set(theirs[0], theirs[1]);
    expect((await auth.getSessionUser())?.id).toBe(target);         // their open session carries on

    const outcome = await verify.redeem(linkFor("strict.new@example.com"));
    expect(outcome).toEqual({ status: "ok", email: "strict.new@example.com", changed: true });
    const u = await user(target);
    expect(u.email).toBe("strict.new@example.com");
    expect(u.email_verified_at).not.toBeNull();                     // proved by using the link
    expect(await signIn("strict.new@example.com")).toBe(200);
    expect(await signIn("strict@example.com")).toBe(401);
    expect(await signIn("strict")).toBe(200);
    expect((await verify.redeem(linkFor("strict.new@example.com"))).status).toBe("already");
    expect((await admin.identityFor(target)).pendingEmail).toBeNull();

    // The confirmation is audited as the requesting Admin's change, masked like the request.
    const changed = (await audit()).find((a: any) => a.action === "user_email_changed");
    expect(changed).toEqual({
      action: "user_email_changed", admin_email: "boss@example.com", target_email: "strict",
      details: { from: "st••••ct@example.com", to: "st••••ew@example.com", confirmedByNewAddress: true },
    });
  });

  it("an account from before verification behaves the same, and is verified by the link", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("legacy", { vr: false, verified: false });
    await edit(target, { email: "legacy.new@example.com" });
    expect(await signIn("legacy@example.com")).toBe(200);
    expect((await verify.redeem(linkFor("legacy.new@example.com"))).status).toBe("ok");
    expect(await user(target)).toMatchObject({ email: "legacy.new@example.com" });
    expect((await user(target)).email_verified_at).not.toBeNull();
  });

  it("refuses a malformed address, or one another account uses, and changes nothing", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("stay");
    await make("other");
    expect((await edit(target, { email: "not-an-address" })).status).toBe(400);
    const taken = await edit(target, { email: "OTHER@example.com" });
    expect(taken.status).toBe(409);
    expect((await taken.json()).error).toMatch(/Another account already uses/);
    expect((await edit(target, { email: "stay@example.com" })).status).toBe(400);   // nothing to change
    expect((await user(target)).email).toBe("stay@example.com");
    expect(sent).toEqual([]);
    expect(await audit()).toEqual([]);
  });

  it("can be cancelled: the link stops working and the account carries on as it was", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("wavering");
    await edit(target, { email: "wavering.new@example.com" });
    const token = linkFor("wavering.new@example.com");
    expect((await patch(target, { action: "cancel_email_change" })).status).toBe(200);
    expect((await verify.redeem(token)).status).toBe("invalid");
    expect((await user(target)).email).toBe("wavering@example.com");
    expect((await patch(target, { action: "cancel_email_change" })).status).toBe(409);   // nothing waiting
    expect((await audit()).map((a: any) => a.action)).toEqual(["user_email_change_requested", "user_email_change_cancelled"]);
    expect(JSON.stringify(await audit())).not.toContain("wavering.new@example.com");
  });

  it("a newer request supersedes an older one", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("typo");
    await edit(target, { email: "tpyo@example.com" });
    const first = linkFor("tpyo@example.com");
    await edit(target, { email: "typo.fixed@example.com" });
    expect((await verify.redeem(first)).status).toBe("invalid");
    expect((await verify.redeem(linkFor("typo.fixed@example.com"))).status).toBe("ok");
    expect((await user(target)).email).toBe("typo.fixed@example.com");
  });

  it("if another account takes the address first, confirming says so and changes nothing", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("slow");
    await edit(target, { email: "popular@example.com" });
    await make("popular");                                          // signs up with it meanwhile
    expect((await verify.redeem(linkFor("popular@example.com"))).status).toBe("taken");
    expect((await user(target)).email).toBe("slow@example.com");
  });
});

describe("(A) the place under the cap is kept while the new address waits", () => {
  it("a full cap never costs an existing account its access, however many people sign up in between", async () => {
    process.env.EARLY_ACCESS_USER_LIMIT = "2";
    await signInAs(await make("boss", { role: "admin" }));          // Admins take no place
    const alice = await make("alice", { vr: true });
    await make("bob", { vr: true });
    expect(await capacity.currentCapacity()).toMatchObject({ used: 2, limit: 2, full: true });

    await edit(alice, { email: "alice.new@example.com" });
    // Alice still holds her place while the link waits — the count does not drop…
    expect(await capacity.currentCapacity()).toMatchObject({ used: 2, full: true });
    expect(await signIn("alice")).toBe(200);
    // …so a newcomer cannot take it: their own confirmation is told the programme is full.
    const newcomer = await make("newcomer", { vr: true, verified: false });
    await verify.sendVerification(newcomer, "newcomer@example.com", "en");
    expect((await verify.redeem(linkFor("newcomer@example.com"))).status).toBe("full");

    // Confirming Alice's change asks for no room: it succeeds at a full cap.
    expect((await verify.redeem(linkFor("alice.new@example.com"))).status).toBe("ok");
    expect(await capacity.currentCapacity()).toMatchObject({ used: 2, full: true });
    expect(await signIn("alice.new@example.com")).toBe(200);
  });

  it("an account that never held a place still needs one when it confirms — exactly as at sign-up", async () => {
    process.env.EARLY_ACCESS_USER_LIMIT = "1";
    await signInAs(await make("boss", { role: "admin" }));
    await make("holder", { vr: true });                             // the one place
    const pending = await make("pending", { vr: true, verified: false });   // registered, never confirmed
    await edit(pending, { email: "pending.fixed@example.com" });
    const token = linkFor("pending.fixed@example.com");
    expect((await verify.redeem(token)).status).toBe("full");       // and the link stays valid…
    expect((await user(pending)).email).toBe("pending@example.com");
    process.env.EARLY_ACCESS_USER_LIMIT = "2";                      // …so when a place opens, it works
    expect((await verify.redeem(token)).status).toBe("ok");
    expect((await user(pending)).email).toBe("pending.fixed@example.com");
  });
});

describe("(B) an Admin's email cannot be redirected", () => {
  it("refuses another Admin's email — and the acting Admin's own — and changes nothing", async () => {
    const boss = await make("boss", { role: "admin" });
    const deputy = await make("deputy", { role: "admin" });
    await signInAs(deputy);
    for (const target of [boss, deputy]) {
      const res = await edit(target, { email: "attacker@example.com" });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/Administrator's email — or a former Administrator's — can't be changed here/);
    }
    expect((await user(boss)).email).toBe("boss@example.com");
    expect(sent).toEqual([]);
    expect(await audit()).toEqual([]);
    expect((await db.query<any>(`select count(*)::int as n from email_verifications`)).rows[0].n).toBe(0);
    expect((await admin.identityFor(boss)).emailProtected).toBe(true);
  });

  it("demoting an Admin first does not step around it", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const deputy = await make("deputy", { role: "admin" });
    expect((await patch(deputy, { action: "role", role: "user" })).status).toBe(200);
    const res = await edit(deputy, { email: "attacker@example.com" });
    expect(res.status).toBe(409);
    expect((await user(deputy)).email).toBe("deputy@example.com");
    expect((await admin.identityFor(deputy)).emailProtected).toBe(true);
    expect((await admin.identityFor(await make("ordinary"))).emailProtected).toBe(false);
  });

  it("an account promoted while a change waits is protected too: the link is refused and spent", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const rising = await make("rising");
    await edit(rising, { email: "rising.elsewhere@example.com" });
    expect((await patch(rising, { action: "role", role: "admin" })).status).toBe(200);
    const token = linkFor("rising.elsewhere@example.com");
    expect((await verify.redeem(token)).status).toBe("invalid");
    expect((await user(rising)).email).toBe("rising@example.com");
    await patch(rising, { action: "role", role: "user" });          // and a later demotion does not revive it
    expect((await verify.redeem(token)).status).toBe("invalid");
    expect((await user(rising)).email).toBe("rising@example.com");
  });
});

describe("hardening from the security review", () => {
  const sha = (t: string) => createHash("sha256").update(t).digest("hex");

  it("never stores a full address in the audit trail, even for an account without a username", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const r = await db.query<{ id: string }>(`insert into users (email, password_hash) values ('nameless@example.com', $1) returning id`, [PW]);
    await db.query(`insert into profiles (id) values ($1)`, [r.rows[0].id]);
    expect((await edit(r.rows[0].id, { email: "nameless.new@example.com" })).status).toBe(200);
    expect((await verify.redeem(linkFor("nameless.new@example.com"))).status).toBe("ok");
    const rows = (await db.query<any>(`select action, target_email, details from admin_audit_log order by id`)).rows;
    expect(rows.map((x: any) => x.action)).toEqual(["user_email_change_requested", "user_email_changed"]);
    for (const row of rows) {
      expect(row.target_email).toBe("na••••ss@example.com");
      expect(JSON.stringify(row)).not.toContain("nameless@example.com");
      expect(JSON.stringify(row)).not.toContain("nameless.new@example.com");
    }
  });

  it("Together trusts the new address only once it is proved, and the old one only until then", async () => {
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
    expect(await addressed("victim@example.com")).toBe(false);     // nobody has shown they read that inbox
    expect(await addressed("vouched@example.com")).toBe(true);     // still the account's address
    expect((await verify.redeem(linkFor("victim@example.com"))).status).toBe("ok");
    expect(await addressed("victim@example.com")).toBe(true);      // proved now
    expect(await addressed("vouched@example.com")).toBe(false);
  });

  it("a link for a PREVIOUS address never moves the account back to it", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("raced", { vr: false, verified: false });
    await edit(target, { email: "raced.new@example.com" });
    expect((await verify.redeem(linkFor("raced.new@example.com"))).status).toBe("ok");
    // A link minted for the old address by a resend racing the confirmation.
    await db.query(`insert into email_verifications (user_id, token_hash, email, expires_at)
                    values ($1, $2, 'raced@example.com', now() + interval '1 hour')`, [target, sha("stale-link")]);
    expect((await verify.redeem("stale-link")).status).toBe("invalid");
    expect((await user(target)).email).toBe("raced.new@example.com");
  });

  it("says so when the confirmation email could not be sent, and saving again sends a fresh link", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("unlucky");
    failFor = "unlucky.new@example.com";
    const body = await (await edit(target, { email: "unlucky.new@example.com" })).json();
    expect(body).toMatchObject({ emailChangeRequested: true, confirmationSent: false });
    expect((await user(target)).email).toBe("unlucky@example.com");          // nothing changed
    expect((await (await edit(target, { email: "unlucky.new@example.com" })).json()).confirmationSent).toBe(true);
    expect((await verify.redeem(linkFor("unlucky.new@example.com"))).status).toBe("ok");
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
  it("a linked Google identity lands in the same account throughout; an unlinked one is never linked by address", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("dual");
    await db.query(`insert into auth_identities (user_id, provider, provider_user_id) values ($1, 'google', 'g-dual')`, [target]);
    await edit(target, { email: "dual.new@example.com" });

    const gate = (sub: string, email: string) => google.gateGoogleIdentity({ sub, email, emailVerified: true });
    expect(await gate("g-dual", "anything@gmail.com")).toMatchObject({ kind: "signin", userId: target });
    // While the change waits, the new address belongs to nobody yet.
    expect((await gate("g-early", "dual.new@example.com")).kind).toBe("signup");

    expect((await verify.redeem(linkFor("dual.new@example.com"))).status).toBe("ok");
    expect(await gate("g-dual", "anything@gmail.com")).toMatchObject({ kind: "signin", userId: target });
    // A different Google account using the NEW address: offered the password-confirmed
    // link step for this account, never a session.
    expect((await gate("g-stranger", "dual.new@example.com")).kind).toBe("link");
    // And one using the OLD address now matches no account at all.
    expect((await gate("g-old-owner", "dual@example.com")).kind).toBe("signup");
    expect((await db.query<any>(`select count(*)::int as n from auth_identities`)).rows[0].n).toBe(1);
  });
});

describe("nothing the person built moves", () => {
  it("habits, priorities, plan and sessions are untouched by a rename, a request and its confirmation", async () => {
    await signInAs(await make("boss", { role: "admin" }));
    const target = await make("builder");
    await db.query(`insert into habits (user_id, name, category, kind) values ($1, 'Stretch', 'morning', 'good')`, [target]);
    await db.query(`insert into priorities (user_id, body, category, created_on) values ($1, 'Ship it', 'urgent_important', current_date)`, [target]);
    await db.query(`insert into user_plans (user_id, plan, source) values ($1, 'pro', 'gifted')`, [target]);
    jar.clear(); await auth.createSession(target);
    await signInAs(await idOf("boss"));
    const snap = async () => (await db.query<any>(`select
      (select md5(string_agg(h::text, '|')) from habits h where user_id = $1) h,
      (select md5(string_agg(p::text, '|')) from priorities p where user_id = $1) p,
      (select md5(string_agg(up::text, '|')) from user_plans up where user_id = $1) pl,
      (select count(*)::int from sessions where user_id = $1) s`, [target])).rows[0];
    const before = await snap();
    await edit(target, { username: "builder2", email: "builder2@example.com" });
    expect(await snap()).toEqual(before);
    expect((await verify.redeem(linkFor("builder2@example.com"))).status).toBe("ok");
    expect(await snap()).toEqual(before);
  });
});
