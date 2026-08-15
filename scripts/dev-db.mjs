/**
 * A local Postgres for development, with nothing to install.
 *
 * PGlite is Postgres compiled to WASM; pglite-socket puts it behind the real
 * wire protocol, so the app connects with `pg` over DATABASE_URL exactly as it
 * does to Render. Data persists in .pgdata/ between runs.
 *
 *   npm run db:dev
 *   DATABASE_URL=postgres://postgres@127.0.0.1:5433/postgres PG_POOL_MAX=1 npm run dev
 *
 * Prefer `docker compose up -d` where Docker is available — that runs the same
 * Postgres you deploy to. This exists for machines without it.
 */
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { ROOT, loadEnv } from "./lib.mjs";

loadEnv();
const root = ROOT;
/*
 * `--test` runs a second, throwaway database on its own port and its own
 * directory, so browser suites never write to the database you develop against.
 * It is wiped on every start: a test database that accumulates is the thing
 * this exists to prevent.
 */
const isTest = process.argv.includes("--test");
const dataDir = path.join(root, isTest ? ".pgdata-test" : ".pgdata");
const PORT = Number(process.env.DEV_DB_PORT ?? (isTest ? 5434 : 5433));

if (isTest) fs.rmSync(dataDir, { recursive: true, force: true });

const db = await PGlite.create({ dataDir });

const [{ present }] = (await db.query(
  `select count(*)::int as present from information_schema.tables
    where table_schema = 'public' and table_name = 'users'`,
)).rows;

if (!present) {
  const sql = fs.readFileSync(path.join(root, "db", "schema.sql"), "utf8");
  await db.exec(sql);
  console.log(`schema applied to a fresh database${isTest ? " (test)" : ""}`);
} else {
  console.log(`existing database found in ${path.basename(dataDir)}`);
}

await new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" }).start();
console.log(`\n  postgres://postgres@127.0.0.1:${PORT}/postgres\n`);
console.log("Put this in .env.local, then `npm run dev` in another terminal:");
console.log(`  DATABASE_URL=postgres://postgres@127.0.0.1:${PORT}/postgres`);
// PGlite serves one connection at a time.
console.log("  PG_POOL_MAX=1\n");
