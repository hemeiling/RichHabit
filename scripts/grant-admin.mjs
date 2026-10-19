/**
 * Grants or revokes admin, against the database directly.
 *
 * The first admin has to come from somewhere that is not an admin: this runs
 * with the operator's own database credentials. Once one exists, roles are
 * normally changed in Admin → Users (the PATCH route's `action: "role"`,
 * admin-only, with last-admin and self-demotion refusals); an ordinary
 * account still has no path to a role from the browser.
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
    /* The change and its audit row in one transaction — the same
       `user_role_changed` row Admin → Users writes. A former Admin's email
       stays protected because that row exists (src/lib/admin/protected.ts). */
    await client.query("begin");
    const before = await client.query(
      "select id, email, role::text as role from users where lower(email) = $1 for update", [email]);
    const { rows } = await client.query(
      "update users set role = $1 where lower(email) = $2 returning email, role",
      [role, email],
    );
    if (before.rows[0] && before.rows[0].role !== role) {
      await client.query(
        `insert into admin_audit_log (admin_id, admin_email, target_id, target_email, action, details)
         values (null, 'npm run admin:grant', $1, $2, 'user_role_changed', $3)`,
        [before.rows[0].id, before.rows[0].email, JSON.stringify({ from: before.rows[0].role, to: role })],
      );
    }
    await client.query("commit");
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
