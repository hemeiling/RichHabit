/**
 * Verifying the address an account already has.
 *
 * Against a real Postgres (PGlite) built from db/schema.sql, with the mail
 * transport captured rather than sent. The point of these tests is the pair of
 * facts the feature rests on: the recipient can only ever be the address on the
 * account, and nothing about the account changes until a live token is redeemed.
 */
process.env.APP_URL = "https://richhabit.rosalytics.com";

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__verifyDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__verifyDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows)),
}));

vi.mock("@/lib/email/send", () => ({
  sendMail: async (message: unknown) => { ((globalThis as any).__outbox as unknown[]).push(message); },
  transport: () => "outbox",
}));

const { redeem, requestOwnVerification } = await import("../src/lib/email/verify");

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
let db: PGlite;
const outbox: { to: string; subject: string; html: string; text: string }[] = [];
const sql = async (text: string, params: unknown[] = []) => (await db.query<any>(text, params as any[])).rows;

/** An account exactly like the grandfathered ones in production. */
async function legacyAccount(handle: string, opts: { email?: string | null; verified?: boolean; disabled?: boolean } = {}) {
  const email = opts.email === undefined ? `${handle}@example.com` : opts.email;
  const [row] = await sql(
    `insert into users (email, username, password_hash, verification_required, email_verified_at, disabled_at)
     values ($1, $2, 'x', false, $3, $4) returning id`,
    [email, handle, opts.verified ? new Date() : null, opts.disabled ? new Date() : null]);
  return row.id as string;
}
const userRow = async (id: string) =>
  (await sql(`select email, verification_required, email_verified_at, disabled_at from users where id = $1`, [id]))[0];
const tokenFrom = (message: { text: string }) => {
  const match = /\/verify#token=([A-Za-z0-9_-]+)/.exec(message.text);
  expect(match, "the message carries a verification link").not.toBeNull();
  return match![1];
};

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SCHEMA);
  (globalThis as any).__verifyDb = db;
  (globalThis as any).__outbox = outbox;
});
afterAll(async () => { await db.close(); });
beforeEach(() => { outbox.length = 0; });

describe("a grandfathered account asking to verify its own address", () => {
  it("sends one message, to the address stored on the account and nowhere else", async () => {
    const other = await legacyAccount("bystander");
    const id = await legacyAccount("lin");
    expect(await requestOwnVerification(id, "en")).toBe("sent");

    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe("lin@example.com");
    expect(outbox[0].to).not.toBe((await userRow(other)).email);
  });

  it("takes no recipient: the only inputs are an account id and a language", () => {
    expect(requestOwnVerification.length).toBe(2);
  });

  /**
   * The token rides in the fragment, which browsers never send. A query string
   * would be copied into every request log between the reader and the database.
   */
  it("carries the token in the fragment, at the configured public origin", async () => {
    const id = await legacyAccount("origin");
    await requestOwnVerification(id, "en");
    for (const part of [outbox[0].text, outbox[0].html]) {
      expect(part).toContain("https://richhabit.rosalytics.com/verify#token=");
      expect(part).not.toContain("/verify?token=");
    }
  });

  it("puts nothing before the # that could identify the account", async () => {
    const id = await legacyAccount("bare");
    await requestOwnVerification(id, "en");
    const link = /https:\/\/[^\s"<]+/.exec(outbox[0].text)![0];
    expect(link.split("#")[0]).toBe("https://richhabit.rosalytics.com/verify");
  });

  it("stores only the hash of the token", async () => {
    const id = await legacyAccount("hashed");
    await requestOwnVerification(id, "en");
    const token = tokenFrom(outbox[0]);
    const [row] = await sql(`select token_hash from email_verifications where user_id = $1`, [id]);
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("changes nothing about the account by asking", async () => {
    const id = await legacyAccount("unchanged");
    const before = await userRow(id);
    await requestOwnVerification(id, "en");
    expect(await userRow(id)).toEqual(before);
    expect((await userRow(id)).verification_required).toBe(false);
    expect((await userRow(id)).email_verified_at).toBeNull();
  });

  it("will not send a second link straight away", async () => {
    const id = await legacyAccount("patient");
    expect(await requestOwnVerification(id, "en")).toBe("sent");
    expect(await requestOwnVerification(id, "en")).toBe("too_soon");
    expect(outbox).toHaveLength(1);
  });
});

describe("accounts that must not be sent anything", () => {
  it("an address already verified", async () => {
    const id = await legacyAccount("done", { verified: true });
    expect(await requestOwnVerification(id, "en")).toBe("already_verified");
    expect(outbox).toHaveLength(0);
  });

  it("an account with no address at all", async () => {
    const id = await legacyAccount("nameonly", { email: null });
    expect(await requestOwnVerification(id, "en")).toBe("no_address");
    expect(outbox).toHaveLength(0);
  });

  it("a disabled account", async () => {
    const id = await legacyAccount("switchedoff", { disabled: true });
    expect(await requestOwnVerification(id, "en")).toBe("not_available");
    expect(outbox).toHaveLength(0);
  });

  it("an account that does not exist", async () => {
    expect(await requestOwnVerification("11111111-2222-4333-8444-555555555555", "en"))
      .toBe("not_available");
    expect(outbox).toHaveLength(0);
  });
});

describe("redeeming the link is what proves the address", () => {
  it("stamps email_verified_at and leaves verification_required alone", async () => {
    const id = await legacyAccount("proves");
    await requestOwnVerification(id, "en");
    const token = tokenFrom(outbox[0]);

    expect((await userRow(id)).email_verified_at).toBeNull();
    expect(await redeem(token)).toEqual({ status: "ok", email: "proves@example.com" });

    const after = await userRow(id);
    expect(after.email_verified_at).not.toBeNull();
    // The grandfathering rule: this account was never required to verify, and
    // still isn't. Verifying is something it did, not something it now owes.
    expect(after.verification_required).toBe(false);
    expect(after.disabled_at).toBeNull();
    expect(after.email).toBe("proves@example.com");
  });

  it("is single use, and says so warmly the second time", async () => {
    const id = await legacyAccount("twice");
    await requestOwnVerification(id, "en");
    const token = tokenFrom(outbox[0]);
    expect((await redeem(token)).status).toBe("ok");
    expect(await redeem(token)).toEqual({ status: "already" });
  });

  it("refuses an expired link, and the address stays unproved", async () => {
    const id = await legacyAccount("stale");
    await sql(
      `insert into email_verifications (user_id, token_hash, email, expires_at)
       values ($1, $2, $3, now() - interval '1 hour')`,
      [id, createHash("sha256").update("stale-token").digest("hex"), "stale@example.com"]);
    expect(await redeem("stale-token")).toEqual({ status: "expired" });
    expect((await userRow(id)).email_verified_at).toBeNull();
  });

  it("refuses a token nobody issued", async () => {
    expect(await redeem("not-a-real-token")).toEqual({ status: "invalid" });
    expect(await redeem("")).toEqual({ status: "invalid" });
  });
});

describe("the message itself", () => {
  it("is the existing confirmation email, in the account's language", async () => {
    const en = await legacyAccount("english");
    await requestOwnVerification(en, "en");
    expect(outbox[0].subject).toBe("Confirm your email for RichHabit");

    outbox.length = 0;
    const zh = await legacyAccount("chinese");
    await requestOwnVerification(zh, "zh");
    expect(outbox[0].subject).toBe("确认你的 RichHabit 邮箱");
  });

  it("carries no token in any log-shaped field, only in the link", async () => {
    const id = await legacyAccount("quiet");
    await requestOwnVerification(id, "en");
    const token = tokenFrom(outbox[0]);
    // The token appears in the link and nowhere else in the message.
    expect(outbox[0].subject).not.toContain(token);
    expect(outbox[0].text.split(token)).toHaveLength(2);
  });
});

describe("the token never travels as part of a URL the server sees", () => {
  it("is emitted in the fragment, and the path carries nothing else", async () => {
    const id = await legacyAccount("fragment");
    await requestOwnVerification(id, "en");
    const link = /https:\/\/[^\s"<]+/.exec(outbox[0].text)![0];
    const [beforeHash, afterHash] = link.split("#");

    // Everything the server would receive if this link were opened.
    expect(beforeHash).not.toContain("token");
    expect(new URL(beforeHash).search).toBe("");
    // And the credential itself, on the browser's side of the divide.
    expect(afterHash).toMatch(/^token=[A-Za-z0-9_-]{20,}$/);
  });

  it("still redeems by the same hashed, single-use path", async () => {
    const id = await legacyAccount("viafragment");
    await requestOwnVerification(id, "en");
    const token = /#token=([A-Za-z0-9_-]+)/.exec(outbox[0].text)![1];
    const [stored] = await sql(`select token_hash from email_verifications where user_id = $1`, [id]);
    expect(stored.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect((await redeem(token)).status).toBe("ok");
    expect((await redeem(token)).status).toBe("already");
  });
});
