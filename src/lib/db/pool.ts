import { Pool, types } from "pg";
import { database, databaseUrl, isProduction } from "@/lib/env";

/**
 * The one connection pool. Server-only — nothing under `components/` may import
 * this, directly or otherwise, or DATABASE_URL would end up in a client bundle.
 * Route handlers are the only callers.
 */

// `date` columns come back as JS Dates in the local timezone, which shifts
// 2026-08-12 to the 11th west of UTC. Every date in this app is a calendar day,
// so take the string Postgres actually sent.
types.setTypeParser(1082, (v) => v);
// numeric: keep the precision decision in the mapping layer rather than letting
// pg hand back strings that silently concatenate.
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

declare global {
  // eslint-disable-next-line no-var
  var __richHabitsPool: Pool | undefined;
}

/**
 * Whether to open the connection with TLS.
 *
 * This has to be right for three different targets:
 *   - local Postgres — no TLS at all
 *   - Render *internal* (`postgres://…@dpg-abc123-a/db`) — same private network,
 *     no TLS, and `pg` fails outright if it offers SSL to a server without it
 *   - Render *external* (`…@dpg-abc123-a.oregon-postgres.render.com/db`) — TLS
 *     required, terminated with Render's own CA
 *
 * The internal and external hostnames differ only in whether they are dotted,
 * which is what the default keys off. `DATABASE_SSL` or an `sslmode` in the URL
 * overrides it when the guess is wrong.
 */
export function resolveSsl(
  connectionString: string,
  override: string | null = database.ssl,
): false | { rejectUnauthorized: boolean } {
  const on = { rejectUnauthorized: false };

  if (override) {
    return ["0", "false", "disable", "off", "no"].includes(override.toLowerCase()) ? false : on;
  }

  let host = "";
  let sslmode = "";
  try {
    const url = new URL(connectionString);
    host = url.hostname;
    sslmode = url.searchParams.get("sslmode") ?? "";
  } catch {
    // Not a parseable URL; fall through to the conservative default below.
  }

  if (sslmode) return sslmode === "disable" ? false : on;
  if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
  // Undotted host means a private service name (Render internal, Docker, k8s).
  return host.includes(".") ? on : false;
}

function create() {
  const connectionString = databaseUrl();
  return new Pool({
    connectionString,
    ssl: resolveSsl(connectionString),
    max: database.poolMax,
    idleTimeoutMillis: database.idleMs,
    connectionTimeoutMillis: database.connectionTimeoutMs,
  });
}

/**
 * Built on first use, not at import. `next build` imports every route to collect
 * page data, and a pool created at module scope would make the build itself
 * require DATABASE_URL. Reused across hot reloads in dev, where module state is
 * thrown away often.
 */
let cached: Pool | undefined;

function getPool(): Pool {
  // The global survives hot reloads; `cached` covers production, where module
  // scope is stable and the global is deliberately left unset.
  cached ??= globalThis.__richHabitsPool ?? create();
  if (!isProduction) globalThis.__richHabitsPool = cached;
  return cached;
}

export async function query<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await getPool().query(text, params);
  return rows as T[];
}

/** Everything in one transaction, rolled back if any statement throws. */
export async function transaction<T>(fn: (q: typeof query) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const scoped = async <R = any>(text: string, params: unknown[] = []) => {
      const { rows } = await client.query(text, params);
      return rows as R[];
    };
    const result = await fn(scoped as typeof query);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
