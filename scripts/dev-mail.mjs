/**
 * Read the local mail outbox: the composed messages `MAIL_OUTBOX_DIR` wrote
 * instead of handing them to a provider (src/lib/email/send.ts). This is how
 * flows that end in an email — password reset, Together invitations, address
 * verification — are tested end to end on a machine with no provider and no
 * real recipient: the real message, with its real link, lands here as a file.
 *
 *   npm run dev:mail           the newest message, with any links it carries
 *   npm run dev:mail -- 5      the newest five
 *
 * Development only by construction: it reads one local folder and nothing
 * else. Production never sets MAIL_OUTBOX_DIR (Resend is configured instead),
 * so there is nothing for this script to read there — and it refuses any
 * configuration that looks like one.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "./lib.mjs";

loadEnv();

const dir = process.env.MAIL_OUTBOX_DIR;
if (!dir) {
  console.error(
    "MAIL_OUTBOX_DIR is not set. Put `MAIL_OUTBOX_DIR=.mail-outbox` in .env.local\n" +
    "(see .env.example) and restart the dev server; messages will land there.",
  );
  process.exit(1);
}
if (process.env.RESEND_API_KEY) {
  // A real provider and an outbox together would mean this terminal is reading
  // mail a provider is also delivering. That is not a development setup.
  console.error("RESEND_API_KEY is set in this environment; refusing to read an outbox beside a real provider.");
  process.exit(1);
}

const resolved = path.resolve(ROOT, dir);
if (!fs.existsSync(resolved)) {
  console.error(`No outbox at ${resolved} yet — nothing has been sent. Trigger the flow first.`);
  process.exit(1);
}

const count = Math.min(Number(process.argv[2]) || 1, 20);
const names = fs.readdirSync(resolved).filter((n) => n.endsWith(".json")).sort().reverse().slice(0, count);
if (names.length === 0) {
  console.error(`The outbox at ${resolved} is empty. Trigger the flow first.`);
  process.exit(1);
}

for (const name of names) {
  const m = JSON.parse(fs.readFileSync(path.join(resolved, name), "utf8"));
  console.log(`\n— ${name}`);
  console.log(`  to:      ${m.to}`);
  console.log(`  subject: ${m.subject}`);
  console.log(`  sent:    ${m.sentAt}`);
  const links = [...new Set(String(m.text).match(/https?:\/\/\S+/g) ?? [])];
  for (const link of links) console.log(`  link:    ${link}`);
}
