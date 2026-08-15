import { describe, expect, it } from "vitest";
import { describeFailure, describeTarget, suggestFix } from "../src/lib/db/diagnose";

describe("describing the target without leaking it", () => {
  const neon = "postgresql://owner:sup3rs3cret@ep-cool-frost-1234.us-west-2.aws.neon.tech/neondb?sslmode=require";

  it("recognises each kind of host", () => {
    expect(describeTarget(neon)).toBe("a neon.tech host");
    expect(describeTarget("postgres://postgres@127.0.0.1:5433/postgres")).toBe("localhost");
    expect(describeTarget("postgres://u:p@dpg-abc123-a/richhabits")).toBe("a Render internal host");
    expect(describeTarget("postgres://u:p@dpg-abc123-a.oregon-postgres.render.com/db"))
      .toBe("a Render external host");
    expect(describeTarget("postgres://u:p@db.example.org/x")).toBe("another host");
  });

  it("says when it is unset or unusable", () => {
    expect(describeTarget(undefined)).toBe("not set");
    expect(describeTarget("")).toBe("not set");
    expect(describeTarget("this is not a url")).toBe("unparseable");
  });

  /** The whole point: this is a public endpoint. */
  it("never returns the password, user, host or database name", () => {
    const described = describeTarget(neon);
    for (const secret of ["sup3rs3cret", "owner", "ep-cool-frost-1234", "neondb"]) {
      expect(described).not.toContain(secret);
    }
  });
});

describe("translating the failure", () => {
  const cases: [string, unknown, string][] = [
    ["DNS", { code: "ENOTFOUND" }, "host not found"],
    ["DNS, transient", { code: "EAI_AGAIN" }, "host not found"],
    ["nothing listening", { code: "ECONNREFUSED" }, "connection refused"],
    ["socket timeout", { code: "ETIMEDOUT" }, "connection timed out"],
    ["wrong password", { code: "28P01" }, "authentication failed"],
    ["bad auth spec", { code: "28000" }, "authentication failed"],
    ["wrong database", { code: "3D000" }, "database does not exist"],
    ["connection limit", { code: "53300" }, "too many connections"],
    ["no schema yet", { code: "42P01" }, "the schema has not been applied"],
    ["server has no TLS", { message: "The server does not support SSL connections" },
      "the server refused TLS"],
    ["server demands TLS", { message: "no encryption: SSL required" },
      "TLS is required by the server"],
  ];

  it.each(cases)("%s", (_label, error, expected) => {
    expect(describeFailure(error)).toBe(expected);
  });

  it("falls back to unknown rather than guessing", () => {
    expect(describeFailure({ code: "XX999", message: "something else entirely" })).toBe("unknown");
    expect(describeFailure(null)).toBe("unknown");
  });
});

describe("the suggested fix", () => {
  it("tells you to redeploy when the variable is missing, because Render needs that", () => {
    expect(suggestFix("DATABASE_URL is not set", "not set")).toMatch(/redeploy/i);
  });

  it("points at the Neon console when nothing answers", () => {
    expect(suggestFix("connection refused", "a neon.tech host")).toMatch(/suspended|Neon console/i);
  });

  it("names the exact command when the schema is missing", () => {
    expect(suggestFix("the schema has not been applied", "a neon.tech host"))
      .toContain("npm run db:deploy");
  });

  it("gives a concrete change for each reason, never an empty string", () => {
    const reasons = ["host not found", "connection refused", "connection timed out",
      "authentication failed", "database does not exist", "the server refused TLS",
      "TLS is required by the server", "too many connections",
      "the schema has not been applied", "unknown"] as const;
    for (const r of reasons) {
      expect(suggestFix(r, "a neon.tech host").length, r).toBeGreaterThan(20);
    }
  });
});

/**
 * Observed against a real Neon endpoint that does not exist: their DNS is
 * wildcard, so the name resolves, the connection reaches the proxy, and it is
 * refused as an authentication failure. Advice that mentions only the password
 * would send someone looking in the wrong place.
 */
describe("Neon's wildcard DNS", () => {
  it("says a rejected Neon connection may be the hostname, not just the password", () => {
    const fix = suggestFix("authentication failed", "a neon.tech host");
    expect(fix).toMatch(/hostname|endpoint/i);
    expect(fix).toMatch(/password/i);
  });

  it("keeps the simpler advice for everything else", () => {
    expect(suggestFix("authentication failed", "localhost")).not.toMatch(/endpoint/i);
  });

  it("reports an unparseable URL as itself", () => {
    expect(suggestFix("DATABASE_URL is not a valid URL", "unparseable"))
      .toMatch(/valid connection URL/i);
  });
});
