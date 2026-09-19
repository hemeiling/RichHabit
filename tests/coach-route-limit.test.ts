import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/coach under its safety limit, against a real Postgres (PGlite) and
 * a recording provider.
 *
 * What these pin down: the limit is charged *before* the provider is called, a
 * refusal never reaches the provider, the copy is in the reader's language, and
 * a counter that cannot be read fails closed rather than calling a paid API
 * with nothing counting.
 */

const state = vi.hoisted(() => ({
  created: [] as unknown[],
  /** Set to throw from the provider, to prove a failed call still costs. */
  fail: false,
  /** Set to make the counter unreadable, to prove the route fails closed. */
  breakDb: false,
  user: null as { id: string } | null,
  locale: "en" as "en" | "zh" | "both",
}));

const asPg = () => (globalThis as any).__coachRouteDb as PGlite;
vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    asPg().query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) => {
    if (state.breakDb) throw new Error("no connection");
    return asPg().transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows));
  },
}));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => state.user }));
vi.mock("@/lib/db/queries", () => ({ loadState: async () => ({ habits: [] }) }));
vi.mock("@/lib/coach", () => ({ coach: { buildContext: () => ({ habits: [] }) } }));
vi.mock("@/lib/analytics/track", () => ({ trackEvent: async () => {} }));
vi.mock("@/lib/i18n/server", () => ({
  // The real dictionaries, so these assert the copy that actually ships. `dict`
  // is imported below; the factory only runs once a route reads a message.
  getDict: () => dict(state.locale),
  getLocale: () => state.locale,
}));
vi.mock("openai", () => {
  class APIError extends Error { status = 502; }
  class OpenAI {
    static APIError = APIError;
    responses = {
      create: async (request: unknown) => {
        state.created.push(request);
        if (state.fail) throw new APIError("provider exploded");
        return { output_text: "Evenings are at 41%." };
      },
    };
  }
  return { default: OpenAI, APIError };
});

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const HOURLY = 3;
const DAILY = 4;
process.env.OPENAI_API_KEY = "test-key-not-real";
process.env.COACH_HOURLY_LIMIT = String(HOURLY);
process.env.COACH_DAILY_LIMIT = String(DAILY);

const { POST } = await import("../src/app/api/coach/route");
const { dict } = await import("../src/lib/i18n");

let db: PGlite;
const sql = async (text: string, params: unknown[] = []) => (await db.query<any>(text, params as any[])).rows;
const ask = (question = "What should I change this week?") =>
  POST(new Request("http://localhost/api/coach", {
    method: "POST", body: JSON.stringify({ question }),
  }));
const rowsForUser = async () =>
  (await sql(`select count(*)::int n from coach_requests where user_id = $1`, [state.user!.id]))[0].n;
const age = (interval: string) =>
  sql(`update coach_requests set occurred_at = occurred_at - $2::interval where user_id = $1`,
    [state.user!.id, interval]);

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SCHEMA);
  (globalThis as any).__coachRouteDb = db;
});
afterAll(async () => { await db.close(); });

beforeEach(async () => {
  state.created = [];
  state.fail = false;
  state.breakDb = false;
  state.locale = "en";
  const [row] = await sql(
    `insert into users (email, password_hash) values ($1, 'x') returning id`,
    [`coach-route-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`]);
  state.user = { id: row.id };
});

describe("POST /api/coach, under the safety limit", () => {
  it("answers while under the limit, and records one request per call", async () => {
    const response = await ask();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ answer: "Evenings are at 41%." });
    expect(state.created).toHaveLength(1);
    expect(await rowsForUser()).toBe(1);
  });

  it("refuses past the hourly limit without reaching the provider", async () => {
    for (let i = 0; i < HOURLY; i++) expect((await ask()).status).toBe(200);
    expect(state.created).toHaveLength(HOURLY);

    const refused = await ask();
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: dict("en").errors.coachHourlyLimit });
    expect(refused.headers.get("retry-after")).toBe("600");
    // The whole point: no fourth call, so no fourth bill.
    expect(state.created).toHaveLength(HOURLY);
    // And a refusal does not consume allowance of its own.
    expect(await rowsForUser()).toBe(HOURLY);
  });

  it("refuses past the daily limit, and says so differently", async () => {
    for (let i = 0; i < DAILY; i++) {
      expect((await ask()).status).toBe(200);
      await age("70 minutes"); // spread across hours, so the day is the binding limit
    }
    const refused = await ask();
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: dict("en").errors.coachDailyLimit });
    expect(refused.headers.get("retry-after")).toBe("3600");
    expect(state.created).toHaveLength(DAILY);
  });

  it("charges a request whose provider call fails", async () => {
    state.fail = true;
    const response = await ask();
    expect(response.status).toBe(502);
    // Failed, slow and abandoned calls cost money, so they cost allowance too.
    expect(await rowsForUser()).toBe(1);
  });

  it("refuses in the reader's language, and bilingually for both", async () => {
    for (let i = 0; i < HOURLY; i++) await ask();

    state.locale = "zh";
    const zh = await (await ask()).json();
    expect(zh.error).toBe(dict("zh").errors.coachHourlyLimit);
    expect(zh.error).toMatch(/[一-鿿]/);

    state.locale = "both";
    const both = await (await ask()).json();
    expect(both.error).toBe(dict("both").errors.coachHourlyLimit);
    // One screen, two readers: the bilingual form carries English and Chinese.
    expect(both.error).toMatch(/[一-鿿]/);
    expect(both.error).toMatch(/[A-Za-z]/);
  });

  it("fails closed when the counter cannot be read", async () => {
    state.breakDb = true;
    const response = await ask();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: dict("en").errors.coachLimitUnavailable });
    // Unable to count means unable to guard: the provider is not called.
    expect(state.created).toHaveLength(0);
  });

  it("charges nothing to someone who is not signed in", async () => {
    const signedIn = state.user!.id;
    state.user = null;
    expect((await ask()).status).toBe(401);
    state.user = { id: signedIn };
    expect(await rowsForUser()).toBe(0);
    expect(state.created).toHaveLength(0);
  });

  it("charges nothing for a question that is refused before the provider", async () => {
    const long = await POST(new Request("http://localhost/api/coach", {
      method: "POST", body: JSON.stringify({ question: "x".repeat(5000) }),
    }));
    expect(long.status).toBe(400);
    const empty = await POST(new Request("http://localhost/api/coach", {
      method: "POST", body: JSON.stringify({ question: "   " }),
    }));
    expect(empty.status).toBe(400);
    expect(await rowsForUser()).toBe(0);
  });

  it("limits admins too: this is a cost guard, not an entitlement", async () => {
    await sql(`update users set role = 'admin' where id = $1`, [state.user!.id]);
    for (let i = 0; i < HOURLY; i++) expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(429);
  });
});
