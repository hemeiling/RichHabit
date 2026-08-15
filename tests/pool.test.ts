import { describe, expect, it } from "vitest";
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
