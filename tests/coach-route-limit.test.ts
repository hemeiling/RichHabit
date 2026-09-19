import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/coach: Claude through the consumer provider seam, behind the durable
 * safety limit, against a real Postgres (PGlite) and a recording provider.
 *
 * What these pin down: the limit is charged *before* the provider is called, a
 * refusal never reaches the provider, a failed provider call still costs
 * allowance, no provider message ever reaches the caller, the copy is in the
 * reader's language, and a counter that cannot be read fails closed rather than
 * calling a paid API with nothing counting.
 */

const state = vi.hoisted(() => ({
  /** Every request handed to the provider. Also the proof it was reached. */
  asked: [] as { system: string; prompt: string; maxTokens: number; timeoutMs: number }[],
  answer: "Evenings are at 41%. Try moving one habit earlier tomorrow.",
  /** An AiFailed status to throw, or false to answer normally. */
  fail: false as number | false,
  /** null simulates no credential at all. */
  configured: true,
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
/**
 * The provider seam, not a provider SDK. If this route ever imports one
 * directly again, these tests keep passing while the guard test fails — which
 * is the right division of labour.
 */
vi.mock("@/lib/ai/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/ai/provider")>();
  return {
    ...actual,
    coachProvider: async () => (state.configured ? {
      name: "fake",
      async generateStructured() { throw new Error("the coach must ask for text, not a shape"); },
      async generateText(request: any) {
        state.asked.push(request);
        if (state.fail !== false) throw new actual.AiFailed(state.fail);
        return state.answer;
      },
    } : null),
  };
});

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const HOURLY = 3;
const DAILY = 4;
process.env.CLAUDE_API_KEY = "placeholder-not-a-key";
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
  state.asked = [];
  state.fail = false;
  state.configured = true;
  state.breakDb = false;
  state.locale = "en";
  const [row] = await sql(
    `insert into users (email, password_hash) values ($1, 'x') returning id`,
    [`coach-route-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`]);
  state.user = { id: row.id };
});

describe("POST /api/coach, answered by Claude", () => {
  it("returns the model's prose, and records one request", async () => {
    const response = await ask();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ answer: state.answer });
    expect(state.asked).toHaveLength(1);
    expect(await rowsForUser()).toBe(1);
  });

  it("asks for text, with the account's own data and the model's limits", async () => {
    await ask("Why are my evenings weak?");
    const [request] = state.asked;
    // The instructions carry no personal data; the prompt carries the snapshot
    // the server built, and the question. Nothing came from the browser but the
    // question itself.
    expect(request.system).toMatch(/habit-tracking app called RichHabit/);
    expect(request.prompt).toContain("Their data:");
    expect(request.prompt).toContain("Why are my evenings weak?");
    expect(request.maxTokens).toBeGreaterThan(0);
    expect(request.timeoutMs).toBeGreaterThan(0);
  });

  it("answers in the reader's language, and bilingually for both", async () => {
    state.locale = "zh";
    await ask();
    expect(state.asked[0].system).toMatch(/用简体中文回答/);

    state.locale = "both";
    await ask();
    expect(state.asked[1].system).toMatch(/Answer twice/);
  });

  it("says nothing when the coach is not configured, and charges nothing", async () => {
    state.configured = false;
    const response = await ask();
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: dict("en").errors.coachUnavailable });
    expect(state.asked).toHaveLength(0);
    // Not configured cannot cost anything, so it must not cost allowance.
    expect(await rowsForUser()).toBe(0);
  });

  it("never passes a provider message to the caller", async () => {
    state.fail = 500;
    const response = await ask();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: dict("en").errors.coachFailed });
  });

  it("treats a refused key as unavailable rather than retryable", async () => {
    state.fail = 401;
    const response = await ask();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: dict("en").errors.coachUnavailable });
  });

  it("refuses an empty answer rather than rendering nothing", async () => {
    state.answer = "";
    const response = await ask();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: dict("en").errors.coachEmpty });
    state.answer = "Evenings are at 41%. Try moving one habit earlier tomorrow.";
  });
});

describe("the durable safety limit, in front of the provider", () => {
  it("refuses past the hourly limit without reaching the provider", async () => {
    for (let i = 0; i < HOURLY; i++) expect((await ask()).status).toBe(200);
    expect(state.asked).toHaveLength(HOURLY);

    const refused = await ask();
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: dict("en").errors.coachHourlyLimit });
    expect(refused.headers.get("retry-after")).toBe("600");
    // The whole point: no fourth call, so no fourth bill.
    expect(state.asked).toHaveLength(HOURLY);
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
    expect(state.asked).toHaveLength(DAILY);
  });

  it("charges a request whose provider call fails", async () => {
    state.fail = 500;
    expect((await ask()).status).toBe(502);
    // Failed, slow and abandoned calls cost money, so they cost allowance too.
    expect(await rowsForUser()).toBe(1);
    expect(state.asked).toHaveLength(1);
  });

  it("charges a failed call enough to reach the limit", async () => {
    state.fail = 500;
    for (let i = 0; i < HOURLY; i++) expect((await ask()).status).toBe(502);
    state.fail = false;
    // Three failures have spent the hour's allowance; the fourth never reaches
    // the provider at all.
    const refused = await ask();
    expect(refused.status).toBe(429);
    expect(state.asked).toHaveLength(HOURLY);
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
    expect(state.asked).toHaveLength(0);
  });

  it("charges nothing to someone who is not signed in", async () => {
    const signedIn = state.user!.id;
    state.user = null;
    expect((await ask()).status).toBe(401);
    state.user = { id: signedIn };
    expect(await rowsForUser()).toBe(0);
    expect(state.asked).toHaveLength(0);
  });

  it("charges nothing for a question refused before the provider", async () => {
    const long = await POST(new Request("http://localhost/api/coach", {
      method: "POST", body: JSON.stringify({ question: "x".repeat(5000) }),
    }));
    expect(long.status).toBe(400);
    const empty = await POST(new Request("http://localhost/api/coach", {
      method: "POST", body: JSON.stringify({ question: "   " }),
    }));
    expect(empty.status).toBe(400);
    expect(await rowsForUser()).toBe(0);
    expect(state.asked).toHaveLength(0);
  });

  it("limits admins too: this is a cost guard, not an entitlement", async () => {
    await sql(`update users set role = 'admin' where id = $1`, [state.user!.id]);
    for (let i = 0; i < HOURLY; i++) expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(429);
  });

  it("stores nothing about the question or the answer", async () => {
    await ask("Something private about my evenings");
    const [row] = await sql(`select * from coach_requests where user_id = $1`, [state.user!.id]);
    expect(Object.keys(row).sort()).toEqual(["id", "occurred_at", "user_id"]);
    expect(JSON.stringify(row)).not.toMatch(/private|evenings|41%/i);
  });
});
