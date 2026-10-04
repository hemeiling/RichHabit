import { describe, expect, it, vi } from "vitest";

/**
 * Together's transaction wrapper: an expected race (deadlock, serialization
 * failure, a referenced account deleted meanwhile) never reaches anyone as a
 * raw 500, and a real bug is never hidden.
 */
vi.mock("@/lib/db/pool", () => ({ transaction: async () => { throw new Error("unused"); }, query: async () => [] }));
const { togetherTransaction, MAX_ATTEMPTS } = await import("../src/lib/together/tx");
const { TogetherError } = await import("../src/lib/together/access");

const pgError = (code: string) => Object.assign(new Error(`pg ${code}`), { code });
/** A runner that fails with the given errors in turn, then returns "done". */
const failing = (...errors: Error[]) => {
  let calls = 0;
  const run = (async () => { const e = errors[calls++]; if (e) throw e; return "done"; }) as any;
  return { run, calls: () => calls };
};

describe("togetherTransaction", () => {
  it("retries a deadlock or serialization failure as a whole new transaction", async () => {
    const r = failing(pgError("40P01"), pgError("40001"));
    expect(await togetherTransaction(async () => "x", r.run)).toBe("done");
    expect(r.calls()).toBe(3);
  });

  it("asks the person to try again once the retries are used up", async () => {
    const r = failing(...Array.from({ length: MAX_ATTEMPTS }, () => pgError("40P01")));
    const e = await togetherTransaction(async () => "x", r.run).catch((x) => x);
    expect(e).toBeInstanceOf(TogetherError);
    expect([e.code, e.status]).toEqual(["conflict", 409]);
    expect(r.calls()).toBe(MAX_ATTEMPTS);
  });

  it("turns a vanished account or board (foreign key) into the same plain answer, without retrying", async () => {
    const r = failing(pgError("23503"));
    const e = await togetherTransaction(async () => "x", r.run).catch((x) => x);
    expect([e.code, e.status]).toEqual(["conflict", 409]);
    expect(r.calls()).toBe(1);
  });

  it("passes Together's own refusals and real bugs straight through", async () => {
    const refusal = new TogetherError("ownerOnly", 403);
    expect(await togetherTransaction(async () => "x", failing(refusal).run).catch((x) => x)).toBe(refusal);
    for (const bug of [pgError("23505"), pgError("42P01"), new TypeError("boom")]) {
      const r = failing(bug);
      expect(await togetherTransaction(async () => "x", r.run).catch((x) => x)).toBe(bug);
      expect(r.calls()).toBe(1);
    }
  });
});
