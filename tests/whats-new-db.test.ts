import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What's New through the real data layer and the real route, against Postgres
 * (PGlite).
 *
 * The properties that matter: the seen mark is per account and only ever moves
 * forward; it is written only for a release the account may actually see; it
 * never creates a row; the general preferences save cannot touch it (nor it the
 * preferences); and what the route records in analytics is a release id and a
 * boolean — nothing anybody wrote.
 */

let db: PGlite;
const open: PGlite[] = [];
vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__wnDb as PGlite).query(sql, params as any[],
      { parsers: { 1082: (v: string) => v } }).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__wnDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows)),
}));
/* The session is the one thing stubbed: whoever `signedIn` says is asking. */
let signedIn: string | null = null;
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => (signedIn ? { id: signedIn } : null) }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined }), headers: () => new Map() }));
const tracked: { event: string; properties?: Record<string, unknown>; userId?: string }[] = [];
vi.mock("@/lib/analytics/track", () => ({ trackEvent: async (e: any) => { tracked.push(e); } }));

const { loadState, markWhatsNewSeen, savePrefs } = await import("../src/lib/db/queries");
const { POST } = await import("../src/app/api/whats-new/route");
const { isSchemaBehind } = await import("../src/lib/db/diagnose");
const { unreadReleases, releaseById } = await import("../src/lib/releases");

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const START = "-- ---- What's New: a per-account seen mark ----";
const END = "-- ---- end What's New ----";
const EXISTING_SCHEMA = SCHEMA.slice(0, SCHEMA.indexOf(START)) + SCHEMA.slice(SCHEMA.indexOf(END) + END.length);

const use = async (schema: string) => {
  db = await PGlite.create();
  open.push(db);
  await db.exec(schema);
  (globalThis as any).__wnDb = db;
};
afterAll(async () => { for (const d of open) await d.close(); });
const sql = async (text: string, params: unknown[] = []) => (await db.query<any>(text, params as any[])).rows;

const EARLY = "2026-08-01T00:00:00Z";
/** An account with the preferences row sign-up gives every account. */
async function account(kind: "free" | "grandfathered" | "expired" | "admin" = "free", createdAt = EARLY) {
  const [u] = await sql(`insert into users (email, password_hash, created_at, role)
    values ($1, 'x', $2, $3) returning id`,
    [`${randomUUID()}@example.com`, createdAt, kind === "admin" ? "admin" : "user"]);
  await sql("insert into user_preferences (user_id, locale, theme) values ($1, 'zh', 'dark')", [u.id]);
  if (kind === "grandfathered") {
    await sql(`insert into user_plans (user_id, plan, source) values ($1, 'pro', 'grandfathered')`, [u.id]);
  }
  if (kind === "expired") {
    await sql(`insert into user_plans (user_id, plan, source, expires_at)
      values ($1, 'pro', 'grandfathered', '2026-01-01T00:00:00Z')`, [u.id]);
  }
  return u.id as string;
}
const markOf = async (id: string) =>
  (await sql("select whats_new_seen_at from user_preferences where user_id = $1", [id]))[0]?.whats_new_seen_at ?? null;
const post = (b: unknown) => POST(new Request("http://x/api/whats-new", {
  method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } }));

describe("after the migration", () => {
  beforeEach(async () => { await use(SCHEMA); tracked.length = 0; signedIn = null; });

  it("gives each account only the releases it may see", async () => {
    const free = await account("free");
    const gp = await account("grandfathered");
    const expired = await account("expired");
    const admin = await account("admin");
    const ids = async (u: string) => (await loadState(u)).whatsNew.releases;
    expect(await ids(free)).toEqual([{ id: "life-calendar", preview: false }, { id: "ai-refresh", preview: false }]);
    expect(await ids(expired)).toEqual([{ id: "life-calendar", preview: false }, { id: "ai-refresh", preview: false }]);
    expect((await ids(gp)).map((r) => r.id)).toEqual(["life-calendar", "richhabit-pro", "ai-refresh"]);
    expect(await ids(admin)).toContainEqual({ id: "richhabit-pro", preview: true });
  });

  it("starts an existing account with everything unread, and a new one with nothing", async () => {
    const existing = await account("free", EARLY);
    const fresh = await account("free", "2026-10-10T09:00:00Z");
    const unread = async (u: string) => {
      const w = (await loadState(u)).whatsNew;
      return unreadReleases(w.releases, w.seenAt, w.accountCreatedAt);
    };
    expect(await unread(existing)).toEqual(["life-calendar", "ai-refresh"]);
    expect(await unread(fresh)).toEqual([]);
  });

  it("marks the publication time of the release shown — and only moves forward", async () => {
    const u = await account("free");
    await markWhatsNewSeen(u, "life-calendar");
    const mark = await markOf(u);
    expect(new Date(mark).toISOString()).toBe(new Date(releaseById("life-calendar")!.publishedAt).toISOString());
    // An older tab reporting an older release cannot move it back.
    const back = await markWhatsNewSeen(u, "ai-refresh");
    expect(back.advanced).toBe(false);
    expect(new Date(await markOf(u)).toISOString()).toBe(new Date(mark).toISOString());
    const w = (await loadState(u)).whatsNew;
    expect(unreadReleases(w.releases, w.seenAt, w.accountCreatedAt)).toEqual([]);
  });

  it("is per account: one person opening the panel changes nobody else", async () => {
    const a = await account("free");
    const b = await account("free");
    await markWhatsNewSeen(a, "life-calendar");
    expect(await markOf(a)).not.toBeNull();
    expect(await markOf(b)).toBeNull();
  });

  it("refuses a release the account may not see, or one that does not exist", async () => {
    const free = await account("free");
    await expect(markWhatsNewSeen(free, "richhabit-pro")).rejects.toMatchObject({ status: 404 });
    await expect(markWhatsNewSeen(free, "release-from-the-future")).rejects.toMatchObject({ status: 404 });
    expect(await markOf(free)).toBeNull();
    // An admin's preview is something they were shown, so it may be marked.
    const admin = await account("admin");
    await markWhatsNewSeen(admin, "richhabit-pro");
    expect(await markOf(admin)).not.toBeNull();
  });

  it("never creates a row", async () => {
    const [u] = await sql("insert into users (email, password_hash) values ('np@example.com', 'x') returning id");
    const before = (await sql("select count(*)::int n from user_preferences"))[0].n;
    const r = await markWhatsNewSeen(u.id, "life-calendar");
    expect(r).toMatchObject({ seenAt: null, previous: null, advanced: false });
    expect((await sql("select count(*)::int n from user_preferences"))[0].n).toBe(before);
  });

  it("is independent of the general preferences save, in both directions", async () => {
    const u = await account("free");
    await markWhatsNewSeen(u, "life-calendar");
    const mark = await markOf(u);
    // Another tab saves its (older) copy of the preferences: the mark survives.
    await savePrefs(u, { theme: "light", weighted: true, goalWeight: null, locale: "en", communityVisible: true });
    expect(await markOf(u)).toEqual(mark);
    // And marking leaves every preference exactly as it was.
    const prefs = (await sql("select theme, locale from user_preferences where user_id = $1", [u]))[0];
    await markWhatsNewSeen(u, "life-calendar");
    expect((await sql("select theme, locale from user_preferences where user_id = $1", [u]))[0]).toEqual(prefs);
  });

  it("settles to the newest mark whatever order two tabs reply in", async () => {
    const u = await account("grandfathered");
    await Promise.all([markWhatsNewSeen(u, "ai-refresh"), markWhatsNewSeen(u, "life-calendar"),
      markWhatsNewSeen(u, "richhabit-pro")]);
    expect(new Date(await markOf(u)).toISOString())
      .toBe(new Date(releaseById("life-calendar")!.publishedAt).toISOString());
  });
});

describe("the route", () => {
  beforeEach(async () => { await use(SCHEMA); tracked.length = 0; signedIn = null; });

  it("refuses a signed-out caller and writes nothing", async () => {
    const u = await account("free");
    const r = await post({ action: "opened", release: "life-calendar" });
    expect(r.status).toBe(401);
    expect(await markOf(u)).toBeNull();
    expect(tracked).toEqual([]);
  });

  it("marks for the signed-in account only, whatever the body says", async () => {
    const me = await account("free");
    const other = await account("free");
    signedIn = me;
    const r = await post({ action: "opened", release: "life-calendar", userId: other, user_id: other });
    expect(r.status).toBe(200);
    expect((await r.json()).seenAt).toBeTruthy();
    expect(await markOf(me)).not.toBeNull();
    expect(await markOf(other)).toBeNull();
  });

  it("records a release id and a boolean — nothing else", async () => {
    const me = await account("free");
    signedIn = me;
    await post({ action: "opened", release: "life-calendar" });
    await post({ action: "opened", release: "life-calendar" });
    await post({ action: "cta", release: "life-calendar", note: "secret words", title: "Mom" });
    expect(tracked.map((e) => [e.event, e.properties])).toEqual([
      ["whats_new_opened", { release: "life-calendar", cleared: true }],
      ["whats_new_opened", { release: "life-calendar", cleared: false }],
      ["whats_new_cta_clicked", { release: "life-calendar" }],
    ]);
    expect(JSON.stringify(tracked)).not.toMatch(/secret|Mom|@example/);
  });

  it("records 'cleared' only when something was actually unread", async () => {
    signedIn = await account("free", "2026-10-10T09:00:00Z");   // joined after every release
    await post({ action: "opened", release: "life-calendar" });
    expect(tracked.at(-1)?.properties).toEqual({ release: "life-calendar", cleared: false });
  });

  it("returns the mark as stored now, even when another tab got there first", async () => {
    const u = await account("grandfathered");
    await markWhatsNewSeen(u, "life-calendar");            // tab A, the newest
    const late = await markWhatsNewSeen(u, "ai-refresh");   // tab B, an older panel
    expect(late.advanced).toBe(false);
    expect(late.seenAt).toBe(new Date(releaseById("life-calendar")!.publishedAt).toISOString());
  });

  it("refuses an audience release, an unknown id and an unknown action, recording nothing", async () => {
    signedIn = await account("free");
    expect((await post({ action: "opened", release: "richhabit-pro" })).status).toBe(404);
    expect((await post({ action: "cta", release: "richhabit-pro" })).status).toBe(404);
    expect((await post({ action: "opened", release: "nope" })).status).toBe(404);
    expect((await post({ action: "delete", release: "life-calendar" })).status).toBe(400);
    expect(tracked).toEqual([]);
  });
});

describe("before the migration has run", () => {
  beforeEach(async () => { await use(EXISTING_SCHEMA); tracked.length = 0; signedIn = null; });

  it("still loads every account, with nothing marked", async () => {
    const u = await account("free");
    const w = (await loadState(u)).whatsNew;
    expect(w.seenAt).toBeNull();
    expect(w.releases.map((r) => r.id)).toEqual(["life-calendar", "ai-refresh"]);
  });

  it("answers a mark as 'not switched on yet', not as a failure", async () => {
    const u = await account("free");
    const err = await markWhatsNewSeen(u, "life-calendar").catch((e) => e);
    expect(isSchemaBehind(err)).toBe(true);
    signedIn = u;
    const r = await post({ action: "opened", release: "life-calendar" });
    expect(r.status).toBe(503);
    expect(tracked).toEqual([]);
  });
});
