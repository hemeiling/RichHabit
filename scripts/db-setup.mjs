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
import { ROOT, connect } from "./lib.mjs";

const client = await connect();

try {
  const { rows } = await client.query(
    `select count(*)::int as present from information_schema.tables
      where table_schema = 'public' and table_name = 'users'`,
  );

  if (rows[0].present) {
    console.log("Schema already applied — nothing to do.");
  } else {
    const sql = fs.readFileSync(path.join(ROOT, "db", "schema.sql"), "utf8");
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
