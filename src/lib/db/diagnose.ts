/**
 * Why the database could not be reached, in words, without leaking anything.
 *
 * A health check that only says "down" is no use from outside the deployment:
 * an unset variable, a suspended database, a wrong password and a missing TLS
 * setting all look identical, and the person who can fix it is usually the one
 * who cannot read the logs.
 *
 * So this maps the failure to a category and describes the *target* by shape
 * rather than by name. The connection string, the password, the user and the
 * full hostname never appear — "a neon.tech host" is enough to tell you whether
 * the variable points where you meant, and tells a stranger nothing they could
 * connect to.
 */

export type DbTarget =
  | "not set" | "localhost" | "a neon.tech host" | "a Render internal host"
  | "a Render external host" | "another host" | "unparseable";

export type DbReason =
  | "DATABASE_URL is not set"
  | "host not found"
  | "connection refused"
  | "connection timed out"
  | "authentication failed"
  | "database does not exist"
  | "the server refused TLS"
  | "TLS is required by the server"
  | "too many connections"
  | "the schema has not been applied"
  | "DATABASE_URL is not a valid URL"
  | "unknown";

/**
 * True when the failure was "the schema in front of this code is older than the
 * code": 42P01 undefined_table, or 42703 undefined_column.
 *
 * On the free plan migrations are applied by hand against the database, so a
 * deploy can land minutes or hours before its migration does — that has
 * happened, and it turned every account into an apparently empty one because a
 * single missing table failed the whole state read.
 *
 * So a *new* module is allowed to be missing. It reports itself unavailable
 * rather than empty, and everything that existed before it still loads. The
 * column case is the same situation one release later: adding a field to an
 * existing table puts the writes ahead of the schema in exactly the same way,
 * and it should read as "not deployed yet" rather than as a save that failed
 * for unknowable reasons.
 *
 * Applied only where a module has opted in. Everywhere else these still throw.
 */
export const isSchemaBehind = (e: unknown) => {
  const code = (e as { code?: string } | null)?.code;
  return code === "42P01" || code === "42703";
};

/**
 * The name of the CHECK constraint a write violated, or null.
 *
 * Postgres 23514 carries the constraint's name, which is the difference between
 * "something went wrong saving that" and a sentence someone can act on. Used
 * for the one case the app can genuinely be ahead of: a limit widened in the
 * code before the migration that widens it in the database has been applied.
 */
export const violatedConstraint = (e: unknown): string | null => {
  const err = e as { code?: string; constraint?: string } | null;
  return err?.code === "23514" ? err.constraint ?? "" : null;
};

/** The shape of what DATABASE_URL points at. Never the value. */
export function describeTarget(connectionString: string | undefined): DbTarget {
  if (!connectionString) return "not set";
  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    return "unparseable";
  }
  if (["localhost", "127.0.0.1", "::1"].includes(host)) return "localhost";
  if (host.endsWith(".neon.tech")) return "a neon.tech host";
  if (host.includes("render.com")) return "a Render external host";
  // Render's private network names have no dots.
  if (!host.includes(".")) return "a Render internal host";
  return "another host";
}

/**
 * Postgres error codes and Node socket errors, translated. Each maps to one
 * thing to go and change, which is the only reason to report it at all.
 */
export function describeFailure(error: unknown): DbReason {
  const e = error as { code?: string; message?: string } | null;
  const code = e?.code ?? "";
  const message = (e?.message ?? "").toLowerCase();

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "host not found";
  if (code === "ECONNREFUSED") return "connection refused";
  if (code === "ETIMEDOUT" || message.includes("timeout")) return "connection timed out";
  // 28P01 invalid_password, 28000 invalid_authorization_specification
  if (code === "28P01" || code === "28000") return "authentication failed";
  if (code === "3D000") return "database does not exist";
  if (code === "53300") return "too many connections";
  // 42P01 undefined_table — connected fine, but db:deploy has not been run.
  if (code === "42P01") return "the schema has not been applied";
  if (message.includes("does not support ssl")) return "the server refused TLS";
  if (message.includes("no encryption") || message.includes("ssl required")
    || message.includes("sslmode")) return "TLS is required by the server";
  return "unknown";
}

/** One sentence saying what to change. */
export function suggestFix(reason: DbReason, target: DbTarget): string {
  if (reason === "DATABASE_URL is not a valid URL") {
    return "DATABASE_URL is not a valid connection URL. It should look like "
      + "postgresql://user:password@host/dbname?sslmode=require";
  }
  if (reason === "DATABASE_URL is not set" || target === "not set") {
    return "Set DATABASE_URL on the service, then redeploy — Render applies "
      + "environment changes to the next deploy, not the running one.";
  }
  if (target === "unparseable") {
    return "DATABASE_URL is not a valid connection URL. It should look like "
      + "postgresql://user:password@host/dbname?sslmode=require";
  }
  switch (reason) {
    case "host not found":
      return "The hostname in DATABASE_URL does not resolve. Check it was copied "
        + "whole, and that the database still exists.";
    case "connection refused":
    case "connection timed out":
      return "Nothing answered. If this is Neon, the project may be suspended or "
        + "deleted; open it in the Neon console and check it is active.";
    case "authentication failed":
      /*
       * Neon answers this for a *wrong endpoint id* as well as a wrong
       * password: its DNS is wildcard, so a hostname that was never a real
       * endpoint still resolves, reaches the proxy, and is rejected there.
       * Observed, not assumed — a nonexistent ep-… host returns exactly this.
       * Sending someone to check only their password would waste an afternoon.
       */
      return target === "a neon.tech host"
        ? "Neon rejected the connection. That means a wrong password *or* a "
          + "hostname that is not one of your endpoints — Neon resolves any "
          + "ep-… name. Copy the whole connection string again from the Neon "
          + "console."
        : "The user or password in DATABASE_URL is wrong. Copy the connection "
          + "string again from the database's dashboard.";
    case "database does not exist":
      return "The database name at the end of DATABASE_URL is wrong. Neon's "
        + "default is /neondb.";
    case "TLS is required by the server":
      return "Append ?sslmode=require to DATABASE_URL, or set DATABASE_SSL=require.";
    case "the server refused TLS":
      return "Set DATABASE_SSL=disable — this server does not speak TLS.";
    case "too many connections":
      return "Lower PG_POOL_MAX. Free tiers allow few connections.";
    case "the schema has not been applied":
      return "Run: DATABASE_URL='…' npm run db:deploy";
    default:
      return "Check the service logs for the full error.";
  }
}
