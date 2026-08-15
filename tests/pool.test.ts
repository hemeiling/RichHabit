import { describe, expect, it, vi } from "vitest";
import { resolveSsl } from "../src/lib/db/pool";

/**
 * Getting this wrong breaks the deploy on first connect, and the two Render
 * connection strings differ only in whether the hostname is dotted.
 */

const RENDER_INTERNAL = "postgresql://richhabits:pw@dpg-abc123def456-a/richhabits";
const RENDER_EXTERNAL =
  "postgresql://richhabits:pw@dpg-abc123def456-a.oregon-postgres.render.com/richhabits";

// The override is passed in rather than read from process.env: env is captured
// once at startup, so a test that mutated it would prove nothing.

describe("resolveSsl", () => {
  it("is off for local Postgres", () => {
    expect(resolveSsl("postgres://postgres@localhost:5432/postgres")).toBe(false);
    expect(resolveSsl("postgres://postgres@127.0.0.1:5433/postgres")).toBe(false);
  });

  it("is off for Render's internal host, which does not speak TLS", () => {
    expect(resolveSsl(RENDER_INTERNAL)).toBe(false);
  });

  it("is on for Render's external host", () => {
    expect(resolveSsl(RENDER_EXTERNAL)).toEqual({ rejectUnauthorized: false });
  });

  it("honours sslmode in the URL over the hostname guess", () => {
    expect(resolveSsl(`${RENDER_EXTERNAL}?sslmode=disable`)).toBe(false);
    expect(resolveSsl(`${RENDER_INTERNAL}?sslmode=require`)).toEqual({ rejectUnauthorized: false });
  });

  it("lets DATABASE_SSL override everything", () => {
    expect(resolveSsl(RENDER_EXTERNAL, "false")).toBe(false);
    expect(resolveSsl(RENDER_EXTERNAL, "disable")).toBe(false);
    expect(resolveSsl("postgres://postgres@localhost:5432/postgres", "require"))
      .toEqual({ rejectUnauthorized: false });
    // Case should not matter.
    expect(resolveSsl(RENDER_EXTERNAL, "DISABLE")).toBe(false);
  });

  it("does not throw on an unparseable connection string", () => {
    expect(() => resolveSsl("not a url")).not.toThrow();
  });
});

/**
 * Neon hands out two connection strings — a direct one and a pooled one whose
 * host carries `-pooler` — and both require TLS. Getting this wrong is not a
 * subtle failure: the app simply reports `db: "down"` forever.
 */
describe("a Neon connection string", () => {
  const direct = "postgresql://owner:pw@ep-cool-frost-12345678.us-east-2.aws.neon.tech/neondb?sslmode=require";
  const pooled = "postgresql://owner:pw@ep-cool-frost-12345678-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";

  it("turns TLS on for the direct endpoint", () => {
    expect(resolveSsl(direct, null)).toEqual({ rejectUnauthorized: false });
  });

  it("turns TLS on for the pooled endpoint too", () => {
    expect(resolveSsl(pooled, null)).toEqual({ rejectUnauthorized: false });
  });

  it("still honours sslmode when channel binding is requested", () => {
    const withBinding = `${direct}&channel_binding=require`;
    expect(resolveSsl(withBinding, null)).toEqual({ rejectUnauthorized: false });
  });

  it("keeps TLS on even without an explicit sslmode, because the host is a FQDN", () => {
    const bare = "postgresql://owner:pw@ep-cool-frost-12345678.us-east-2.aws.neon.tech/neondb";
    expect(resolveSsl(bare, null)).toEqual({ rejectUnauthorized: false });
  });

  it("lets an explicit override still win", () => {
    expect(resolveSsl(direct, "disable")).toBe(false);
  });
});

/**
 * A test instance may only ever reach a local database. The browser suites sign
 * up freely against it and every account it creates is marked
 * `created_via='test'`; pointed at production by accident it would fill the real
 * database with fixtures and mislabel real people.
 */
describe("a test instance cannot reach production", () => {
  const neon = "postgresql://o:p@ep-cool-frost-1234.us-east-2.aws.neon.tech/neondb?sslmode=require";
  const local = "postgres://postgres@127.0.0.1:5434/postgres";

  const withTestInstance = async (value: string | undefined, fn: (m: any) => void) => {
    const before = process.env.RH_TEST_INSTANCE;
    if (value === undefined) delete process.env.RH_TEST_INSTANCE;
    else process.env.RH_TEST_INSTANCE = value;
    vi.resetModules();
    const mod = await import("../src/lib/db/pool");
    try { fn(mod); } finally {
      if (before === undefined) delete process.env.RH_TEST_INSTANCE;
      else process.env.RH_TEST_INSTANCE = before;
      vi.resetModules();
    }
  };

  it("refuses a remote database while RH_TEST_INSTANCE is set", async () => {
    await withTestInstance("true", (m) => {
      expect(() => m.assertTestInstanceIsLocal(neon)).toThrow(/not a local database/i);
    });
  });

  it("names the host it refused, so the mistake is obvious", async () => {
    await withTestInstance("true", (m) => {
      expect(() => m.assertTestInstanceIsLocal(neon)).toThrow(/neon\.tech/);
    });
  });

  it("allows a local database", async () => {
    await withTestInstance("true", (m) => {
      expect(() => m.assertTestInstanceIsLocal(local)).not.toThrow();
    });
  });

  it("refuses anything it cannot parse, rather than assuming it is safe", async () => {
    await withTestInstance("true", (m) => {
      expect(() => m.assertTestInstanceIsLocal("not a url")).toThrow();
    });
  });

  it("does nothing at all when the flag is unset — production is unaffected", async () => {
    await withTestInstance(undefined, (m) => {
      expect(() => m.assertTestInstanceIsLocal(neon)).not.toThrow();
    });
  });
});
