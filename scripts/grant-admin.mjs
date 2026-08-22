/**
 * Grants or revokes admin, against the database directly.
 *
 * This is deliberately not an API. Nothing a browser can send changes a role —
 * `users.role` has no write path anywhere in src/app/api, so an ordinary
 * account cannot promote itself even if every other check were bypassed.
 *
 *   npm run admin:grant  -- someone@example.com
 *   npm run admin:grant  -- someone@example.com --revoke
 *   npm run admin:grant  -- --list
 */
import { connect, loadEnv } from "./lib.mjs";

loadEnv();

const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const list = args.includes("--list");
const email = (args.find((a) => !a.startsWith("--")) ?? process.env.ADMIN_EMAIL ?? "").toLowerCase() || undefined;

const client = await connect({ what: "change an account's role" });

try {
  if (list) {
    const { rows } = await client.query("select email, role, created_at from users order by role desc, email");
    rows.forEach((r) => console.log(`  ${r.role.padEnd(5)}  ${r.email}`));
    console.log(`\n${rows.filter((r) => r.role === "admin").length} admin(s) of ${rows.length} user(s).`);
  } else if (!email) {
    console.error("Usage: npm run admin:grant -- <email> [--revoke] | --list");
    console.error("       (or set ADMIN_EMAIL in .env.local and omit the email)");
    process.exitCode = 1;
  } else {
    const role = revoke ? "user" : "admin";
    const { rows } = await client.query(
      "update users set role = $1 where lower(email) = $2 returning email, role",
      [role, email],
    );
    if (!rows[0]) {
      console.error(`No account found for ${email}.`);
      process.exitCode = 1;
    } else {
      console.log(`${rows[0].email} is now ${rows[0].role}.`);
    }
  }
} finally {
  await client.end();
}
