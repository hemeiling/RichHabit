/**
 * Sets an account's password, against the database directly.
 *
 * There is no change-password screen yet, and no API that can set a password
 * for an arbitrary account — deliberately. This is a deployment action, like
 * granting admin.
 *
 *   npm run admin:password -- someone@example.com 'a new passphrase'
 *   npm run admin:password -- someone@example.com          # prompts, hidden
 *
 * The hashing here must match src/lib/auth.ts exactly: scrypt, 16-byte random
 * salt, 64-byte key, stored as scrypt$<saltHex>$<keyHex>.
 */
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { connect, loadEnv } from "./lib.mjs";

loadEnv();

const scrypt = promisify(scryptCb);
const KEY_LEN = 64;
const MIN = Number(process.env.AUTH_MIN_PASSWORD ?? 8);
const MAX = Number(process.env.AUTH_MAX_PASSWORD ?? 200);

const args = process.argv.slice(2);
const email = (args[0] ?? process.env.ADMIN_EMAIL ?? "").toLowerCase();
let password = args[1];

if (!email) {
  console.error("Usage: npm run admin:password -- <email> ['new password']");
  console.error("       (or set ADMIN_EMAIL in .env.local and omit the email)");
  process.exit(1);
}

/** Reads without echoing, so the password does not land in the terminal. */
async function prompt() {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  process.stdout.write(`New password for ${email}: `);
  const wasRaw = process.stdin.isRaw;
  if (process.stdin.isTTY) process.stdin.setRawMode?.(true);
  const typed = await new Promise((resolve) => {
    let buf = "";
    const onData = (ch) => {
      const s = ch.toString();
      if (s === "\n" || s === "\r" || s === "") {
        process.stdin.off("data", onData);
        if (process.stdin.isTTY) process.stdin.setRawMode?.(wasRaw ?? false);
        process.stdout.write("\n");
        resolve(buf);
      } else if (s === "") { process.exit(1); }
      else if (s === "") { buf = buf.slice(0, -1); }
      else buf += s;
    };
    process.stdin.on("data", onData);
  });
  rl.close();
  return typed;
}

if (!password) password = await prompt();

if (password.length < MIN || password.length > MAX) {
  console.error(`Password must be between ${MIN} and ${MAX} characters.`);
  process.exit(1);
}

const salt = randomBytes(16);
const key = await scrypt(password, salt, KEY_LEN);
const hash = `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;

const client = await connect({ what: "set an account password" });
try {
  const { rows } = await client.query(
    "update users set password_hash = $1 where lower(email) = $2 returning email",
    [hash, email],
  );
  if (!rows[0]) {
    console.error(`No account found for ${email}.`);
    process.exitCode = 1;
  } else {
    // Existing sessions stay valid on purpose: changing your own password from
    // the CLI should not sign you out of the browser you are sitting in front of.
    console.log(`Password updated for ${rows[0].email}.`);
  }
} finally {
  await client.end();
}
