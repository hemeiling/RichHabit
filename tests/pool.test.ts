import { afterEach, describe, expect, it } from "vitest";
import { resolveSsl } from "../src/lib/db/pool";

/**
 * Getting this wrong breaks the deploy on first connect, and the two Render
 * connection strings differ only in whether the hostname is dotted.
 */

const RENDER_INTERNAL = "postgresql://richhabits:pw@dpg-abc123def456-a/richhabits";
const RENDER_EXTERNAL =
  "postgresql://richhabits:pw@dpg-abc123def456-a.oregon-postgres.render.com/richhabits";

afterEach(() => { delete process.env.DATABASE_SSL; });

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
    process.env.DATABASE_SSL = "false";
    expect(resolveSsl(RENDER_EXTERNAL)).toBe(false);
    process.env.DATABASE_SSL = "require";
    expect(resolveSsl("postgres://postgres@localhost:5432/postgres"))
      .toEqual({ rejectUnauthorized: false });
  });

  it("does not throw on an unparseable connection string", () => {
    expect(() => resolveSsl("not a url")).not.toThrow();
  });
});
