/**
 * Shared by the command-line scripts.
 *
 * These run under plain Node, not Next, so two things they used to assume are
 * false: nothing loads `.env.local` for them, and they cannot import
 * `src/lib/env.ts`. Both are handled here, once, rather than in four files.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Loads env files the way Next does: `.env.local` wins over `.env`, and a
 * variable already in the environment beats both — so `DATABASE_URL=… npm run …`
 * still overrides the file.
 *
 * Deliberately minimal: `KEY=value`, optional quotes, `#` comments, no
 * interpolation. Anything more belongs in a dependency, and this needs none.
 */
export function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;   // already set: leave it
      process.env[key] = rawValue.trim().replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}

/**
 * The same rule as `resolveSsl` in src/lib/db/pool.ts: TLS off for localhost and
 * for undotted private hostnames (Render's internal host), on for a public FQDN,
 * overridable by DATABASE_SSL or an `sslmode` in the URL.
 *
 * It is duplicated from the TypeScript rather than shared because these scripts
 * cannot import TS — but it is now duplicated *once*, not once per script, and
 * `tests/pool.test.ts` pins the behaviour both copies must have.
 */
export function resolveSsl(url) {
  const on = { rejectUnauthorized: false };
  const override = process.env.DATABASE_SSL?.toLowerCase();
  if (override) return ["0", "false", "disable", "off", "no"].includes(override) ? false : on;

  let host = "", sslmode = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    sslmode = parsed.searchParams.get("sslmode") ?? "";
  } catch { /* not a parseable URL; fall through */ }

  if (sslmode) return sslmode === "disable" ? false : on;
  if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
  return host.includes(".") ? on : false;
}

/** Host and database, for saying out loud which one is about to be written to. */
export function describeTarget(connectionString) {
  try {
    const u = new URL(connectionString);
    // IPv6 hosts arrive bracketed and `URL` keeps the brackets, so `[::1]`
    // would not match a plain "::1" — the least suspected form of localhost
    // reading as production.
    return { host: u.hostname.replace(/^\[|\]$/g, ""), database: u.pathname.slice(1) || "(default)" };
  } catch { return { host: "unknown", database: "unknown" }; }
}

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", ""];
export const isLocalDatabase = (connectionString) =>
  LOCAL_HOSTS.includes(describeTarget(connectionString).host);

/**
 * Refuses to run against anything but a local database.
 *
 * `loadEnv()` reads `.env.local`, and the whole point of production is that its
 * connection string is convenient to have lying around — so the one thing
 * standing between a routine script and real people's data is a guard that does
 * not depend on remembering. `RH_ALLOW_REMOTE=1` overrides it, deliberately
 * awkwardly.
 *
 * This existed before and was called by exactly one script. The other four
 * connected straight through it, and a migration duly ran against production
 * while believed to be local — the connection string had been read from a
 * COMMENTED-OUT line by a hand-rolled regex, so nothing ever said otherwise.
 * Hence `connect()` now applies this by default: a guard you have to opt into
 * is one a new script will forget.
 */
export function assertLocalDatabase(connectionString, what) {
  if (process.env.RH_ALLOW_REMOTE === "1") return;
  if (isLocalDatabase(connectionString)) return;
  const { host, database } = describeTarget(connectionString);
  console.error(
    `\nRefusing to ${what}.\n\n` +
    `  target : ${host}\n` +
    `  database: ${database}\n\n` +
    "That is not a local database, so it is probably real people's data.\n" +
    "If you genuinely mean it — a production migration, say — be explicit:\n\n" +
    `  RH_ALLOW_REMOTE=1 DATABASE_URL='postgresql://…' npm run <script>\n`,
  );
  process.exit(1);
}

/**
 * A connected client, or a clear message about what is missing.
 *
 * Always announces the target before doing anything. The destination used to be
 * invisible, which is how the wrong one goes unnoticed: an operator who can see
 * `neon.tech` in the output has a chance to stop, and one who cannot does not.
 *
 * `allowRemote` is for scripts that are read-only or that legitimately run
 * against production; everything else is refused unless RH_ALLOW_REMOTE=1.
 */
export async function connect({ allowRemote = false, what = "run this script" } = {}) {
  loadEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "DATABASE_URL is not set.\n" +
      "Add it to .env.local (see .env.example), or pass it inline:\n" +
      "  DATABASE_URL=postgres://… npm run <script>",
    );
    process.exit(1);
  }
  if (!allowRemote) assertLocalDatabase(connectionString, what);

  const { host, database } = describeTarget(connectionString);
  const remote = !isLocalDatabase(connectionString);
  console.log(`  → ${host}/${database}${remote ? "   ** REMOTE **" : ""}`);

  const client = new pg.Client({ connectionString, ssl: resolveSsl(connectionString) });
  await client.connect();
  return client;
}
