/**
 * Applies db/schema.sql to whatever DATABASE_URL points at, once.
 *
 * Idempotent, so it is safe as a pre-deploy step: the schema uses bare
 * `create type` and `create table`, which fail on a second run, so this checks
 * for the `users` table first and does nothing if the database is already set
 * up. Uses `pg` rather than shelling out to psql, which Render's Node image
 * does not ship.
 *
 *   npm run db:setup
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

// Same rule as src/lib/db/pool.ts: TLS off for local and for undotted private
// hostnames (Render internal), on for a public FQDN.
function resolveSsl(url) {
  const override = process.env.DATABASE_SSL?.toLowerCase();
  if (override) return ["0", "false", "disable", "off", "no"].includes(override)
    ? false : { rejectUnauthorized: false };
  let host = "", sslmode = "";
  try {
    const u = new URL(url);
    host = u.hostname;
    sslmode = u.searchParams.get("sslmode") ?? "";
  } catch { /* fall through */ }
  if (sslmode) return sslmode === "disable" ? false : { rejectUnauthorized: false };
  if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
  return host.includes(".") ? { rejectUnauthorized: false } : false;
}

const client = new pg.Client({ connectionString, ssl: resolveSsl(connectionString) });
await client.connect();

try {
  const { rows } = await client.query(
    `select count(*)::int as present from information_schema.tables
      where table_schema = 'public' and table_name = 'users'`,
  );

  if (rows[0].present) {
    console.log("Schema already applied — nothing to do.");
  } else {
    const sql = fs.readFileSync(path.join(root, "db", "schema.sql"), "utf8");
    // One transaction: a partial schema is worse than none.
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
    const { rows: tables } = await client.query(
      `select count(*)::int as n from information_schema.tables where table_schema='public'`,
    );
    console.log(`Schema applied — ${tables[0].n} tables created.`);
  }
} finally {
  await client.end();
}
