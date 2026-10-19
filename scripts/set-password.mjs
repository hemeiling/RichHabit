/**
 * Emergency account recovery, against the database directly — the documented
 * way back into an Admin's account (README, "Recovering an Admin account").
 *
 * The app deliberately offers no Reset password or Reissue setup link for an
 * Admin's account, current or former (src/lib/admin/protected.ts): whoever
 * controls an Admin's sign-in acts as that Admin. Recovery is therefore an
 * operator action, like granting admin, and needs the database credentials.
 *
 *   npm run admin:password -- <username-or-email>          # prompts, hidden (preferred)
 *   npm run admin:password -- <username-or-email> 'pass'   # lands in shell history — avoid
 *   production: RH_ALLOW_REMOTE=1 DATABASE_URL='postgresql://…' npm run admin:password -- <who>
 *
 * In one transaction it sets the temporary password, marks the account as owing
 * a password change (the person chooses their own at the next sign-in, so the
 * operator never knows the final one), ends every session, and writes an audit
 * entry. Never prints or logs the password.
 *
 * The hashing here must match src/lib/auth.ts exactly: scrypt, 16-byte random
 * salt, 64-byte key, stored as scrypt$<saltHex>$<keyHex> (tests/admin-recovery
 * proves the app accepts it).
 */
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { connect, loadEnv } from "./lib.mjs";

const scrypt = promisify(scryptCb);
const KEY_LEN = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

/**
 * Sets `hash` as the password of the account named by username or email, owing
 * a change, with every session ended and the recovery audited — one transaction.
 * Returns the account's display identifier, or null when nothing matched.
 */
export async function recoverAccount(client, identifier, hash) {
  const who = identifier.trim().toLowerCase();
  await client.query("begin");
  try {
    const { rows } = await client.query(
      `update users set password_hash = $2, must_change_password = true
        where lower(email) = $1 or username = $1
        returning id, coalesce(username, email) as name, coalesce(email, username) as target`,
      [who, hash]);
    if (rows.length !== 1) { await client.query("rollback"); return null; }
    const [u] = rows;
    await client.query("delete from sessions where user_id = $1", [u.id]);
    await client.query(
      `insert into admin_audit_log (admin_id, admin_email, target_id, target_email, action, details)
       values (null, 'npm run admin:password', $1, $2, 'password_reset_requested', $3)`,
      [u.id, u.target, JSON.stringify({ via: "command line", mustChange: true, sessionsEnded: true })]);
    await client.query("commit");
    return u.name;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  }
}

/** Reads without echoing, so the password does not land in the terminal. */
async function prompt(label) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  process.stdout.write(`Temporary password for ${label}: `);
  const wasRaw = process.stdin.isRaw;
  if (process.stdin.isTTY) process.stdin.setRawMode?.(true);
  const typed = await new Promise((resolve) => {
    let buf = "";
    const onData = (ch) => {
      const s = ch.toString();
      if (s === "\n" || s === "\r" || s === "\u0004") {
        process.stdin.off("data", onData);
        if (process.stdin.isTTY) process.stdin.setRawMode?.(wasRaw ?? false);
        process.stdout.write("\n");
        resolve(buf);
      } else if (s === "\u0003") { process.exit(1); }
      else if (s === "\u007f") { buf = buf.slice(0, -1); }
      else buf += s;
    };
    process.stdin.on("data", onData);
  });
  rl.close();
  return typed;
}

async function main() {
  loadEnv();
  const MIN = Number(process.env.AUTH_MIN_PASSWORD ?? 8);
  const MAX = Number(process.env.AUTH_MAX_PASSWORD ?? 200);
  const args = process.argv.slice(2);
  const identifier = (args[0] ?? process.env.ADMIN_EMAIL ?? "").trim();
  if (!identifier) {
    console.error("Usage: npm run admin:password -- <username-or-email> ['temporary password']");
    process.exit(1);
  }
  const password = args[1] ?? await prompt(identifier);
  if (password.length < MIN || password.length > MAX) {
    console.error(`Password must be between ${MIN} and ${MAX} characters.`);
    process.exit(1);
  }
  const hash = await hashPassword(password);
  const client = await connect({ what: "recover an account's password" });
  try {
    const name = await recoverAccount(client, identifier, hash);
    if (!name) {
      console.error(`No single account found for ${identifier}.`);
      process.exitCode = 1;
    } else {
      console.log(`${name}: temporary password set, every session ended, audited.`);
      console.log("They sign in with it once and are then asked to choose their own.");
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
