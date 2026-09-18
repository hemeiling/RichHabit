/**
 * Forgotten-password recovery, against a real Postgres (PGlite) built from
 * db/schema.sql, with the mail transport captured rather than sent.
 *
 * The two facts everything else rests on: a reset is only ever sent to an
 * address the account has actually proved, and the answer is the same whether
 * or not one was sent.
 */
process.env.APP_URL = "https://richhabit.rosalytics.com";

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__resetDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__resetDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows)),
}));

vi.mock("@/lib/email/send", () => ({
  sendMail: async (message: unknown) => { ((globalThis as any).__outbox as unknown[]).push(message); },
  transport: () => "outbox",
}));

const { redeemReset, requestReset, resetUrl } = await import("../src/lib/auth/passwordReset");
const { hashPassword, verifyPassword } = await import("../src/lib/auth");

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
let db: PGlite;
const outbox: { to: string; subject: string; html: string; text: string }[] = [];
const sql = async (text: string, params: unknown[] = []) => (await db.query<any>(text, params as any[])).rows;

/** Accounts shaped like the ones in production. */
async function account(handle: string, opts: {
  verified?: boolean; email?: string | null; disabled?: boolean; required?: boolean;
} = {}) {
  const email = opts.email === undefined ? `${handle}@example.com` : opts.email;
  const [row] = await sql(
    `insert into users (email, username, password_hash, verification_required, email_verified_at, disabled_at)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [email, handle, await hashPassword("Original-Password-1"), opts.required ?? false,
      opts.verified ? new Date() : null, opts.disabled ? new Date() : null]);
  return row.id as string;
}
const session = (userId: string) =>
  sql(`insert into sessions (user_id, expires_at) values ($1, now() + interval '30 days') returning id`,
    [userId]).then((r) => r[0].id as string);
const sessionCount = (userId: string) =>
  sql(`select count(*)::int n from sessions where user_id = $1`, [userId]).then((r) => r[0].n);
const tokenFrom = (message: { text: string }) =>
  /#token=([A-Za-z0-9_-]+)/.exec(message.text)![1];
const passwordOf = (userId: string) =>
  sql(`select password_hash from users where id = $1`, [userId]).then((r) => r[0].password_hash);

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SCHEMA);
  (globalThis as any).__resetDb = db;
  (globalThis as any).__outbox = outbox;
});
afterAll(async () => { await db.close(); });
beforeEach(() => { outbox.length = 0; });

describe("who is sent a reset link", () => {
  it("an account whose address has been verified", async () => {
    const id = await account("verified", { verified: true });
    expect(await requestReset("verified@example.com", "en")).toBe("sent");
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe("verified@example.com");
  });

  it("the same account, found by its username", async () => {
    const id = await account("byname", { verified: true });
    expect(await requestReset("byname", "en")).toBe("sent");
    expect(outbox[0].to).toBe("byname@example.com");
    expect(id).toBeTruthy();
  });

  /**
   * The heart of it: a grandfathered account with an address nobody ever proved
   * is treated exactly like an account that does not exist.
   */
  it("NOT an account whose address was never verified", async () => {
    await account("unproven", { verified: false });
    expect(await requestReset("unproven@example.com", "en")).toBe("not_eligible");
    expect(outbox).toHaveLength(0);
  });

  it("NOT an account with no address at all", async () => {
    await account("nameonly", { email: null });
    expect(await requestReset("nameonly", "en")).toBe("not_eligible");
    expect(outbox).toHaveLength(0);
  });

  it("NOT a disabled account, even a verified one", async () => {
    await account("switchedoff", { verified: true, disabled: true });
    expect(await requestReset("switchedoff@example.com", "en")).toBe("not_eligible");
    expect(outbox).toHaveLength(0);
  });

  it("NOT an identifier nobody holds", async () => {
    expect(await requestReset("nobody@example.com", "en")).toBe("not_eligible");
    expect(await requestReset("nobody", "en")).toBe("not_eligible");
    expect(await requestReset("", "en")).toBe("not_eligible");
    expect(outbox).toHaveLength(0);
  });

  it("never lets a username probe the address column, or the reverse", async () => {
    await account("crossed", { verified: true });
    // The value has an @, so it can only ever match an address.
    expect(await requestReset("crossed@wrong.example", "en")).toBe("not_eligible");
    expect(outbox).toHaveLength(0);
  });
});

describe("the message and its token", () => {
  it("carries the token in the fragment, never the query string", async () => {
    await account("fragment", { verified: true });
    await requestReset("fragment@example.com", "en");
    const link = /https:\/\/[^\s"<]+/.exec(outbox[0].text)![0];
    expect(link.split("#")[0]).toBe("https://richhabit.rosalytics.com/reset");
    expect(link).toContain("/reset#token=");
    expect(outbox[0].text).not.toContain("/reset?token=");
    expect(outbox[0].html).not.toContain("/reset?token=");
  });

  it("stores only the SHA-256 of the token", async () => {
    const id = await account("hashed", { verified: true });
    await requestReset("hashed@example.com", "en");
    const token = tokenFrom(outbox[0]);
    const [row] = await sql(`select token_hash from password_resets where user_id = $1`, [id]);
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    // And the raw value appears nowhere in the table.
    const dump = JSON.stringify(await sql(`select * from password_resets where user_id = $1`, [id]));
    expect(dump).not.toContain(token);
  });

  it("is a 32-byte base64url token", async () => {
    await account("entropy", { verified: true });
    await requestReset("entropy@example.com", "en");
    const token = tokenFrom(outbox[0]);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("expires in thirty minutes", async () => {
    const id = await account("halfhour", { verified: true });
    await requestReset("halfhour@example.com", "en");
    const [row] = await sql(
      `select extract(epoch from (expires_at - now()))::int as seconds from password_resets where user_id = $1`,
      [id]);
    expect(row.seconds).toBeGreaterThan(29 * 60);
    expect(row.seconds).toBeLessThanOrEqual(30 * 60);
  });

  it("is addressed by resetUrl to the configured public origin", () => {
    expect(resetUrl("abc")).toBe("https://richhabit.rosalytics.com/reset#token=abc");
  });
});

describe("asking again", () => {
  it("consumes the previous link, so only the newest works", async () => {
    const id = await account("newest", { verified: true });
    await requestReset("newest@example.com", "en");
    const first = tokenFrom(outbox[0]);
    // Past the per-account gap.
    await sql(`update password_resets set created_at = created_at - interval '5 minutes' where user_id = $1`, [id]);
    await requestReset("newest@example.com", "en");
    const second = tokenFrom(outbox[1]);

    expect(await redeemReset(first, "Brand-New-Password-1")).toEqual({ status: "invalid" });
    expect(await redeemReset(second, "Brand-New-Password-1")).toEqual({ status: "ok" });
  });

  it("refuses a second link inside the gap", async () => {
    await account("tooquick", { verified: true });
    expect(await requestReset("tooquick@example.com", "en")).toBe("sent");
    expect(await requestReset("tooquick@example.com", "en")).toBe("rate_limited");
    expect(outbox).toHaveLength(1);
  });

  it("stops after the daily allowance, counted in the database", async () => {
    const id = await account("persistent", { verified: true });
    for (let i = 0; i < 5; i++) {
      expect(await requestReset("persistent@example.com", "en")).toBe("sent");
      await sql(`update password_resets set created_at = created_at - interval '5 minutes' where user_id = $1`, [id]);
    }
    expect(await requestReset("persistent@example.com", "en")).toBe("rate_limited");
    expect(outbox).toHaveLength(5);

    // Yesterday's attempts do not count against today.
    await sql(`update password_resets set created_at = created_at - interval '25 hours' where user_id = $1`, [id]);
    expect(await requestReset("persistent@example.com", "en")).toBe("sent");
  });
});

describe("spending the link", () => {
  it("sets the new password, ends every session, and consumes the token", async () => {
    const id = await account("resets", { verified: true });
    await session(id); await session(id); await session(id);
    const before = await passwordOf(id);
    await requestReset("resets@example.com", "en");
    const token = tokenFrom(outbox[0]);

    expect(await sessionCount(id)).toBe(3);
    expect(await redeemReset(token, "A-Whole-New-Password-9")).toEqual({ status: "ok" });

    expect(await sessionCount(id)).toBe(0);
    const after = await passwordOf(id);
    expect(after).not.toBe(before);
    expect(await verifyPassword("A-Whole-New-Password-9", after)).toBe(true);
    expect(await verifyPassword("Original-Password-1", after)).toBe(false);

    const [row] = await sql(`select consumed_at from password_resets where user_id = $1`, [id]);
    expect(row.consumed_at).not.toBeNull();
  });

  it("is single use", async () => {
    const id = await account("once", { verified: true });
    await requestReset("once@example.com", "en");
    const token = tokenFrom(outbox[0]);
    expect((await redeemReset(token, "First-New-Password-1")).status).toBe("ok");
    expect(await redeemReset(token, "Second-New-Password-2")).toEqual({ status: "invalid" });
    // The second attempt changed nothing.
    expect(await verifyPassword("First-New-Password-1", await passwordOf(id))).toBe(true);
  });

  it("refuses an expired link, and the password stands", async () => {
    const id = await account("stale", { verified: true });
    await requestReset("stale@example.com", "en");
    const token = tokenFrom(outbox[0]);
    await sql(`update password_resets set expires_at = now() - interval '1 minute' where user_id = $1`, [id]);

    expect(await redeemReset(token, "Should-Not-Apply-1")).toEqual({ status: "expired" });
    expect(await verifyPassword("Original-Password-1", await passwordOf(id))).toBe(true);
  });

  it("refuses a token nobody issued", async () => {
    expect(await redeemReset("not-a-real-token", "Whatever-Password-1")).toEqual({ status: "invalid" });
    expect(await redeemReset("", "Whatever-Password-1")).toEqual({ status: "invalid" });
  });

  it("refuses a link for an account disabled after it was sent", async () => {
    const id = await account("turnedoff", { verified: true });
    await requestReset("turnedoff@example.com", "en");
    const token = tokenFrom(outbox[0]);
    await sql(`update users set disabled_at = now() where id = $1`, [id]);

    expect(await redeemReset(token, "Should-Not-Apply-2")).toEqual({ status: "invalid" });
    expect(await verifyPassword("Original-Password-1", await passwordOf(id))).toBe(true);
  });

  it("leaves other accounts' sessions and passwords alone", async () => {
    const mine = await account("mine", { verified: true });
    const theirs = await account("theirs", { verified: true });
    await session(mine); await session(theirs); await session(theirs);
    const theirPassword = await passwordOf(theirs);

    await requestReset("mine@example.com", "en");
    await redeemReset(tokenFrom(outbox[0]), "Only-Mine-Changes-1");

    expect(await sessionCount(mine)).toBe(0);
    expect(await sessionCount(theirs)).toBe(2);
    expect(await passwordOf(theirs)).toBe(theirPassword);
  });

  it("does not resurrect a verification state or change the account's flags", async () => {
    const id = await account("flags", { verified: true });
    const [before] = await sql(
      `select verification_required, email_verified_at, email, username, role::text as role,
              must_change_password, created_at from users where id = $1`, [id]);
    await requestReset("flags@example.com", "en");
    await redeemReset(tokenFrom(outbox[0]), "Nothing-Else-Moves-1");
    const [after] = await sql(
      `select verification_required, email_verified_at, email, username, role::text as role,
              must_change_password, created_at from users where id = $1`, [id]);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});
