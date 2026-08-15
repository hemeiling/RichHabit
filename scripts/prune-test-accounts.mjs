/**
 * Removes accounts left behind by browser suites — deliberately, and only when
 * you say so.
 *
 * Nothing here runs on its own and nothing is deleted by default:
 *
 *   npm run db:prune                 # lists what it would delete, deletes nothing
 *   npm run db:prune -- --yes        # actually deletes
 *   npm run db:prune -- --before 2026-08-14   # only ones older than a date
 *
 * The pattern is narrow on purpose: `<prefix>-<13-digit timestamp>@example.com`
 * is the shape every suite fixture in this repo generates, and `Date.now()` has
 * had 13 digits since 2001 and will until 2286. A real person's address does
 * not look like that. Even so, an email pattern is a guess, so the script shows
 * every row and its age before it touches anything, refuses to touch an admin,
 * and refuses anything that is not @example.com.
 *
 * The better fix is not to create them here at all: `npm run db:test` plus
 * `npm run dev:test` runs the suites against a throwaway database on port 5434,
 * which is wiped on every start. This script is for the ones already made.
 */
import { assertLocalDatabase, connect, loadEnv } from "./lib.mjs";

const args = process.argv.slice(2);
const commit = args.includes("--yes");
const before = args[args.indexOf("--before") + 1];
const cutoff = args.includes("--before") && before ? before : null;

// A suite fixture: some prefix, a hyphen, a 13-digit epoch, at example.com.
const FIXTURE = '^[a-z0-9-]+-[0-9]{13}@example\\.com$';

/*
 * `loadEnv()` first, then the guard, then the connection. Checking before the
 * env file is read would see an empty DATABASE_URL, treat that as local, and
 * wave through exactly the case this exists for: a production connection string
 * sitting in .env.local because it was convenient during a deploy.
 */
loadEnv();
assertLocalDatabase(process.env.DATABASE_URL ?? "", "prune accounts");

const client = await connect();
try {
  const { rows } = await client.query(
    `select u.id, u.email, u.role::text as role, u.created_at,
            (select count(*) from habit_completions c where c.user_id = u.id) as completions
       from users u
      where u.email ~ $1
        and u.role <> 'admin'
        and ($2::date is null or u.created_at::date < $2::date)
      order by u.created_at`,
    [FIXTURE, cutoff],
  );

  const { rows: [{ total }] } = await client.query("select count(*)::int total from users");
  const skipped = await client.query(
    `select count(*)::int n from users where email ~ $1 and role = 'admin'`, [FIXTURE]);

  console.log(`${total} accounts in the database.`);
  console.log(`${rows.length} match the suite-fixture pattern${cutoff ? ` and predate ${cutoff}` : ""}.`);
  if (skipped.rows[0].n) {
    console.log(`${skipped.rows[0].n} matched but are admins, and are left alone.`);
  }
  if (rows.length === 0) {
    console.log("Nothing to do.");
  } else {
    console.log("");
    for (const r of rows.slice(0, 20)) {
      console.log(`  ${r.email}  created ${new Date(r.created_at).toISOString().slice(0, 10)}` +
        `  ${r.completions} completions`);
    }
    if (rows.length > 20) console.log(`  … and ${rows.length - 20} more`);
    console.log("");

    if (!commit) {
      console.log("Dry run. Nothing was deleted. Re-run with --yes to delete these.");
    } else {
      // Everything owned cascades; analytics detach. Same path as the admin UI.
      const { rowCount } = await client.query(
        "delete from users where id = any($1::uuid[])", [rows.map((r) => r.id)]);
      console.log(`Deleted ${rowCount} account(s) and everything they owned.`);
    }
  }
} finally {
  await client.end();
}
