import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which database the app is willing to talk to.
 *
 * `.env.local` is read by `npm run dev` and tends to hold whatever connection
 * string is convenient — which, on a small project, is production's. Nothing
 * then separates "building a feature" from "editing real people's habits":
 * the same click writes the same rows. So development refuses a remote
 * database, and these tests pin the three cases that matter.
 *
 * The middle one is the important one. A guard that also fires in production
 * would take the deployed app down, which is a far worse failure than the one
 * it prevents.
 */

const ORIGINAL = { ...process.env };

// env.ts reads NODE_ENV at module load, so each case needs a fresh module.
async function loadEnv(nodeEnv: string, url: string | undefined, allowRemote?: string) {
  vi.resetModules();
  process.env = { ...ORIGINAL };
  Object.defineProperty(process.env, "NODE_ENV", { value: nodeEnv, configurable: true, writable: true });
  if (url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = url;
  if (allowRemote === undefined) delete process.env.RH_ALLOW_REMOTE;
  else process.env.RH_ALLOW_REMOTE = allowRemote;
  return import("../src/lib/env");
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { process.env = { ...ORIGINAL }; });

const LOCAL = "postgres://postgres@127.0.0.1:5433/postgres";
const REMOTE = "postgresql://u:p@ep-something-pooler.aws.neon.tech/neondb?sslmode=require";

describe("recognising a local database", () => {
  it("accepts the hosts that mean this machine", async () => {
    const { isLocalDatabase } = await loadEnv("development", LOCAL);
    expect(isLocalDatabase("postgres://u@localhost:5432/db")).toBe(true);
    expect(isLocalDatabase("postgres://u@127.0.0.1:5432/db")).toBe(true);
    // IPv6 must be bracketed to be a valid URL, and URL keeps the brackets.
    expect(isLocalDatabase("postgres://u@[::1]:5432/db")).toBe(true);
  });

  it("treats anything else, and anything unparseable, as remote", async () => {
    const { isLocalDatabase } = await loadEnv("development", LOCAL);
    expect(isLocalDatabase(REMOTE)).toBe(false);
    // Unparseable must not read as local, or a malformed string would open the door.
    expect(isLocalDatabase("not a url")).toBe(false);
    expect(isLocalDatabase("")).toBe(false);
  });
});

describe("what development will connect to", () => {
  it("allows a local database", async () => {
    const { databaseUrl } = await loadEnv("development", LOCAL);
    expect(databaseUrl()).toBe(LOCAL);
  });

  it("refuses a remote one, and says how to fix it", async () => {
    const { databaseUrl } = await loadEnv("development", REMOTE);
    expect(() => databaseUrl()).toThrow(/not a local database/);
    expect(() => databaseUrl()).toThrow(/npm run db:dev/);
  });

  it("names the host it refused, so the mistake is obvious", async () => {
    const { databaseUrl } = await loadEnv("development", REMOTE);
    expect(() => databaseUrl()).toThrow(/ep-something-pooler\.aws\.neon\.tech/);
  });

  it("lets an explicit RH_ALLOW_REMOTE=1 through", async () => {
    const { databaseUrl } = await loadEnv("development", REMOTE, "1");
    expect(databaseUrl()).toBe(REMOTE);
  });

  it("is not satisfied by any other value of the flag", async () => {
    const { databaseUrl } = await loadEnv("development", REMOTE, "true");
    expect(() => databaseUrl()).toThrow(/not a local database/);
  });
});

describe("production must never be blocked by this", () => {
  /** The deployed app has to reach Neon. A guard that fires here is an outage. */
  it("allows a remote database in production without any flag", async () => {
    const { databaseUrl } = await loadEnv("production", REMOTE);
    expect(databaseUrl()).toBe(REMOTE);
  });

  it("allows a local one in production too", async () => {
    const { databaseUrl } = await loadEnv("production", LOCAL);
    expect(databaseUrl()).toBe(LOCAL);
  });
});

describe("a missing URL is still its own error", () => {
  it("asks for DATABASE_URL rather than complaining about locality", async () => {
    const { databaseUrl } = await loadEnv("development", undefined);
    expect(() => databaseUrl()).toThrow(/DATABASE_URL is not set/);
  });
});
